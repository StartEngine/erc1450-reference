const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Coverage Boost Tests", function () {
    // Common regulation constants
    const REG_US_A = 0x0001;
    const REG_US_CF = 0x0002;
    const REG_US_D = 0x0003;
    const issuanceDate1 = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago
    const issuanceDate2 = Math.floor(Date.now() / 1000) - 86400 * 60; // 60 days ago

    let ERC1450, token, tokenAddress;
    let ERC1450Upgradeable, tokenUpgradeable, tokenUpgradeableAddress;
    let RTAProxy, rtaProxy;
    let RTAProxyUpgradeable, rtaProxyUpgradeable, rtaProxyUpgradeableAddress;
    let owner, rta1, rta2, rta3, alice, bob, carol, broker;

    async function submitAndConfirmOperation(proxy, target, data, signers) {
        const tx = await proxy.connect(signers[0]).submitOperation(target, data, 0);
        const receipt = await tx.wait();
        const event = receipt.logs.find(log => {
            try {
                const parsed = proxy.interface.parseLog(log);
                return parsed && parsed.name === "OperationSubmitted";
            } catch {
                return false;
            }
        });
        const opId = event ? proxy.interface.parseLog(event).args.operationId : 0;

        if (signers[1]) {
            await proxy.connect(signers[1]).confirmOperation(opId);
        }
        return opId;
    }

    beforeEach(async function () {
        [owner, rta1, rta2, rta3, alice, bob, carol, broker] = await ethers.getSigners();

        // Deploy RTAProxy
        RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy([rta1.address, rta2.address, rta3.address], 2);
        await rtaProxy.waitForDeployment();

        // Deploy ERC1450
        ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy("Test Token", "TST", 18, owner.address, rtaProxy.target);
        await token.waitForDeployment();
        tokenAddress = await token.getAddress();

        // Deploy upgradeable versions
        RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
        rtaProxyUpgradeable = await upgrades.deployProxy(
            RTAProxyUpgradeable,
            [[rta1.address, rta2.address, rta3.address], 2],
            { kind: "uups" }
        );
        await rtaProxyUpgradeable.waitForDeployment();
        rtaProxyUpgradeableAddress = await rtaProxyUpgradeable.getAddress();

        ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
        tokenUpgradeable = await upgrades.deployProxy(
            ERC1450Upgradeable,
            ["Test Token Upgradeable", "TSTU", 18, owner.address, rtaProxyUpgradeableAddress],
            { kind: "uups" }
        );
        await tokenUpgradeable.waitForDeployment();
        tokenUpgradeableAddress = await tokenUpgradeable.getAddress();
    });

    describe("Batch Cleanup Coverage", function () {
        it("Should cleanup empty batches after complete transfers", async function () {
            // Mint multiple batches
            const mintData1 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("100"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData1, [rta1, rta2]);

            const mintData2 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("200"), REG_US_CF, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData2, [rta1, rta2]);

            // Transfer entire first batch
            const transferData = token.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, bob.address, ethers.parseEther("100"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, transferData, [rta1, rta2]);

            // Check that batch was cleaned up
            const details = await token.getHolderRegulations(alice.address);
            expect(details.regulationTypes.length).to.equal(1);
            expect(details.regulationTypes[0]).to.equal(REG_US_CF);
        });

        it("Should handle multiple empty batch cleanup", async function () {
            // Create multiple small batches
            for (let i = 0; i < 3; i++) {
                const mintData = token.interface.encodeFunctionData("mint", [
                    alice.address, ethers.parseEther("10"), REG_US_A, issuanceDate1 + i
                ]);
                await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);
            }

            // Transfer all tokens from all batches
            for (let i = 0; i < 3; i++) {
                const transferData = token.interface.encodeFunctionData("transferFromRegulated", [
                    alice.address, bob.address, ethers.parseEther("10"), REG_US_A, issuanceDate1 + i
                ]);
                await submitAndConfirmOperation(rtaProxy, tokenAddress, transferData, [rta1, rta2]);
            }

            // Verify all batches cleaned up
            const details = await token.getHolderRegulations(alice.address);
            expect(details.regulationTypes.length).to.equal(0);
        });
    });

    describe("Edge Cases and Error Conditions", function () {
        it("Should handle getDetailedBatchInfo for empty address", async function () {
            const details = await token.getDetailedBatchInfo(alice.address);
            expect(details.count).to.equal(0);
        });


        it("Should test fee operations with zero fees", async function () {
            // Mint tokens
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("100"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Set zero fee
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, 0, [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Request transfer with zero fee
            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseEther("50"),
                ethers.ZeroAddress,
                0
            );

            // Process request
            const processData = token.interface.encodeFunctionData("processTransferRequest", [1, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, processData, [rta1, rta2]);

            expect(await token.balanceOf(bob.address)).to.equal(ethers.parseEther("50"));
        });
    });

    describe("Transfer Request Status Coverage", function () {
        it("Should test transfer request processing", async function () {
            // Setup
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("1000"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseEther("0.01"), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Create request
            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseEther("100"),
                ethers.ZeroAddress,
                ethers.parseEther("0.01"),
                { value: ethers.parseEther("0.01") }
            );

            // Process the request directly
            const processData = token.interface.encodeFunctionData("processTransferRequest", [1, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, processData, [rta1, rta2]);

            // Verify transfer completed
            expect(await token.balanceOf(bob.address)).to.equal(ethers.parseEther("100"));
        });

        it("Should test transfer rejection with refund", async function () {
            // Setup
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("100"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseEther("0.01"), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Create request
            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseEther("50"),
                ethers.ZeroAddress,
                ethers.parseEther("0.01"),
                { value: ethers.parseEther("0.01") }
            );

            const balanceBefore = await ethers.provider.getBalance(alice.address);

            // Reject with refund
            const rejectData = token.interface.encodeFunctionData("rejectTransferRequest", [1, 1, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, rejectData, [rta1, rta2]);

            const balanceAfter = await ethers.provider.getBalance(alice.address);
            expect(balanceAfter).to.be.gt(balanceBefore); // Refund received
        });
    });

    describe("Upgradeable Contract Coverage", function () {

        it("Should test court order execution", async function () {
            // Mint tokens
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("100"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);

            const documentHash = ethers.keccak256(ethers.toUtf8Bytes("court-order"));

            // Execute court order
            const courtOrderData = tokenUpgradeable.interface.encodeFunctionData("executeCourtOrder", [
                alice.address, bob.address, ethers.parseEther("50"), documentHash
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, courtOrderData, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(ethers.parseEther("50"));
        });
    });

    describe("RTAProxy Coverage", function () {
        it("Should test operation with expired time-lock", async function () {
            // Mint enough tokens for high-value transfer
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("2000000"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Submit high-value transfer (1M tokens = threshold, will require time-lock)
            const transferData = token.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, bob.address, ethers.parseEther("1000000"), REG_US_A, issuanceDate1
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, transferData, 0);

            // Try to confirm immediately (should fail due to time-lock)
            await expect(
                rtaProxy.connect(rta2).confirmOperation(1)
            ).to.be.revertedWithCustomError(rtaProxy, "TimeLockNotExpired");

            // Fast forward time
            await time.increase(24 * 60 * 60 + 1); // 24 hours + 1 second

            // Now it should work
            await rtaProxy.connect(rta2).confirmOperation(1);
            expect(await token.balanceOf(bob.address)).to.equal(ethers.parseEther("1000000"));
        });

        it("Should test signer removal edge case", async function () {
            const rtaProxyAddress = await rtaProxy.getAddress();

            // Remove signer
            const removeData = rtaProxy.interface.encodeFunctionData("removeSigner", [rta3.address]);
            await submitAndConfirmOperation(rtaProxy, rtaProxyAddress, removeData, [rta1, rta2]);

            // Verify signer removed
            const signers = await rtaProxy.getSigners();
            expect(signers).to.not.include(rta3.address);
            expect(signers.length).to.equal(2);
        });
    });

    describe("Complex Multi-Batch Scenarios", function () {
        it("Should handle regulation-specific burns and transfers", async function () {
            // Create complex token distribution
            const mintData1 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("100"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData1, [rta1, rta2]);

            const mintData2 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("200"), REG_US_CF, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData2, [rta1, rta2]);

            const mintData3 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("150"), REG_US_A, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData3, [rta1, rta2]);

            // Burn from specific regulation
            const burnRegData = token.interface.encodeFunctionData("burnFromRegulation", [
                alice.address, ethers.parseEther("50"), REG_US_CF
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnRegData, [rta1, rta2]);

            // Transfer from specific batch
            const transferData = token.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, bob.address, ethers.parseEther("100"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, transferData, [rta1, rta2]);

            // Verify final state
            const aliceDetails = await token.getHolderRegulations(alice.address);
            let totalRemaining = 0n;
            for (let amount of aliceDetails.amounts) {
                totalRemaining += amount;
            }
            expect(totalRemaining).to.equal(ethers.parseEther("300")); // 450 - 50 - 100
        });
    });
});