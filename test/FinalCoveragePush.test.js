const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Final Coverage Push - Reach 80%", function () {
    const REG_US_A = 0x0001;
    const REG_US_CF = 0x0002;
    const REG_US_D = 0x0003;
    const REG_US_S = 0x0004;
    const issuanceDate1 = Math.floor(Date.now() / 1000) - 86400 * 30;
    const issuanceDate2 = Math.floor(Date.now() / 1000) - 86400 * 60;

    let token, tokenUpgradeable;
    let rtaProxy, rtaProxyUpgradeable;
    let owner, rta1, rta2, alice, bob, carol, dave;
    let tokenAddress, tokenUpgradeableAddress;

    async function submitAndConfirmOperation(proxy, target, data, signers) {
        const opId = await proxy.operationCount();
        await proxy.connect(signers[0]).submitOperation(target, data, 0);
        for (let i = 1; i < signers.length; i++) {
            await proxy.connect(signers[i]).confirmOperation(opId);
        }
    }

    beforeEach(async function () {
        [owner, rta1, rta2, alice, bob, carol, dave] = await ethers.getSigners();

        // Deploy RTAProxy
        const RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy([rta1.address, rta2.address], 2);
        await rtaProxy.waitForDeployment();

        // Deploy ERC1450
        const ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy(
            "Security Token",
            "SEC",
            18,
            owner.address,
            await rtaProxy.getAddress()
        );
        await token.waitForDeployment();
        tokenAddress = await token.getAddress();

        // Deploy upgradeable versions
        const RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
        rtaProxyUpgradeable = await upgrades.deployProxy(
            RTAProxyUpgradeable,
            [[rta1.address, rta2.address], 2],
            { initializer: 'initialize' }
        );
        await rtaProxyUpgradeable.waitForDeployment();

        const ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
        tokenUpgradeable = await upgrades.deployProxy(
            ERC1450Upgradeable,
            ["Security Token Upgradeable", "SECU", 10, owner.address, await rtaProxyUpgradeable.getAddress()],
            { initializer: 'initialize' }
        );
        await tokenUpgradeable.waitForDeployment();
        tokenUpgradeableAddress = await tokenUpgradeable.getAddress();
    });

    describe("ERC1450 - Token Batch Edge Cases", function () {

        it("Should handle partial batch burns", async function () {
            // Mint multiple small batches
            for (let i = 0; i < 5; i++) {
                const mintData = token.interface.encodeFunctionData("mint", [
                    alice.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate1 - (i * 86400)
                ]);
                await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);
            }

            // Burn amount that crosses multiple batches
            const burnData = token.interface.encodeFunctionData("burnFrom", [alice.address, ethers.parseUnits("175", 10)]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData, [rta1, rta2]);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("75", 10));
        });

        it("Should handle transfers with zero internal wallet count", async function () {
            // Mint tokens
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Transfer without any internal wallets configured
            const transferData = token.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, bob.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, transferData, [rta1, rta2]);

            expect(await token.balanceOf(bob.address)).to.equal(ethers.parseUnits("100", 10));
        });

        it("Should handle broker-initiated transfer requests", async function () {
            // Set bob as broker
            const setBrokerData = token.interface.encodeFunctionData("setBrokerStatus", [bob.address, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setBrokerData, [rta1, rta2]);

            // Mint tokens to alice
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Set fees
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseUnits("0.01", 10), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Broker initiates transfer for alice
            await token.connect(bob).requestTransferWithFee(
                alice.address, carol.address, ethers.parseUnits("200", 10),
                ethers.ZeroAddress, ethers.parseUnits("0.01", 10),
                { value: ethers.parseUnits("0.01", 10) }
            );

            // Process the request
            const processData = token.interface.encodeFunctionData("processTransferRequest", [1, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, processData, [rta1, rta2]);

            expect(await token.balanceOf(carol.address)).to.equal(ethers.parseUnits("200", 10));
        });

        it("Should handle fee token approval edge case", async function () {
            // Deploy mock ERC20
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const feeToken = await MockERC20.deploy("Fee Token", "FEE", 18);
            await feeToken.waitForDeployment();

            // Mint tokens
            await feeToken.mint(alice.address, ethers.parseUnits("100", 10));
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Set fee with ERC20
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseUnits("5", 10), [await feeToken.getAddress()]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Approve exact amount
            await feeToken.connect(alice).approve(tokenAddress, ethers.parseUnits("5", 10));

            // Request with exact fee amount
            await token.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseUnits("100", 10),
                await feeToken.getAddress(), ethers.parseUnits("5", 10),
                { value: 0 }
            );

            // Verify fee token was transferred
            expect(await feeToken.balanceOf(tokenAddress)).to.equal(ethers.parseUnits("5", 10));
        });
    });

    describe("ERC1450Upgradeable - Complex Scenarios", function () {

        it("Should handle sequential batch operations", async function () {
            // Batch mint
            const batchMintData = tokenUpgradeable.interface.encodeFunctionData("batchMint", [
                [alice.address, bob.address, carol.address],
                [ethers.parseUnits("100", 10), ethers.parseUnits("200", 10), ethers.parseUnits("300", 10)],
                [REG_US_A, REG_US_CF, REG_US_D],
                [issuanceDate1, issuanceDate1, issuanceDate1]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, batchMintData, [rta1, rta2]);

            // Batch transfer
            const batchTransferData = tokenUpgradeable.interface.encodeFunctionData("batchTransferFrom", [
                [alice.address, bob.address, carol.address],
                [dave.address, dave.address, dave.address],
                [ethers.parseUnits("50", 10), ethers.parseUnits("100", 10), ethers.parseUnits("150", 10)],
                [REG_US_A, REG_US_CF, REG_US_D],
                [issuanceDate1, issuanceDate1, issuanceDate1]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, batchTransferData, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(dave.address)).to.equal(ethers.parseUnits("300", 10));
        });

        it("Should handle transfer from frozen to unfrozen account", async function () {
            // Mint tokens
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("500", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);

            // Freeze alice
            const freezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [alice.address, true]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, freezeData, [rta1, rta2]);

            // Try normal transfer (should fail via revert in other tests, testing the frozen path)
            // We'll use court order which bypasses frozen check
            const courtOrderData = tokenUpgradeable.interface.encodeFunctionData("executeCourtOrder", [
                alice.address, bob.address, ethers.parseUnits("100", 10),
                ethers.keccak256(ethers.toUtf8Bytes("court-order-frozen-transfer"))
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, courtOrderData, [rta1, rta2]);

            // Unfreeze alice
            const unfreezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [alice.address, false]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, unfreezeData, [rta1, rta2]);

            // Now normal transfer should work
            const transferData = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, carol.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, transferData, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(carol.address)).to.equal(ethers.parseUnits("100", 10));
        });

        it("Should handle burn with exact regulation balance", async function () {
            // Mint exact amounts
            const mintData1 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData1, [rta1, rta2]);

            const mintData2 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("200", 10), REG_US_CF, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData2, [rta1, rta2]);

            // Burn exact REG_US_A balance
            const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFromRegulation", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseUnits("200", 10));
        });

        it("Should handle multiple regulation transfers from same holder", async function () {
            // Mint different regulations
            const mintData1 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData1, [rta1, rta2]);

            const mintData2 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("200", 10), REG_US_CF, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData2, [rta1, rta2]);

            const mintData3 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("300", 10), REG_US_D, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData3, [rta1, rta2]);

            // Transfer from each regulation
            const transfer1 = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, bob.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, transfer1, [rta1, rta2]);

            const transfer2 = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, bob.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, transfer2, [rta1, rta2]);

            const transfer3 = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, bob.address, ethers.parseUnits("150", 10), REG_US_D, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, transfer3, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(ethers.parseUnits("300", 10));
        });
    });

    describe("Edge Case Coverage", function () {

        it("Should handle zero-amount edge cases", async function () {
            // Mint tokens
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Test batch with some zero amounts
            const batchTransferData = token.interface.encodeFunctionData("batchTransferFrom", [
                [alice.address, alice.address],
                [bob.address, carol.address],
                [ethers.parseUnits("100", 10), ethers.parseUnits("0", 10)],
                [REG_US_A, REG_US_A],
                [issuanceDate1, issuanceDate1]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, batchTransferData, [rta1, rta2]);

            expect(await token.balanceOf(bob.address)).to.equal(ethers.parseUnits("100", 10));
            expect(await token.balanceOf(carol.address)).to.equal(0);
        });

        it("Should handle batch operations with varying regulations", async function () {
            // Batch mint with different regulations
            const batchMintData = token.interface.encodeFunctionData("batchMint", [
                [alice.address, alice.address, alice.address, alice.address],
                [ethers.parseUnits("100", 10), ethers.parseUnits("200", 10), ethers.parseUnits("300", 10), ethers.parseUnits("400", 10)],
                [REG_US_A, REG_US_CF, REG_US_D, REG_US_S],
                [issuanceDate1, issuanceDate1, issuanceDate2, issuanceDate2]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, batchMintData, [rta1, rta2]);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("1000", 10));
        });

        it("Should handle fee parameter updates", async function () {
            // Set initial fees
            const setFeeData1 = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseUnits("0.01", 10), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData1, [rta1, rta2]);

            // Update fees
            const setFeeData2 = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseUnits("0.02", 10), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData2, [rta1, rta2]);

            // Verify by requesting a transfer with the new fee
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            await token.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseUnits("100", 10),
                ethers.ZeroAddress, ethers.parseUnits("0.02", 10),
                { value: ethers.parseUnits("0.02", 10) }
            );

            // Successful request creation verifies the fee was accepted
            expect(await ethers.provider.getBalance(tokenAddress)).to.be.gte(ethers.parseUnits("0.02", 10));
        });
    });
});
