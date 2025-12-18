const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Exact 80% - Targeted Branch Coverage", function () {
    const REG_US_A = 0x0001;
    const REG_US_CF = 0x0002;
    const issuanceDate1 = Math.floor(Date.now() / 1000) - 86400 * 30;
    const issuanceDate2 = Math.floor(Date.now() / 1000) - 86400 * 60;

    let token, tokenUpgradeable;
    let rtaProxy, rtaProxyUpgradeable;
    let owner, rta1, rta2, alice, bob, carol;
    let tokenAddress, tokenUpgradeableAddress;
    let MockERC20, feeToken;

    async function submitAndConfirmOperation(proxy, target, data, signers) {
        const opId = await proxy.operationCount();
        await proxy.connect(signers[0]).submitOperation(target, data, 0);
        for (let i = 1; i < signers.length; i++) {
            await proxy.connect(signers[i]).confirmOperation(opId);
        }
    }

    beforeEach(async function () {
        [owner, rta1, rta2, alice, bob, carol] = await ethers.getSigners();

        // Deploy mock USDC for fee payments (6 decimals like real USDC)
        MockERC20 = await ethers.getContractFactory("MockERC20");
        feeToken = await MockERC20.deploy("Mock USDC", "USDC", 6);
        await feeToken.waitForDeployment();

        const RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy([rta1.address, rta2.address], 2);
        await rtaProxy.waitForDeployment();

        const ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy("Security Token", "SEC", 10, owner.address, await rtaProxy.getAddress());
        await token.waitForDeployment();
        tokenAddress = await token.getAddress();

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

    describe("ERC1450 - Uncovered Error Paths", function () {

        it("Should revert when requesting transfer with address(0) as from", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            const setFeeTokenData = token.interface.encodeFunctionData("setFeeToken", [
                await feeToken.getAddress()
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeTokenData, [rta1, rta2]);

            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseUnits("0.01", 6)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Mint fee tokens to alice and approve
            await feeToken.mint(alice.address, ethers.parseUnits("100", 6));
            await feeToken.connect(alice).approve(tokenAddress, ethers.parseUnits("100", 6));

            // Try to request transfer with address(0) as from
            await expect(
                token.connect(alice).requestTransferWithFee(
                    ethers.ZeroAddress, bob.address, ethers.parseUnits("100", 10),
                    ethers.parseUnits("0.01", 6)
                )
            ).to.be.reverted;
        });

        it("Should revert when requesting transfer with address(0) as to", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            const setFeeTokenData = token.interface.encodeFunctionData("setFeeToken", [
                await feeToken.getAddress()
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeTokenData, [rta1, rta2]);

            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseUnits("0.01", 6)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Mint fee tokens to alice and approve
            await feeToken.mint(alice.address, ethers.parseUnits("100", 6));
            await feeToken.connect(alice).approve(tokenAddress, ethers.parseUnits("100", 6));

            // Try to request transfer with address(0) as to
            await expect(
                token.connect(alice).requestTransferWithFee(
                    alice.address, ethers.ZeroAddress, ethers.parseUnits("100", 10),
                    ethers.parseUnits("0.01", 6)
                )
            ).to.be.reverted;
        });

        it("Should handle very deep batch structures with cleanup", async function () {
            // Create 50 very small batches
            for (let i = 0; i < 50; i++) {
                const mintData = token.interface.encodeFunctionData("mint", [
                    alice.address, ethers.parseUnits("2", 10), REG_US_A, issuanceDate1 - (i * 10)
                ]);
                await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);
            }

            // Burn large amount to trigger extensive cleanup
            const burnData = token.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseUnits("98", 10)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData, [rta1, rta2]);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("2", 10));
        });

        it("Should handle batch operations with diverse date patterns", async function () {
            const recipients = [];
            const amounts = [];
            const regulations = [];
            const dates = [];

            // Create 60 items with very diverse patterns
            for (let i = 0; i < 60; i++) {
                recipients.push([alice.address, bob.address, carol.address][i % 3]);
                amounts.push(ethers.parseUnits((i % 5 + 1, 10).toString(), 10));
                regulations.push([REG_US_A, REG_US_CF][i % 2]);
                dates.push(issuanceDate1 - (i * 123));
            }

            const batchMintData = token.interface.encodeFunctionData("batchMint", [
                recipients, amounts, regulations, dates
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, batchMintData, [rta1, rta2]);

            expect(await token.totalSupply()).to.be.gt(0);
        });

        it("Should handle multiple transfer requests with various outcomes", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("2000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            const setFeeTokenData = token.interface.encodeFunctionData("setFeeToken", [
                await feeToken.getAddress()
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeTokenData, [rta1, rta2]);

            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseUnits("0.01", 6)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Mint fee tokens to alice and approve
            await feeToken.mint(alice.address, ethers.parseUnits("1", 6));
            await feeToken.connect(alice).approve(tokenAddress, ethers.parseUnits("1", 6));

            // Create 10 transfer requests
            for (let i = 0; i < 10; i++) {
                await token.connect(alice).requestTransferWithFee(
                    alice.address, bob.address, ethers.parseUnits("50", 10),
                    ethers.parseUnits("0.01", 6)
                );
            }

            // Process some, reject some with refund, reject some without
            const process1 = token.interface.encodeFunctionData("processTransferRequest", [1, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, process1, [rta1, rta2]);

            const process2 = token.interface.encodeFunctionData("processTransferRequest", [2, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, process2, [rta1, rta2]);

            const reject3 = token.interface.encodeFunctionData("rejectTransferRequest", [3, 1, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, reject3, [rta1, rta2]);

            const reject4 = token.interface.encodeFunctionData("rejectTransferRequest", [4, 2, false]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, reject4, [rta1, rta2]);

            const reject5 = token.interface.encodeFunctionData("rejectTransferRequest", [5, 3, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, reject5, [rta1, rta2]);

            // Update status on one
            const updateStatus = token.interface.encodeFunctionData("updateRequestStatus", [6, 1]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, updateStatus, [rta1, rta2]);
        });
    });

    describe("ERC1450Upgradeable - Deep Branch Testing", function () {

        it("Should handle extreme batch diversity on upgradeable", async function () {
            // Create 70 items with maximum diversity
            const recipients = [];
            const amounts = [];
            const regulations = [];
            const dates = [];

            for (let i = 0; i < 70; i++) {
                recipients.push([alice.address, bob.address, carol.address][i % 3]);
                amounts.push(ethers.parseUnits(((i % 7, 10) + 1).toString(), 10));
                regulations.push([REG_US_A, REG_US_CF][i % 2]);
                dates.push(issuanceDate1 - (i * 87));
            }

            const batchMintData = tokenUpgradeable.interface.encodeFunctionData("batchMint", [
                recipients, amounts, regulations, dates
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, batchMintData, [rta1, rta2]);

            expect(await tokenUpgradeable.totalSupply()).to.be.gt(0);
        });

        it("Should handle sequential burn operations across batches", async function () {
            // Create 40 small batches
            for (let i = 0; i < 40; i++) {
                const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                    alice.address, ethers.parseUnits("3", 10), REG_US_A, issuanceDate1 - (i * 77)
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
            }

            // Burn in multiple passes
            for (let i = 0; i < 8; i++) {
                const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFrom", [
                    alice.address, ethers.parseUnits("5", 10)
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);
            }

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseUnits("80", 10));
        });

        it("Should handle complex transfer request scenarios on upgradeable", async function () {
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("3000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);

            const setFeeTokenData = tokenUpgradeable.interface.encodeFunctionData("setFeeToken", [
                await feeToken.getAddress()
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, setFeeTokenData, [rta1, rta2]);

            const setFeeData = tokenUpgradeable.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseUnits("0.01", 6)
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, setFeeData, [rta1, rta2]);

            // Mint fee tokens to alice and approve
            await feeToken.mint(alice.address, ethers.parseUnits("1", 6));
            await feeToken.connect(alice).approve(tokenUpgradeableAddress, ethers.parseUnits("1", 6));

            // Create multiple requests
            for (let i = 0; i < 8; i++) {
                await tokenUpgradeable.connect(alice).requestTransferWithFee(
                    alice.address, bob.address, ethers.parseUnits("100", 10),
                    ethers.parseUnits("0.01", 6)
                );
            }

            // Mix of operations
            const process1 = tokenUpgradeable.interface.encodeFunctionData("processTransferRequest", [1, true]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, process1, [rta1, rta2]);

            const reject2 = tokenUpgradeable.interface.encodeFunctionData("rejectTransferRequest", [2, 1, true]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, reject2, [rta1, rta2]);

            const reject3 = tokenUpgradeable.interface.encodeFunctionData("rejectTransferRequest", [3, 2, false]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, reject3, [rta1, rta2]);

            const updateStatus4 = tokenUpgradeable.interface.encodeFunctionData("updateRequestStatus", [4, 2]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, updateStatus4, [rta1, rta2]);

            const process4 = tokenUpgradeable.interface.encodeFunctionData("processTransferRequest", [4, true]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, process4, [rta1, rta2]);
        });

        it("Should handle alternating regulation operations", async function () {
            // Mint alternating regulations
            for (let i = 0; i < 20; i++) {
                const reg = i % 2 === 0 ? REG_US_A : REG_US_CF;
                const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                    alice.address, ethers.parseUnits("10", 10), reg, issuanceDate1 - (i * 50)
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
            }

            // Alternate burns from different regulations
            for (let i = 0; i < 5; i++) {
                const burnA = tokenUpgradeable.interface.encodeFunctionData("burnFromRegulation", [
                    alice.address, ethers.parseUnits("15", 10), REG_US_A
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnA, [rta1, rta2]);

                const burnCF = tokenUpgradeable.interface.encodeFunctionData("burnFromRegulation", [
                    alice.address, ethers.parseUnits("10", 10), REG_US_CF
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnCF, [rta1, rta2]);
            }

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseUnits("75", 10));
        });

        it("Should handle complex freeze/court order patterns", async function () {
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);

            // Multiple freeze/courtOrder/unfreeze cycles with transfers
            for (let i = 0; i < 7; i++) {
                const freezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [
                    alice.address, true
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, freezeData, [rta1, rta2]);

                const courtOrderData = tokenUpgradeable.interface.encodeFunctionData("controllerTransfer", [
                    alice.address, bob.address, ethers.parseUnits("30", 10),
                    ethers.keccak256(ethers.toUtf8Bytes(`order-cycle-${i}`)),
                    ethers.toUtf8Bytes("COURT_ORDER")
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, courtOrderData, [rta1, rta2]);

                const unfreezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [
                    alice.address, false
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, unfreezeData, [rta1, rta2]);

                const transferData = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                    alice.address, carol.address, ethers.parseUnits("20", 10), REG_US_A, issuanceDate1
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, transferData, [rta1, rta2]);
            }

            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(ethers.parseUnits("210", 10));
            expect(await tokenUpgradeable.balanceOf(carol.address)).to.equal(ethers.parseUnits("140", 10));
        });
    });
});
