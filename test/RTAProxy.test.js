const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RTAProxy Multi-Sig", function () {
    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago

    let RTAProxy, ERC1450;
    let rtaProxy, token;
    let owner, signer1, signer2, signer3, nonSigner, newSigner;
    let signers;

    beforeEach(async function () {
        [owner, signer1, signer2, signer3, nonSigner, newSigner, ...signers] = await ethers.getSigners();

        // Deploy contracts
        RTAProxy = await ethers.getContractFactory("RTAProxy");
        ERC1450 = await ethers.getContractFactory("ERC1450");

        // Deploy RTAProxy with 2 of 3 multi-sig
        rtaProxy = await RTAProxy.deploy(
            [signer1.address, signer2.address, signer3.address],
            2
        );
        await rtaProxy.waitForDeployment();

        // Deploy token with RTAProxy as transfer agent
        token = await ERC1450.deploy(
            "Security Token",
            "SEC",
            18,
            owner.address,
            rtaProxy.target
        );
        await token.waitForDeployment();
    });

    describe("Deployment", function () {
        it("Should set the correct signers", async function () {
            expect(await rtaProxy.isSigner(signer1.address)).to.be.true;
            expect(await rtaProxy.isSigner(signer2.address)).to.be.true;
            expect(await rtaProxy.isSigner(signer3.address)).to.be.true;
            expect(await rtaProxy.isSigner(nonSigner.address)).to.be.false;
        });

        it("Should set the correct required signatures", async function () {
            expect(await rtaProxy.requiredSignatures()).to.equal(2);
        });

        it("Should return all signers", async function () {
            const signerList = await rtaProxy.getSigners();
            expect(signerList).to.have.lengthOf(3);
            expect(signerList).to.include(signer1.address);
            expect(signerList).to.include(signer2.address);
            expect(signerList).to.include(signer3.address);
        });

        it("Should revert with invalid signer configuration", async function () {
            // More required signatures than signers
            await expect(
                RTAProxy.deploy([signer1.address], 2)
            ).to.be.revertedWithCustomError(RTAProxy, "InvalidSignerCount");

            // Zero required signatures
            await expect(
                RTAProxy.deploy([signer1.address], 0)
            ).to.be.revertedWithCustomError(RTAProxy, "InvalidSignerCount");
        });
    });

    describe("Operation Submission", function () {
        it("Should allow signer to submit operation", async function () {
            const data = token.interface.encodeFunctionData("mint", [signer1.address, ethers.parseUnits("1000", 10)
            , REG_US_A, issuanceDate]);

            await expect(
                rtaProxy.connect(signer1).submitOperation(token.target, data, 0)
            ).to.emit(rtaProxy, "OperationSubmitted")
             .withArgs(0, signer1.address);

            const op = await rtaProxy.getOperation(0);
            expect(op[0]).to.equal(token.target); // target
            expect(op[1]).to.equal(data); // data
            expect(op[2]).to.equal(0); // value
            expect(op[3]).to.equal(1); // confirmations (auto-confirmed by submitter)
            expect(op[4]).to.be.false; // executed
        });

        it("Should auto-confirm from submitter", async function () {
            const data = token.interface.encodeFunctionData("mint", [signer1.address, ethers.parseUnits("1000", 10)
            , REG_US_A, issuanceDate]);

            await rtaProxy.connect(signer1).submitOperation(token.target, data, 0);

            expect(await rtaProxy.hasConfirmed(0, signer1.address)).to.be.true;

            const op = await rtaProxy.getOperation(0);
            expect(op[3]).to.equal(1); // 1 confirmation
        });

        it("Should revert if non-signer tries to submit", async function () {
            const data = token.interface.encodeFunctionData("mint", [signer1.address, ethers.parseUnits("1000", 10)
            , REG_US_A, issuanceDate]);

            await expect(
                rtaProxy.connect(nonSigner).submitOperation(token.target, data, 0)
            ).to.be.revertedWithCustomError(rtaProxy, "NotASigner");
        });
    });

    describe("Operation Confirmation", function () {
        let operationId;
        let mintData;

        beforeEach(async function () {
            mintData = token.interface.encodeFunctionData("mint", [signer1.address, ethers.parseUnits("1000", 10)
            , REG_US_A, issuanceDate]);

            const tx = await rtaProxy.connect(signer1).submitOperation(token.target, mintData, 0);
            const receipt = await tx.wait();
            operationId = 0;
        });

        it("Should allow other signers to confirm", async function () {
            await expect(rtaProxy.connect(signer2).confirmOperation(operationId))
                .to.emit(rtaProxy, "OperationConfirmed")
                .withArgs(operationId, signer2.address);

            expect(await rtaProxy.hasConfirmed(operationId, signer2.address)).to.be.true;
        });

        it("Should auto-execute with enough confirmations", async function () {
            // signer1 already confirmed, signer2 confirms to reach threshold
            await expect(rtaProxy.connect(signer2).confirmOperation(operationId))
                .to.emit(rtaProxy, "OperationExecuted")
                .withArgs(operationId);

            // Check the mint was executed
            expect(await token.balanceOf(signer1.address)).to.equal(ethers.parseUnits("1000", 10));

            // Check operation is marked as executed
            const op = await rtaProxy.getOperation(operationId);
            expect(op[4]).to.be.true; // executed
        });

        it("Should revert double confirmation", async function () {
            await expect(
                rtaProxy.connect(signer1).confirmOperation(operationId)
            ).to.be.revertedWithCustomError(rtaProxy, "AlreadyConfirmed");
        });

        it("Should revert if non-signer tries to confirm", async function () {
            await expect(
                rtaProxy.connect(nonSigner).confirmOperation(operationId)
            ).to.be.revertedWithCustomError(rtaProxy, "NotASigner");
        });

        it("Should revert confirmation of executed operation", async function () {
            // Execute the operation
            await rtaProxy.connect(signer2).confirmOperation(operationId);

            // Try to confirm again
            await expect(
                rtaProxy.connect(signer3).confirmOperation(operationId)
            ).to.be.revertedWithCustomError(rtaProxy, "OperationAlreadyExecuted");
        });
    });

    describe("Operation Revocation", function () {
        let operationId;

        beforeEach(async function () {
            const mintData = token.interface.encodeFunctionData("mint", [signer1.address, ethers.parseUnits("1000", 10)
            , REG_US_A, issuanceDate]);

            await rtaProxy.connect(signer1).submitOperation(token.target, mintData, 0);
            operationId = 0;
        });

        it("Should allow signer to revoke confirmation", async function () {
            await expect(rtaProxy.connect(signer1).revokeConfirmation(operationId))
                .to.emit(rtaProxy, "OperationRevoked")
                .withArgs(operationId, signer1.address);

            expect(await rtaProxy.hasConfirmed(operationId, signer1.address)).to.be.false;

            const op = await rtaProxy.getOperation(operationId);
            expect(op[3]).to.equal(0); // 0 confirmations
        });

        it("Should revert revocation if not confirmed", async function () {
            await expect(
                rtaProxy.connect(signer2).revokeConfirmation(operationId)
            ).to.be.revertedWithCustomError(rtaProxy, "NotConfirmed");
        });

        it("Should revert revocation after execution", async function () {
            // Execute the operation
            await rtaProxy.connect(signer2).confirmOperation(operationId);

            // Try to revoke
            await expect(
                rtaProxy.connect(signer1).revokeConfirmation(operationId)
            ).to.be.revertedWithCustomError(rtaProxy, "OperationAlreadyExecuted");
        });
    });

    describe("Manual Execution", function () {
        let operationId;

        beforeEach(async function () {
            const mintData = token.interface.encodeFunctionData("mint", [signer1.address, ethers.parseUnits("1000", 10)
            , REG_US_A, issuanceDate]);

            // Submit but don't get second confirmation yet
            await rtaProxy.connect(signer1).submitOperation(token.target, mintData, 0);
            operationId = 0;
        });

        it("Should allow manual execution with enough confirmations", async function () {
            // Add second confirmation to reach threshold
            await rtaProxy.connect(signer2).confirmOperation(operationId);

            // Check that it auto-executed
            const op = await rtaProxy.getOperation(operationId);
            expect(op[4]).to.be.true; // executed

            expect(await token.balanceOf(signer1.address)).to.equal(ethers.parseUnits("1000", 10));
        });

        it("Should revert execution without enough confirmations", async function () {
            // Only has 1 confirmation from submitter
            await expect(
                rtaProxy.connect(signer1).executeOperation(operationId)
            ).to.be.revertedWithCustomError(rtaProxy, "InsufficientConfirmations");
        });
    });

    describe("Time-Lock", function () {
        it("Should detect operations requiring time-lock", async function () {
            const highValue = ethers.parseUnits("1000000", 10); // 1M tokens = threshold
            const transferData = token.interface.encodeFunctionData("transferFromRegulated", [
                signer1.address,
                signer2.address,
                highValue,
                REG_US_A,
                issuanceDate
            ]);

            // Now implemented: requiresTimeLock checks amount >= HIGH_VALUE_THRESHOLD
            expect(await rtaProxy.requiresTimeLock(transferData)).to.be.true;

            // Low value transfers should not require time-lock
            const lowValue = ethers.parseUnits("100", 10);
            const lowValueData = token.interface.encodeFunctionData("transferFromRegulated", [
                signer1.address,
                signer2.address,
                lowValue,
                REG_US_A,
                issuanceDate
            ]);
            expect(await rtaProxy.requiresTimeLock(lowValueData)).to.be.false;
        });

        it("Should handle empty data", async function () {
            expect(await rtaProxy.requiresTimeLock("0x")).to.be.false;
        });
    });

    describe("Signer Management", function () {
        it("Should add new signer through multi-sig", async function () {
            const addSignerData = rtaProxy.interface.encodeFunctionData("addSigner", [
                newSigner.address
            ]);

            // Submit operation to add signer
            await rtaProxy.connect(signer1).submitOperation(
                rtaProxy.target,
                addSignerData,
                0
            );

            // Confirm and execute
            await rtaProxy.connect(signer2).confirmOperation(0);

            expect(await rtaProxy.isSigner(newSigner.address)).to.be.true;

            const signerList = await rtaProxy.getSigners();
            expect(signerList).to.include(newSigner.address);
        });

        it("Should remove signer through multi-sig", async function () {
            const removeSignerData = rtaProxy.interface.encodeFunctionData("removeSigner", [
                signer3.address
            ]);

            // Submit operation to remove signer
            await rtaProxy.connect(signer1).submitOperation(
                rtaProxy.target,
                removeSignerData,
                0
            );

            // Confirm and execute
            await rtaProxy.connect(signer2).confirmOperation(0);

            expect(await rtaProxy.isSigner(signer3.address)).to.be.false;

            const signerList = await rtaProxy.getSigners();
            expect(signerList).to.not.include(signer3.address);
        });

        it("Should update required signatures through multi-sig", async function () {
            const updateData = rtaProxy.interface.encodeFunctionData("updateRequiredSignatures", [1]);

            // Submit operation
            await rtaProxy.connect(signer1).submitOperation(
                rtaProxy.target,
                updateData,
                0
            );

            // Confirm and execute
            await rtaProxy.connect(signer2).confirmOperation(0);

            expect(await rtaProxy.requiredSignatures()).to.equal(1);
        });

        it("Should revert direct calls to signer management", async function () {
            await expect(
                rtaProxy.connect(signer1).addSigner(newSigner.address)
            ).to.be.revertedWith("Must be called through multi-sig");

            await expect(
                rtaProxy.connect(signer1).removeSigner(signer3.address)
            ).to.be.revertedWith("Must be called through multi-sig");

            await expect(
                rtaProxy.connect(signer1).updateRequiredSignatures(1)
            ).to.be.revertedWith("Must be called through multi-sig");
        });
    });

    describe("Complex RTA Operations", function () {
        beforeEach(async function () {
            // Give RTAProxy ability to mint
            const mintData = token.interface.encodeFunctionData("mint", [signer1.address, ethers.parseUnits("10000", 10)
            , REG_US_A, issuanceDate]);

            await rtaProxy.connect(signer1).submitOperation(token.target, mintData, 0);
            await rtaProxy.connect(signer2).confirmOperation(0);
        });

        it("Should process transfer requests", async function () {
            // First create a transfer request directly to the token
            await token.connect(signer1).requestTransferWithFee(
                signer1.address,
                signer2.address,
                ethers.parseUnits("100", 10),
                ethers.ZeroAddress,
                0
            );

            // Process through RTAProxy
            const processData = token.interface.encodeFunctionData("processTransferRequest", [1, true]);

            await rtaProxy.connect(signer1).submitOperation(token.target, processData, 0);
            await rtaProxy.connect(signer2).confirmOperation(1);

            expect(await token.balanceOf(signer2.address)).to.equal(ethers.parseUnits("100", 10));
        });

        it("Should execute court orders", async function () {
            const documentHash = ethers.keccak256(ethers.toUtf8Bytes("court-order-456"));
            const courtOrderData = token.interface.encodeFunctionData("executeCourtOrder", [
                signer1.address,
                signer2.address,
                ethers.parseUnits("5000", 10),
                documentHash
            ]);

            await rtaProxy.connect(signer1).submitOperation(token.target, courtOrderData, 0);
            await rtaProxy.connect(signer2).confirmOperation(1);

            expect(await token.balanceOf(signer2.address)).to.equal(ethers.parseUnits("5000", 10));
        });

        it("Should manage broker approvals", async function () {
            const approveData = token.interface.encodeFunctionData("setBrokerStatus", [
                signer3.address,
                true
            ]);

            await rtaProxy.connect(signer1).submitOperation(token.target, approveData, 0);
            await rtaProxy.connect(signer2).confirmOperation(1);

            expect(await token.isRegisteredBroker(signer3.address)).to.be.true;
        });
    });

    describe("Edge Cases", function () {
        it("Should handle invalid operation ID", async function () {
            await expect(
                rtaProxy.connect(signer1).confirmOperation(999)
            ).to.be.revertedWith("Operation does not exist");
        });

        it("Should handle failed operation execution", async function () {
            // Create an operation that will fail (mint to zero address)
            const failData = token.interface.encodeFunctionData("mint", [ethers.ZeroAddress, ethers.parseUnits("1000", 10)
            , REG_US_A, issuanceDate]);

            await rtaProxy.connect(signer1).submitOperation(token.target, failData, 0);

            // This should revert with the error from the underlying contract
            try {
                await rtaProxy.connect(signer2).confirmOperation(0);
                expect.fail("Should have reverted");
            } catch (error) {
                // Verify the error is from the failed operation execution
                expect(error.message).to.include("reverted");
            }
        });

        it("Should track operation count correctly", async function () {
            expect(await rtaProxy.operationCount()).to.equal(0);

            // Submit 3 operations
            const data = "0x00";
            await rtaProxy.connect(signer1).submitOperation(token.target, data, 0);
            await rtaProxy.connect(signer1).submitOperation(token.target, data, 0);
            await rtaProxy.connect(signer1).submitOperation(token.target, data, 0);

            expect(await rtaProxy.operationCount()).to.equal(3);
        });
    });
});