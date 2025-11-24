const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Branch Coverage Boost - Target 80%", function () {
    const REG_US_A = 0x0001;
    const REG_US_CF = 0x0002;
    const REG_US_D = 0x0003;
    const issuanceDate1 = Math.floor(Date.now() / 1000) - 86400 * 30;
    const issuanceDate2 = Math.floor(Date.now() / 1000) - 86400 * 60;

    let token, tokenUpgradeable;
    let rtaProxy, rtaProxyUpgradeable;
    let owner, rta1, rta2, alice, bob, carol;
    let tokenAddress, tokenUpgradeableAddress;

    async function submitAndConfirmOperation(proxy, target, data, signers) {
        const opId = await proxy.operationCount();
        await proxy.connect(signers[0]).submitOperation(target, data, 0);
        for (let i = 1; i < signers.length; i++) {
            await proxy.connect(signers[i]).confirmOperation(opId);
        }
    }

    beforeEach(async function () {
        [owner, rta1, rta2, alice, bob, carol] = await ethers.getSigners();

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
            ["Security Token Upgradeable", "SECU", 18, owner.address, await rtaProxyUpgradeable.getAddress()],
            { initializer: 'initialize' }
        );
        await tokenUpgradeable.waitForDeployment();
        tokenUpgradeableAddress = await tokenUpgradeable.getAddress();
    });

    describe("ERC1450 - Fee Edge Cases", function () {

        it("Should handle zero fee token withdrawal", async function () {
            // Mint tokens
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("1000"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Set fee parameters with native token
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseEther("0.01"), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Request transfer with fee
            await token.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseEther("100"),
                ethers.ZeroAddress, ethers.parseEther("0.01"),
                { value: ethers.parseEther("0.01") }
            );

            // Process request
            const processData = token.interface.encodeFunctionData("processTransferRequest", [1]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, processData, [rta1, rta2]);

            // Withdraw fees (testing fee withdrawal path)
            const withdrawData = token.interface.encodeFunctionData("withdrawFees", [
                ethers.ZeroAddress,
                ethers.parseEther("0.01"),
                await rtaProxy.getAddress()
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, withdrawData, [rta1, rta2]);
        });

        it("Should handle ERC20 fee token withdrawal", async function () {
            // Deploy mock ERC20
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const feeToken = await MockERC20.deploy("Fee Token", "FEE", 18);
            await feeToken.waitForDeployment();

            // Mint fee tokens to alice
            await feeToken.mint(alice.address, ethers.parseEther("100"));

            // Mint security tokens
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("1000"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Set fee with ERC20 token
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseEther("1"), [await feeToken.getAddress()]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Approve fee token
            await feeToken.connect(alice).approve(tokenAddress, ethers.parseEther("1"));

            // Request transfer with ERC20 fee
            await token.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseEther("100"),
                await feeToken.getAddress(), ethers.parseEther("1"),
                { value: 0 }
            );

            // Process
            const processData = token.interface.encodeFunctionData("processTransferRequest", [1]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, processData, [rta1, rta2]);

            // Withdraw ERC20 fees
            const withdrawData = token.interface.encodeFunctionData("withdrawFees", [
                await feeToken.getAddress(),
                ethers.parseEther("1"),
                await rtaProxy.getAddress()
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, withdrawData, [rta1, rta2]);
        });

        it("Should handle transfer request rejection with fee refund", async function () {
            // Mint tokens
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("1000"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Set fees
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseEther("0.01"), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Request transfer
            await token.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseEther("100"),
                ethers.ZeroAddress, ethers.parseEther("0.01"),
                { value: ethers.parseEther("0.01") }
            );

            // Reject with refund (reasonCode: 1 = generic rejection)
            const rejectData = token.interface.encodeFunctionData("rejectTransferRequest", [1, 1, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, rejectData, [rta1, rta2]);
        });

        it("Should handle transfer request rejection without refund", async function () {
            // Mint tokens
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("1000"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Set fees
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseEther("0.01"), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Request transfer
            await token.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseEther("100"),
                ethers.ZeroAddress, ethers.parseEther("0.01"),
                { value: ethers.parseEther("0.01") }
            );

            // Reject without refund (reasonCode: 2 = compliance issue)
            const rejectData = token.interface.encodeFunctionData("rejectTransferRequest", [1, 2, false]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, rejectData, [rta1, rta2]);
        });
    });

    describe("ERC1450 - Regulation Edge Cases", function () {

        it("Should handle burnFromRegulation with exact balance", async function () {
            // Mint tokens
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("100"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Burn exact amount from regulation
            const burnData = token.interface.encodeFunctionData("burnFromRegulation", [
                alice.address, ethers.parseEther("100"), REG_US_A
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData, [rta1, rta2]);

            expect(await token.balanceOf(alice.address)).to.equal(0);
        });

        it("Should handle mint with different regulations to same address", async function () {
            // Mint REG_US_A
            const mintData1 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("100"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData1, [rta1, rta2]);

            // Mint REG_US_CF
            const mintData2 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("200"), REG_US_CF, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData2, [rta1, rta2]);

            // Mint REG_US_D
            const mintData3 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("300"), REG_US_D, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData3, [rta1, rta2]);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("600"));
        });

        it("Should handle batch operations with single item", async function () {
            // Batch mint with single recipient
            const batchMintData = token.interface.encodeFunctionData("batchMint", [
                [alice.address],
                [ethers.parseEther("100")],
                [REG_US_A],
                [issuanceDate1]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, batchMintData, [rta1, rta2]);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("100"));
        });
    });

    describe("ERC1450Upgradeable - Additional Coverage", function () {

        it("Should handle court order with frozen account", async function () {
            // Mint tokens
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("500"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);

            // Freeze alice's account
            const freezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [alice.address, true]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, freezeData, [rta1, rta2]);

            // Execute court order (should work even if account is frozen)
            const courtOrderData = tokenUpgradeable.interface.encodeFunctionData("executeCourtOrder", [
                alice.address, bob.address, ethers.parseEther("200"),
                ethers.keccak256(ethers.toUtf8Bytes("court-order-frozen"))
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, courtOrderData, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(ethers.parseEther("200"));
        });

        it("Should handle multiple transfer requests", async function () {
            // Mint tokens
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("1000"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);

            // Set fees
            const setFeeData = tokenUpgradeable.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseEther("0.01"), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, setFeeData, [rta1, rta2]);

            // Create multiple requests
            await tokenUpgradeable.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseEther("100"),
                ethers.ZeroAddress, ethers.parseEther("0.01"),
                { value: ethers.parseEther("0.01") }
            );

            await tokenUpgradeable.connect(alice).requestTransferWithFee(
                alice.address, carol.address, ethers.parseEther("150"),
                ethers.ZeroAddress, ethers.parseEther("0.01"),
                { value: ethers.parseEther("0.01") }
            );

            // Process first request
            const processData1 = tokenUpgradeable.interface.encodeFunctionData("processTransferRequest", [1]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, processData1, [rta1, rta2]);

            // Reject second request (reasonCode: 1 = generic rejection)
            const rejectData2 = tokenUpgradeable.interface.encodeFunctionData("rejectTransferRequest", [2, 1, true]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, rejectData2, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(ethers.parseEther("100"));
            expect(await tokenUpgradeable.balanceOf(carol.address)).to.equal(0);
        });

        it("Should handle batch operations with maximum allowed size", async function () {
            // Create arrays with 100 items (maximum batch size)
            const recipients = [];
            const amounts = [];
            const regulations = [];
            const dates = [];

            for (let i = 0; i < 100; i++) {
                recipients.push(alice.address);
                amounts.push(ethers.parseEther("1"));
                regulations.push(REG_US_A);
                dates.push(issuanceDate1);
            }

            const batchMintData = tokenUpgradeable.interface.encodeFunctionData("batchMint", [
                recipients, amounts, regulations, dates
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, batchMintData, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseEther("100"));
        });

        it("Should handle burnFrom with multiple batches", async function () {
            // Mint with multiple batches
            const mintData1 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("100"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData1, [rta1, rta2]);

            const mintData2 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("200"), REG_US_A, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData2, [rta1, rta2]);

            // Burn tokens (FIFO from oldest batch first)
            const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseEther("150")
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseEther("150"));
        });
    });

    describe("RTAProxy - Additional Edge Cases", function () {

        it("Should handle internal wallet operations", async function () {
            const rtaAddress = await rtaProxy.getAddress();

            // Add internal wallet
            const addWalletData = rtaProxy.interface.encodeFunctionData("addInternalWallet", [alice.address]);
            await submitAndConfirmOperation(rtaProxy, rtaAddress, addWalletData, [rta1, rta2]);

            expect(await rtaProxy.isInternalWallet(alice.address)).to.be.true;

            // Remove internal wallet
            const removeWalletData = rtaProxy.interface.encodeFunctionData("removeInternalWallet", [alice.address]);
            await submitAndConfirmOperation(rtaProxy, rtaAddress, removeWalletData, [rta1, rta2]);

            expect(await rtaProxy.isInternalWallet(alice.address)).to.be.false;
        });

        it("Should handle signer operations", async function () {
            const rtaAddress = await rtaProxy.getAddress();

            // Add new signer
            const addSignerData = rtaProxy.interface.encodeFunctionData("addSigner", [alice.address]);
            await submitAndConfirmOperation(rtaProxy, rtaAddress, addSignerData, [rta1, rta2]);

            // Remove old signer
            const removeSignerData = rtaProxy.interface.encodeFunctionData("removeSigner", [rta2.address]);
            await submitAndConfirmOperation(rtaProxy, rtaAddress, removeSignerData, [rta1, alice]);

            const signers = await rtaProxy.getSigners();
            expect(signers).to.include(alice.address);
            expect(signers).to.not.include(rta2.address);
        });
    });
});
