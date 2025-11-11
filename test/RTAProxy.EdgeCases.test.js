const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RTAProxy Edge Cases & Additional Coverage", function () {
    let RTAProxy, rtaProxy;
    let signer1, signer2, signer3, nonSigner;

    beforeEach(async function () {
        [signer1, signer2, signer3, nonSigner] = await ethers.getSigners();

        RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy(
            [signer1.address, signer2.address, signer3.address],
            2 // 2 of 3 required
        );
        await rtaProxy.waitForDeployment();
    });

    describe("Signer Management Edge Cases", function () {
        // Note: The following error paths (AlreadyASigner, NotASigner, InvalidSignerCount)
        // are covered implicitly through the comprehensive test suite in RTAProxy.test.js
        // These tests focus on successful operations to improve overall coverage

        it("Should successfully add a new signer", async function () {
            // Encode the addSigner call for a new address
            const newSigner = nonSigner.address;
            const addSignerData = rtaProxy.interface.encodeFunctionData("addSigner", [
                newSigner
            ]);

            // Submit and confirm operation
            const tx = await rtaProxy.connect(signer1).submitOperation(
                rtaProxy.target,
                addSignerData,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                } catch {
                    return false;
                }
            });
            const operationId = rtaProxy.interface.parseLog(event).args.operationId;

            // Confirm with second signer (should auto-execute)
            await rtaProxy.connect(signer2).confirmOperation(operationId);

            // Verify new signer was added
            expect(await rtaProxy.isSigner(newSigner)).to.be.true;
            const signers = await rtaProxy.getSigners();
            expect(signers).to.include(newSigner);
        });

        it("Should successfully remove a signer", async function () {
            // Encode the removeSigner call
            const removeSignerData = rtaProxy.interface.encodeFunctionData("removeSigner", [
                signer3.address
            ]);

            // Submit and confirm operation
            const tx = await rtaProxy.connect(signer1).submitOperation(
                rtaProxy.target,
                removeSignerData,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                } catch {
                    return false;
                }
            });
            const operationId = rtaProxy.interface.parseLog(event).args.operationId;

            // Confirm with second signer (should auto-execute)
            await rtaProxy.connect(signer2).confirmOperation(operationId);

            // Verify signer was removed
            expect(await rtaProxy.isSigner(signer3.address)).to.be.false;
            const signers = await rtaProxy.getSigners();
            expect(signers).to.not.include(signer3.address);
        });

        it("Should successfully update required signatures", async function () {
            // Encode the updateRequiredSignatures call
            const updateData = rtaProxy.interface.encodeFunctionData("updateRequiredSignatures", [
                3 // Change from 2 to 3
            ]);

            // Submit and confirm operation
            const tx = await rtaProxy.connect(signer1).submitOperation(
                rtaProxy.target,
                updateData,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                } catch {
                    return false;
                }
            });
            const operationId = rtaProxy.interface.parseLog(event).args.operationId;

            // Confirm with second signer (should auto-execute)
            await rtaProxy.connect(signer2).confirmOperation(operationId);

            // Verify required signatures was updated
            expect(await rtaProxy.requiredSignatures()).to.equal(3);
        });
    });

    describe("Operation Query Functions", function () {
        it("Should return correct operation details", async function () {
            // Submit a simple operation
            const targetAddress = signer1.address;
            const callData = "0x";
            const value = ethers.parseEther("0");

            const tx = await rtaProxy.connect(signer1).submitOperation(
                targetAddress,
                callData,
                value
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                } catch {
                    return false;
                }
            });
            const operationId = rtaProxy.interface.parseLog(event).args.operationId;

            // Query operation
            const operation = await rtaProxy.getOperation(operationId);

            expect(operation.target).to.equal(targetAddress);
            expect(operation.data).to.equal(callData);
            expect(operation.value).to.equal(value);
            expect(operation.confirmations).to.equal(1); // Auto-confirmed by submitter
            expect(operation.executed).to.be.false;
        });

        it("Should show correct confirmation count after multiple confirmations", async function () {
            // Submit operation
            const tx = await rtaProxy.connect(signer1).submitOperation(
                signer1.address,
                "0x",
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                } catch {
                    return false;
                }
            });
            const operationId = rtaProxy.interface.parseLog(event).args.operationId;

            // Check after first confirmation (auto from submitter)
            let operation = await rtaProxy.getOperation(operationId);
            expect(operation.confirmations).to.equal(1);

            // Add second confirmation (should trigger execution for 2-of-3)
            await rtaProxy.connect(signer2).confirmOperation(operationId);

            operation = await rtaProxy.getOperation(operationId);
            expect(operation.confirmations).to.equal(2);
            expect(operation.executed).to.be.true;
        });
    });

    describe("Operation Existence Checks", function () {
        it("Should revert when querying non-existent operation", async function () {
            await expect(
                rtaProxy.getOperation(9999)
            ).to.be.revertedWith("Operation does not exist");
        });

        it("Should revert when confirming non-existent operation", async function () {
            await expect(
                rtaProxy.connect(signer1).confirmOperation(9999)
            ).to.be.revertedWith("Operation does not exist");
        });

        it("Should revert when revoking non-existent operation", async function () {
            await expect(
                rtaProxy.connect(signer1).revokeConfirmation(9999)
            ).to.be.revertedWith("Operation does not exist");
        });

        it("Should revert when executing non-existent operation", async function () {
            await expect(
                rtaProxy.connect(signer1).executeOperation(9999)
            ).to.be.revertedWith("Operation does not exist");
        });
    });
});
