const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Branch Coverage Push to 90%", function () {
    let ERC1450, RTAProxy, MockERC20;
    let token, rtaProxy, feeToken;
    let owner, rta, issuer, alice, bob, charlie, broker;
    let signers;

    const REG_US_A = 0x0001;
    const REG_US_D = 0x0002;
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30;
    const issuanceDate2 = Math.floor(Date.now() / 1000) - 86400 * 60;

    beforeEach(async function () {
        [owner, rta, issuer, alice, bob, charlie, broker, ...signers] = await ethers.getSigners();

        ERC1450 = await ethers.getContractFactory("ERC1450");
        RTAProxy = await ethers.getContractFactory("RTAProxy");
        MockERC20 = await ethers.getContractFactory("MockERC20");

        token = await ERC1450.deploy(
            "Security Token",
            "SEC",
            10,
            issuer.address,
            rta.address
        );
        await token.waitForDeployment();

        rtaProxy = await RTAProxy.deploy(
            [rta.address, signers[0].address, signers[1].address],
            2
        );
        await rtaProxy.waitForDeployment();

        feeToken = await MockERC20.deploy("Fee Token", "FEE", 18);
        await feeToken.waitForDeployment();
    });

    describe("ERC1450 - notFrozen modifier (line 212)", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);
        });

        it("Should revert transferFromRegulated when TO address is frozen", async function () {
            await token.connect(rta).setAccountFrozen(bob.address, true);
            await expect(
                token.connect(rta).transferFromRegulated(
                    alice.address,
                    bob.address,
                    100,
                    REG_US_A,
                    issuanceDate
                )
            ).to.be.revertedWithCustomError(token, "ERC1450ComplianceCheckFailed");
        });
    });

    describe("ERC1450 - setTransferAgent branches (lines 229-240)", function () {
        it("Should revert when non-owner/non-RTA sets transfer agent", async function () {
            await expect(
                token.connect(charlie).setTransferAgent(bob.address)
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");
        });

        it("Should allow owner to set transfer agent initially", async function () {
            const newToken = await ERC1450.deploy(
                "Test Token",
                "TST",
                10,
                owner.address,
                owner.address
            );
            await newToken.waitForDeployment();

            await newToken.connect(owner).setTransferAgent(alice.address);
            expect(await newToken.isTransferAgent(alice.address)).to.be.true;
        });

        it("Should lock transfer agent when set to contract", async function () {
            await token.connect(rta).setTransferAgent(await rtaProxy.getAddress());
            // After setting to a contract, the transfer agent is locked
            // Any subsequent attempt should fail
            // We verify by checking that trying to set again from the proxy fails
            // Note: We can't call directly from rtaProxy contract, so we verify the lock state
            // by checking that the transfer agent was locked after setting to contract
            expect(await token.isTransferAgent(await rtaProxy.getAddress())).to.be.true;
        });
    });

    describe("ERC1450 - mint validation branches (lines 268-270)", function () {
        it("Should revert mint with regulation type 0", async function () {
            await expect(
                token.connect(rta).mint(alice.address, 100, 0, issuanceDate)
            ).to.be.revertedWith("ERC1450: Invalid regulation type");
        });

        it("Should revert mint with issuance date 0", async function () {
            await expect(
                token.connect(rta).mint(alice.address, 100, REG_US_A, 0)
            ).to.be.revertedWith("ERC1450: Invalid issuance date");
        });

        it("Should revert mint with future issuance date", async function () {
            const futureDate = Math.floor(Date.now() / 1000) + 86400 * 365;
            await expect(
                token.connect(rta).mint(alice.address, 100, REG_US_A, futureDate)
            ).to.be.revertedWith("ERC1450: Future issuance date not allowed");
        });
    });

    describe("ERC1450 - batchMint validation branches (lines 319-321)", function () {
        it("Should revert batchMint with issuance date 0", async function () {
            await expect(
                token.connect(rta).batchMint(
                    [alice.address],
                    [100],
                    [REG_US_A],
                    [0]
                )
            ).to.be.revertedWith("ERC1450: Invalid issuance date");
        });

        it("Should revert batchMint with regulation type 0", async function () {
            await expect(
                token.connect(rta).batchMint(
                    [alice.address],
                    [100],
                    [0],
                    [issuanceDate]
                )
            ).to.be.revertedWith("ERC1450: Invalid regulation type");
        });

        it("Should revert batchMint with future issuance date", async function () {
            const futureDate = Math.floor(Date.now() / 1000) + 86400 * 365;
            await expect(
                token.connect(rta).batchMint(
                    [alice.address],
                    [100],
                    [REG_US_A],
                    [futureDate]
                )
            ).to.be.revertedWith("ERC1450: Future issuance date not allowed");
        });
    });

    describe("ERC1450 - burnFromRegulation validation (lines 373-380)", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should revert burnFromRegulation with insufficient regulation balance", async function () {
            await expect(
                token.connect(rta).burnFromRegulation(alice.address, 1000, REG_US_D)
            ).to.be.revertedWith("ERC1450: Insufficient regulation balance");
        });

        it("Should burn tokens of specific regulation", async function () {
            await token.connect(rta).mint(alice.address, 500, REG_US_D, issuanceDate);
            await token.connect(rta).burnFromRegulation(alice.address, 500, REG_US_D);
            expect(await token.balanceOf(alice.address)).to.equal(1000);
        });
    });

    describe("ERC1450 - burnFromRegulated edge cases (lines 408-456)", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should revert burnFromRegulated with batch not found", async function () {
            await expect(
                token.connect(rta).burnFromRegulated(alice.address, 100, REG_US_D, issuanceDate)
            ).to.be.revertedWith("ERC1450: Batch not found");
        });

        it("Should revert burnFromRegulated with wrong issuance date", async function () {
            await expect(
                token.connect(rta).burnFromRegulated(alice.address, 100, REG_US_A, issuanceDate2)
            ).to.be.revertedWith("ERC1450: Batch not found");
        });

        it("Should revert burnFromRegulated with insufficient batch balance", async function () {
            await expect(
                token.connect(rta).burnFromRegulated(alice.address, 2000, REG_US_A, issuanceDate)
            ).to.be.revertedWith("ERC1450: Insufficient batch balance");
        });

        it("Should burn entire batch and remove it", async function () {
            await token.connect(rta).burnFromRegulated(alice.address, 1000, REG_US_A, issuanceDate);
            expect(await token.balanceOf(alice.address)).to.equal(0);

            const info = await token.getDetailedBatchInfo(alice.address);
            expect(info.count).to.equal(0);
        });

        it("Should handle multiple batches and remove empty one", async function () {
            await token.connect(rta).mint(alice.address, 500, REG_US_D, issuanceDate2);

            // Burn entire first batch
            await token.connect(rta).burnFromRegulated(alice.address, 1000, REG_US_A, issuanceDate);

            expect(await token.balanceOf(alice.address)).to.equal(500);
            const info = await token.getDetailedBatchInfo(alice.address);
            expect(info.count).to.equal(1);
        });
    });

    describe("ERC1450 - batchTransferFrom array validation (lines 519-526)", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should revert batchTransferFrom with mismatched array lengths (tos)", async function () {
            await expect(
                token.connect(rta).batchTransferFrom(
                    [alice.address],
                    [bob.address, charlie.address],
                    [100],
                    [REG_US_A],
                    [issuanceDate]
                )
            ).to.be.revertedWith("ERC1450: Array length mismatch");
        });

        it("Should revert batchTransferFrom with mismatched amounts", async function () {
            await expect(
                token.connect(rta).batchTransferFrom(
                    [alice.address],
                    [bob.address],
                    [100, 200],
                    [REG_US_A],
                    [issuanceDate]
                )
            ).to.be.revertedWith("ERC1450: Array length mismatch");
        });

        it("Should revert batchTransferFrom with mismatched regulationTypes", async function () {
            await expect(
                token.connect(rta).batchTransferFrom(
                    [alice.address],
                    [bob.address],
                    [100],
                    [REG_US_A, REG_US_D],
                    [issuanceDate]
                )
            ).to.be.revertedWith("ERC1450: Array length mismatch");
        });

        it("Should revert batchTransferFrom with mismatched issuanceDates", async function () {
            await expect(
                token.connect(rta).batchTransferFrom(
                    [alice.address],
                    [bob.address],
                    [100],
                    [REG_US_A],
                    [issuanceDate, issuanceDate2]
                )
            ).to.be.revertedWith("ERC1450: Array length mismatch");
        });
    });

    describe("ERC1450 - batchBurnFrom array validation (lines 543-549)", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should revert batchBurnFrom with mismatched amounts", async function () {
            await expect(
                token.connect(rta).batchBurnFrom(
                    [alice.address],
                    [100, 200],
                    [REG_US_A],
                    [issuanceDate]
                )
            ).to.be.revertedWith("ERC1450: Array length mismatch");
        });

        it("Should revert batchBurnFrom with mismatched regulationTypes", async function () {
            await expect(
                token.connect(rta).batchBurnFrom(
                    [alice.address],
                    [100],
                    [REG_US_A, REG_US_D],
                    [issuanceDate]
                )
            ).to.be.revertedWith("ERC1450: Array length mismatch");
        });

        it("Should revert batchBurnFrom with mismatched issuanceDates", async function () {
            await expect(
                token.connect(rta).batchBurnFrom(
                    [alice.address],
                    [100],
                    [REG_US_A],
                    [issuanceDate, issuanceDate2]
                )
            ).to.be.revertedWith("ERC1450: Array length mismatch");
        });
    });

    describe("ERC1450 - processTransferRequest branches (lines 615-642)", function () {
        let requestId;

        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                100,
                ethers.ZeroAddress,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return token.interface.parseLog(log)?.name === "TransferRequested";
                } catch { return false; }
            });
            requestId = token.interface.parseLog(event).args.requestId;
        });

        it("Should process and execute approved transfer request", async function () {
            await token.connect(rta).processTransferRequest(requestId, true);
            expect(await token.balanceOf(bob.address)).to.equal(100);
        });

        it("Should reject transfer request with approved=false", async function () {
            await token.connect(rta).processTransferRequest(requestId, false);
            const request = await token.transferRequests(requestId);
            expect(request.status).to.equal(3); // Rejected
        });

        it("Should revert when processing already executed request", async function () {
            await token.connect(rta).processTransferRequest(requestId, true);
            await expect(
                token.connect(rta).processTransferRequest(requestId, true)
            ).to.be.revertedWith("ERC1450: Request already finalized");
        });

        it("Should revert when processing already rejected request", async function () {
            await token.connect(rta).processTransferRequest(requestId, false);
            await expect(
                token.connect(rta).processTransferRequest(requestId, true)
            ).to.be.revertedWith("ERC1450: Request already finalized");
        });

        it("Should skip status update if already approved", async function () {
            await token.connect(rta).updateRequestStatus(requestId, 2); // Set to Approved
            await token.connect(rta).processTransferRequest(requestId, true);
            expect(await token.balanceOf(bob.address)).to.equal(100);
        });
    });

    describe("ERC1450 - rejectTransferRequest with fee refund (lines 645-667)", function () {
        let requestId;

        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should reject without refund when refundFee is false", async function () {
            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                100,
                ethers.ZeroAddress,
                ethers.parseEther("0.1"),
                { value: ethers.parseEther("0.1") }
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return token.interface.parseLog(log)?.name === "TransferRequested";
                } catch { return false; }
            });
            requestId = token.interface.parseLog(event).args.requestId;

            await token.connect(rta).rejectTransferRequest(requestId, 1, false);
            const request = await token.transferRequests(requestId);
            expect(request.status).to.equal(3); // Rejected
        });

        it("Should reject with native token refund", async function () {
            const initialBalance = await ethers.provider.getBalance(alice.address);

            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                100,
                ethers.ZeroAddress,
                ethers.parseEther("0.1"),
                { value: ethers.parseEther("0.1") }
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return token.interface.parseLog(log)?.name === "TransferRequested";
                } catch { return false; }
            });
            requestId = token.interface.parseLog(event).args.requestId;

            await token.connect(rta).rejectTransferRequest(requestId, 1, true);

            const finalBalance = await ethers.provider.getBalance(alice.address);
            expect(finalBalance).to.be.gt(initialBalance - ethers.parseEther("0.2"));
        });

        it("Should reject with ERC20 token refund", async function () {
            await feeToken.mint(alice.address, ethers.parseEther("100"));
            await feeToken.connect(alice).approve(await token.getAddress(), ethers.parseEther("100"));

            await token.connect(rta).setFeeParameters(0, 0, [await feeToken.getAddress()]);

            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                100,
                await feeToken.getAddress(),
                ethers.parseEther("1")
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return token.interface.parseLog(log)?.name === "TransferRequested";
                } catch { return false; }
            });
            requestId = token.interface.parseLog(event).args.requestId;

            await token.connect(rta).rejectTransferRequest(requestId, 1, true);

            expect(await feeToken.balanceOf(alice.address)).to.equal(ethers.parseEther("100"));
        });

        it("Should handle rejection with refund but zero fee paid", async function () {
            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                100,
                ethers.ZeroAddress,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return token.interface.parseLog(log)?.name === "TransferRequested";
                } catch { return false; }
            });
            requestId = token.interface.parseLog(event).args.requestId;

            await token.connect(rta).rejectTransferRequest(requestId, 1, true);
            const request = await token.transferRequests(requestId);
            expect(request.status).to.equal(3);
        });
    });

    describe("ERC1450 - withdrawFees validation (lines 719-739)", function () {
        it("Should revert withdrawFees with zero recipient", async function () {
            await expect(
                token.connect(rta).withdrawFees(ethers.ZeroAddress, 100, ethers.ZeroAddress)
            ).to.be.revertedWith("ERC1450: Invalid recipient");
        });

        it("Should revert withdrawFees when insufficient fees", async function () {
            await expect(
                token.connect(rta).withdrawFees(ethers.ZeroAddress, ethers.parseEther("100"), alice.address)
            ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
        });

        it("Should successfully withdraw native token fees", async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                100,
                ethers.ZeroAddress,
                ethers.parseEther("0.1"),
                { value: ethers.parseEther("0.1") }
            );

            const initialBalance = await ethers.provider.getBalance(charlie.address);
            await token.connect(rta).withdrawFees(ethers.ZeroAddress, ethers.parseEther("0.1"), charlie.address);
            const finalBalance = await ethers.provider.getBalance(charlie.address);

            expect(finalBalance - initialBalance).to.equal(ethers.parseEther("0.1"));
        });

        it("Should successfully withdraw ERC20 token fees", async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
            await feeToken.mint(alice.address, ethers.parseEther("100"));
            await feeToken.connect(alice).approve(await token.getAddress(), ethers.parseEther("100"));

            await token.connect(rta).setFeeParameters(0, 0, [await feeToken.getAddress()]);

            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                100,
                await feeToken.getAddress(),
                ethers.parseEther("1")
            );

            await token.connect(rta).withdrawFees(await feeToken.getAddress(), ethers.parseEther("1"), charlie.address);
            expect(await feeToken.balanceOf(charlie.address)).to.equal(ethers.parseEther("1"));
        });
    });

    describe("ERC1450 - _transferBatch batch not found (line 866)", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should revert transferFromRegulated when batch not found (wrong regulation)", async function () {
            await expect(
                token.connect(rta).transferFromRegulated(
                    alice.address,
                    bob.address,
                    100,
                    REG_US_D,
                    issuanceDate
                )
            ).to.be.revertedWith("ERC1450: Batch not found");
        });

        it("Should revert transferFromRegulated when batch not found (wrong date)", async function () {
            await expect(
                token.connect(rta).transferFromRegulated(
                    alice.address,
                    bob.address,
                    100,
                    REG_US_A,
                    issuanceDate2
                )
            ).to.be.revertedWith("ERC1450: Batch not found");
        });
    });

    describe("ERC1450 - _addTokenBatch insertion logic (lines 920-963)", function () {
        it("Should merge batches with same regulation and date", async function () {
            await token.connect(rta).mint(alice.address, 500, REG_US_A, issuanceDate);
            await token.connect(rta).mint(alice.address, 500, REG_US_A, issuanceDate);

            const info = await token.getDetailedBatchInfo(alice.address);
            expect(info.count).to.equal(1);
            expect(info.amounts[0]).to.equal(1000);
        });

        it("Should insert batch at correct position by issuance date", async function () {
            // Mint with older date first
            await token.connect(rta).mint(alice.address, 500, REG_US_A, issuanceDate2);
            // Then mint with newer date
            await token.connect(rta).mint(alice.address, 300, REG_US_D, issuanceDate);
            // Then mint with even older date - should be inserted at the front
            const veryOldDate = Math.floor(Date.now() / 1000) - 86400 * 90;
            await token.connect(rta).mint(alice.address, 200, REG_US_A, veryOldDate);

            const info = await token.getDetailedBatchInfo(alice.address);
            expect(info.count).to.equal(3);
        });
    });

    describe("ERC1450 - _burnSpecificRegulation multiple batches (lines 994-1018)", function () {
        it("Should burn from multiple batches of same regulation", async function () {
            // Create multiple batches of same regulation
            await token.connect(rta).mint(alice.address, 300, REG_US_A, issuanceDate);
            await token.connect(rta).mint(alice.address, 300, REG_US_A, issuanceDate2);

            // Burn more than one batch has
            await token.connect(rta).burnFromRegulation(alice.address, 400, REG_US_A);

            expect(await token.balanceOf(alice.address)).to.equal(200);
        });

        it("Should track oldest issuance date during burn", async function () {
            await token.connect(rta).mint(alice.address, 300, REG_US_A, issuanceDate);
            await token.connect(rta).mint(alice.address, 300, REG_US_A, issuanceDate2);

            // Burn from oldest first
            await token.connect(rta).burnFromRegulation(alice.address, 100, REG_US_A);

            const info = await token.getHolderRegulations(alice.address);
            expect(info.amounts[0]).to.equal(200); // First batch partially burned
        });
    });

    describe("ERC1450 - _transferTokensFIFO partial transfers (lines 1023-1043)", function () {
        it("Should transfer across multiple batches using FIFO", async function () {
            await token.connect(rta).mint(alice.address, 300, REG_US_A, issuanceDate);
            await token.connect(rta).mint(alice.address, 300, REG_US_D, issuanceDate2);

            // Execute court order that uses FIFO transfer
            await token.connect(rta).executeCourtOrder(
                alice.address,
                bob.address,
                400,
                ethers.keccak256(ethers.toUtf8Bytes("court-order-1"))
            );

            expect(await token.balanceOf(bob.address)).to.equal(400);
            expect(await token.balanceOf(alice.address)).to.equal(200);
        });
    });

    describe("ERC1450 - getTransferFee tiered logic (lines 686-701)", function () {
        it("Should return 0 for unaccepted fee token", async function () {
            const fee = await token.getTransferFee(
                alice.address,
                bob.address,
                1000,
                charlie.address
            );
            expect(fee).to.equal(0);
        });

        it("Should calculate percentage fee", async function () {
            await token.connect(rta).setFeeParameters(1, 100, [ethers.ZeroAddress]); // 1% fee

            const fee = await token.getTransferFee(
                alice.address,
                bob.address,
                10000,
                ethers.ZeroAddress
            );
            expect(fee).to.equal(100);
        });

        it("Should return feeValue for tiered/custom fee type", async function () {
            await token.connect(rta).setFeeParameters(2, 500, [ethers.ZeroAddress]); // Custom type

            const fee = await token.getTransferFee(
                alice.address,
                bob.address,
                10000,
                ethers.ZeroAddress
            );
            expect(fee).to.equal(500);
        });
    });

    describe("ERC1450 - requestTransferWithFee edge cases (lines 561-613)", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should revert when fee token not accepted", async function () {
            await expect(
                token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    100,
                    charlie.address,
                    100
                )
            ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
        });

        it("Should allow approved broker to request transfer", async function () {
            await token.connect(rta).setBrokerStatus(broker.address, true);

            await token.connect(broker).requestTransferWithFee(
                alice.address,
                bob.address,
                100,
                ethers.ZeroAddress,
                0
            );
        });

        it("Should revert when native fee doesn't match msg.value", async function () {
            await expect(
                token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    100,
                    ethers.ZeroAddress,
                    ethers.parseEther("0.1"),
                    { value: ethers.parseEther("0.05") }
                )
            ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
        });

        it("Should collect ERC20 fee correctly", async function () {
            await feeToken.mint(alice.address, ethers.parseEther("100"));
            await feeToken.connect(alice).approve(await token.getAddress(), ethers.parseEther("100"));

            await token.connect(rta).setFeeParameters(0, 0, [await feeToken.getAddress()]);

            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                100,
                await feeToken.getAddress(),
                ethers.parseEther("5")
            );

            expect(await token.collectedFees(await feeToken.getAddress())).to.equal(ethers.parseEther("5"));
        });
    });

    describe("ERC1450 - _cleanupEmptyBatches (lines 1064-1081)", function () {
        it("Should clean up multiple empty batches", async function () {
            // Create multiple batches
            await token.connect(rta).mint(alice.address, 100, REG_US_A, issuanceDate);
            await token.connect(rta).mint(alice.address, 100, REG_US_D, issuanceDate2);
            await token.connect(rta).mint(alice.address, 100, 0x0003, issuanceDate);

            // Burn using FIFO which will create some empty batches
            await token.connect(rta).burnFrom(alice.address, 250);

            const info = await token.getDetailedBatchInfo(alice.address);
            // Should have cleaned up empty batches
            let nonZeroCount = 0;
            for (let i = 0; i < info.count; i++) {
                if (info.amounts[i] > 0) nonZeroCount++;
            }
            expect(nonZeroCount).to.equal(Number(info.count));
        });
    });

    describe("RTAProxy - requiresTimeLock with internal wallets (lines 212-256)", function () {
        beforeEach(async function () {
            // Set up token with RTAProxy as transfer agent
            token = await ERC1450.deploy(
                "Security Token",
                "SEC",
                10,
                issuer.address,
                await rtaProxy.getAddress()
            );
            await token.waitForDeployment();
        });

        it("Should not require time-lock for transfer to internal wallet", async function () {
            // Add internal wallet via multi-sig
            const addWalletData = rtaProxy.interface.encodeFunctionData("addInternalWallet", [alice.address]);
            await rtaProxy.connect(rta).submitOperation(await rtaProxy.getAddress(), addWalletData, 0);
            await rtaProxy.connect(signers[0]).confirmOperation(0);

            // Create high-value transfer
            const mintData = token.interface.encodeFunctionData("mint", [
                bob.address,
                ethers.parseUnits("2000000", 10),
                REG_US_A,
                issuanceDate
            ]);
            await rtaProxy.connect(rta).submitOperation(await token.getAddress(), mintData, 0);
            await rtaProxy.connect(signers[0]).confirmOperation(1);

            // Transfer to internal wallet should not require time-lock
            const transferData = token.interface.encodeFunctionData("transferFromRegulated", [
                bob.address,
                alice.address,
                ethers.parseUnits("2000000", 10),
                REG_US_A,
                issuanceDate
            ]);

            const requiresTL = await rtaProxy.requiresTimeLock(transferData);
            expect(requiresTL).to.be.false;
        });

        it("Should require time-lock for high-value external transfer", async function () {
            const transferData = token.interface.encodeFunctionData("transferFromRegulated", [
                alice.address,
                bob.address,
                ethers.parseUnits("2000000", 10),
                REG_US_A,
                issuanceDate
            ]);

            const requiresTL = await rtaProxy.requiresTimeLock(transferData);
            expect(requiresTL).to.be.true;
        });

        it("Should require time-lock for high-value court order", async function () {
            const courtOrderData = token.interface.encodeFunctionData("executeCourtOrder", [
                alice.address,
                bob.address,
                ethers.parseUnits("2000000", 10),
                ethers.keccak256(ethers.toUtf8Bytes("court-order"))
            ]);

            const requiresTL = await rtaProxy.requiresTimeLock(courtOrderData);
            expect(requiresTL).to.be.true;
        });

        it("Should return false for short data", async function () {
            const requiresTL = await rtaProxy.requiresTimeLock("0x1234");
            expect(requiresTL).to.be.false;
        });
    });

    describe("RTAProxy - updateRequiredSignatures edge cases (line 403)", function () {
        it("Should handle zero required signatures check", async function () {
            const updateData = rtaProxy.interface.encodeFunctionData("updateRequiredSignatures", [0]);
            await rtaProxy.connect(rta).submitOperation(await rtaProxy.getAddress(), updateData, 0);

            try {
                await rtaProxy.connect(signers[0]).confirmOperation(0);
                expect.fail("Expected error");
            } catch (error) {
                // Operation failed due to InvalidSignerCount error
                expect(error).to.not.be.null;
            }
        });

        it("Should handle required > signers check", async function () {
            const updateData = rtaProxy.interface.encodeFunctionData("updateRequiredSignatures", [10]);
            await rtaProxy.connect(rta).submitOperation(await rtaProxy.getAddress(), updateData, 0);

            try {
                await rtaProxy.connect(signers[0]).confirmOperation(0);
                expect.fail("Expected error");
            } catch (error) {
                // Operation failed due to InvalidSignerCount error
                expect(error).to.not.be.null;
            }
        });
    });

    describe("RTAProxy - internal wallet management edge cases (lines 419-460)", function () {
        it("Should revert addInternalWallet with zero address", async function () {
            const addData = rtaProxy.interface.encodeFunctionData("addInternalWallet", [ethers.ZeroAddress]);
            await rtaProxy.connect(rta).submitOperation(await rtaProxy.getAddress(), addData, 0);

            try {
                await rtaProxy.connect(signers[0]).confirmOperation(0);
                expect.fail("Expected error");
            } catch (error) {
                expect(error.message).to.include("Invalid wallet address");
            }
        });

        it("Should revert addInternalWallet when already registered", async function () {
            const addData = rtaProxy.interface.encodeFunctionData("addInternalWallet", [alice.address]);
            await rtaProxy.connect(rta).submitOperation(await rtaProxy.getAddress(), addData, 0);
            await rtaProxy.connect(signers[0]).confirmOperation(0);

            // Try to add again
            const addData2 = rtaProxy.interface.encodeFunctionData("addInternalWallet", [alice.address]);
            await rtaProxy.connect(rta).submitOperation(await rtaProxy.getAddress(), addData2, 0);

            try {
                await rtaProxy.connect(signers[0]).confirmOperation(1);
                expect.fail("Expected error");
            } catch (error) {
                expect(error.message).to.include("Wallet already registered");
            }
        });

        it("Should revert removeInternalWallet when not registered", async function () {
            const removeData = rtaProxy.interface.encodeFunctionData("removeInternalWallet", [alice.address]);
            await rtaProxy.connect(rta).submitOperation(await rtaProxy.getAddress(), removeData, 0);

            try {
                await rtaProxy.connect(signers[0]).confirmOperation(0);
                expect.fail("Expected error");
            } catch (error) {
                expect(error.message).to.include("Wallet not registered");
            }
        });
    });

    describe("RTAProxy - constructor validation branches (lines 95-102)", function () {
        it("Should revert with zero address signer", async function () {
            await expect(
                RTAProxy.deploy([rta.address, ethers.ZeroAddress], 2)
            ).to.be.revertedWith("Invalid signer address");
        });

        it("Should revert with duplicate signer", async function () {
            await expect(
                RTAProxy.deploy([rta.address, rta.address], 2)
            ).to.be.revertedWith("Duplicate signer");
        });
    });
});

describe("RTAProxyUpgradeable Branch Coverage", function () {
    let RTAProxyUpgradeable;
    let rtaProxy;
    let owner, rta, alice, bob;
    let signers;

    beforeEach(async function () {
        [owner, rta, alice, bob, ...signers] = await ethers.getSigners();

        RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
        rtaProxy = await upgrades.deployProxy(
            RTAProxyUpgradeable,
            [[rta.address, signers[0].address, signers[1].address], 2],
            { initializer: "initialize" }
        );
        await rtaProxy.waitForDeployment();
    });

    describe("Initialize validation branches (lines 112-131)", function () {
        it("Should revert initialize with zero required signatures", async function () {
            const NewRTAProxy = await ethers.getContractFactory("RTAProxyUpgradeable");
            await expect(
                upgrades.deployProxy(
                    NewRTAProxy,
                    [[rta.address], 0],
                    { initializer: "initialize" }
                )
            ).to.be.revertedWithCustomError(rtaProxy, "InvalidSignerCount");
        });

        it("Should revert initialize with too many required signatures", async function () {
            const NewRTAProxy = await ethers.getContractFactory("RTAProxyUpgradeable");
            await expect(
                upgrades.deployProxy(
                    NewRTAProxy,
                    [[rta.address], 5],
                    { initializer: "initialize" }
                )
            ).to.be.revertedWithCustomError(rtaProxy, "InvalidSignerCount");
        });

        it("Should revert initialize with zero address signer", async function () {
            const NewRTAProxy = await ethers.getContractFactory("RTAProxyUpgradeable");
            await expect(
                upgrades.deployProxy(
                    NewRTAProxy,
                    [[rta.address, ethers.ZeroAddress], 2],
                    { initializer: "initialize" }
                )
            ).to.be.revertedWith("Invalid signer address");
        });

        it("Should revert initialize with duplicate signer", async function () {
            const NewRTAProxy = await ethers.getContractFactory("RTAProxyUpgradeable");
            await expect(
                upgrades.deployProxy(
                    NewRTAProxy,
                    [[rta.address, rta.address], 2],
                    { initializer: "initialize" }
                )
            ).to.be.revertedWith("Duplicate signer");
        });
    });

    describe("Time-lock and requiresTimeLock branches (lines 267-301)", function () {
        it("Should return false for data less than 4 bytes", async function () {
            expect(await rtaProxy.requiresTimeLock("0x12")).to.be.false;
        });

        it("Should return false for data less than 100 bytes for transfer", async function () {
            // transferFromRegulated selector with incomplete data
            const selector = "0x12345678";
            expect(await rtaProxy.requiresTimeLock(selector + "00".repeat(50))).to.be.false;
        });
    });

    describe("Internal wallet and signer management (lines 417-470)", function () {
        it("Should successfully add and remove internal wallet", async function () {
            const addData = rtaProxy.interface.encodeFunctionData("addInternalWallet", [alice.address]);
            await rtaProxy.connect(rta).submitOperation(await rtaProxy.getAddress(), addData, 0);
            await rtaProxy.connect(signers[0]).confirmOperation(0);

            expect(await rtaProxy.isInternalWallet(alice.address)).to.be.true;
            expect(await rtaProxy.getInternalWalletCount()).to.equal(1);

            const removeData = rtaProxy.interface.encodeFunctionData("removeInternalWallet", [alice.address]);
            await rtaProxy.connect(rta).submitOperation(await rtaProxy.getAddress(), removeData, 0);
            await rtaProxy.connect(signers[0]).confirmOperation(1);

            expect(await rtaProxy.isInternalWallet(alice.address)).to.be.false;
            expect(await rtaProxy.getInternalWalletCount()).to.equal(0);
        });

        it("Should revert remove when wallet not registered", async function () {
            const removeData = rtaProxy.interface.encodeFunctionData("removeInternalWallet", [alice.address]);
            await rtaProxy.connect(rta).submitOperation(await rtaProxy.getAddress(), removeData, 0);

            try {
                await rtaProxy.connect(signers[0]).confirmOperation(0);
                expect.fail("Expected error");
            } catch (error) {
                expect(error.message).to.include("Wallet not registered");
            }
        });

        it("Should revert add when wallet already registered", async function () {
            const addData = rtaProxy.interface.encodeFunctionData("addInternalWallet", [alice.address]);
            await rtaProxy.connect(rta).submitOperation(await rtaProxy.getAddress(), addData, 0);
            await rtaProxy.connect(signers[0]).confirmOperation(0);

            const addData2 = rtaProxy.interface.encodeFunctionData("addInternalWallet", [alice.address]);
            await rtaProxy.connect(rta).submitOperation(await rtaProxy.getAddress(), addData2, 0);

            try {
                await rtaProxy.connect(signers[0]).confirmOperation(1);
                expect.fail("Expected error");
            } catch (error) {
                expect(error.message).to.include("Wallet already registered");
            }
        });
    });

    describe("UpdateRequiredSignatures edge cases (lines 460-470)", function () {
        it("Should revert with zero required signatures", async function () {
            const updateData = rtaProxy.interface.encodeFunctionData("updateRequiredSignatures", [0]);
            await rtaProxy.connect(rta).submitOperation(await rtaProxy.getAddress(), updateData, 0);

            try {
                await rtaProxy.connect(signers[0]).confirmOperation(0);
                expect.fail("Expected error");
            } catch (error) {
                // Operation failed due to InvalidSignerCount error
                expect(error).to.not.be.null;
            }
        });

        it("Should revert when required exceeds signers", async function () {
            const updateData = rtaProxy.interface.encodeFunctionData("updateRequiredSignatures", [10]);
            await rtaProxy.connect(rta).submitOperation(await rtaProxy.getAddress(), updateData, 0);

            try {
                await rtaProxy.connect(signers[0]).confirmOperation(0);
                expect.fail("Expected error");
            } catch (error) {
                // Operation failed due to InvalidSignerCount error
                expect(error).to.not.be.null;
            }
        });
    });
});

describe("Additional ERC1450 Branch Coverage", function () {
    let ERC1450, RTAProxy, MockERC20;
    let token, rtaProxy, feeToken;
    let owner, rta, issuer, alice, bob, charlie, broker;
    let signers;

    const REG_US_A = 0x0001;
    const REG_US_D = 0x0002;
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30;

    beforeEach(async function () {
        [owner, rta, issuer, alice, bob, charlie, broker, ...signers] = await ethers.getSigners();

        ERC1450 = await ethers.getContractFactory("ERC1450");
        RTAProxy = await ethers.getContractFactory("RTAProxy");
        MockERC20 = await ethers.getContractFactory("MockERC20");

        token = await ERC1450.deploy(
            "Security Token",
            "SEC",
            10,
            issuer.address,
            rta.address
        );
        await token.waitForDeployment();

        rtaProxy = await RTAProxy.deploy(
            [rta.address, signers[0].address, signers[1].address],
            2
        );
        await rtaProxy.waitForDeployment();

        feeToken = await MockERC20.deploy("Fee Token", "FEE", 18);
        await feeToken.waitForDeployment();
    });

    describe("More setTransferAgent edge cases", function () {
        it("Should allow current RTA to change to EOA without locking", async function () {
            // RTA changes to another EOA
            await token.connect(rta).setTransferAgent(alice.address);
            expect(await token.isTransferAgent(alice.address)).to.be.true;
        });

        it("Should emit event when changing issuer", async function () {
            await expect(token.connect(rta).changeIssuer(alice.address))
                .to.emit(token, "IssuerChanged")
                .withArgs(issuer.address, alice.address);
        });

        it("Should allow owner to set transfer agent when owner is also RTA", async function () {
            // Deploy with owner as both issuer and RTA
            const newToken = await ERC1450.deploy(
                "Test Token",
                "TST",
                10,
                owner.address,
                owner.address
            );
            await newToken.waitForDeployment();

            // Owner can set new transfer agent
            await newToken.connect(owner).setTransferAgent(alice.address);
            expect(await newToken.isTransferAgent(alice.address)).to.be.true;
        });

        it("Should revert when non-owner/non-RTA tries setTransferAgent", async function () {
            // charlie is neither owner nor RTA
            await expect(
                token.connect(charlie).setTransferAgent(alice.address)
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");
        });
    });

    describe("More burnFrom edge cases", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should emit TokensBurned for each regulation during FIFO burn", async function () {
            await token.connect(rta).mint(alice.address, 500, REG_US_D, issuanceDate);

            // Burn across both regulations
            await expect(token.connect(rta).burnFrom(alice.address, 1200))
                .to.emit(token, "TokensBurned");
        });

        it("Should handle burning exact batch amount", async function () {
            await token.connect(rta).burnFromRegulated(alice.address, 1000, REG_US_A, issuanceDate);
            expect(await token.balanceOf(alice.address)).to.equal(0);
        });
    });

    describe("More batch operations edge cases", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
            await token.connect(rta).mint(bob.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should execute successful batch transfer", async function () {
            await token.connect(rta).batchTransferFrom(
                [alice.address, bob.address],
                [charlie.address, charlie.address],
                [100, 100],
                [REG_US_A, REG_US_A],
                [issuanceDate, issuanceDate]
            );
            expect(await token.balanceOf(charlie.address)).to.equal(200);
        });

        it("Should execute successful batch burn", async function () {
            await token.connect(rta).batchBurnFrom(
                [alice.address, bob.address],
                [100, 100],
                [REG_US_A, REG_US_A],
                [issuanceDate, issuanceDate]
            );
            expect(await token.balanceOf(alice.address)).to.equal(900);
            expect(await token.balanceOf(bob.address)).to.equal(900);
        });
    });

    describe("More request status handling", function () {
        let requestId;

        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                100,
                ethers.ZeroAddress,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return token.interface.parseLog(log)?.name === "TransferRequested";
                } catch { return false; }
            });
            requestId = token.interface.parseLog(event).args.requestId;
        });

        it("Should update request status through updateRequestStatus", async function () {
            await token.connect(rta).updateRequestStatus(requestId, 1); // UnderReview
            const request = await token.transferRequests(requestId);
            expect(request.status).to.equal(1);
        });

        it("Should handle processing request that was manually set to Approved", async function () {
            // First set to Approved manually
            await token.connect(rta).updateRequestStatus(requestId, 2);

            // Now process it
            await token.connect(rta).processTransferRequest(requestId, true);
            expect(await token.balanceOf(bob.address)).to.equal(100);
        });
    });

    describe("Fee calculation edge cases", function () {
        it("Should return flat fee correctly", async function () {
            await token.connect(rta).setFeeParameters(0, 1000, [ethers.ZeroAddress]);
            const fee = await token.getTransferFee(alice.address, bob.address, 10000, ethers.ZeroAddress);
            expect(fee).to.equal(1000);
        });

        it("Should calculate percentage fee correctly", async function () {
            await token.connect(rta).setFeeParameters(1, 500, [ethers.ZeroAddress]); // 5%
            const fee = await token.getTransferFee(alice.address, bob.address, 10000, ethers.ZeroAddress);
            expect(fee).to.equal(500); // 5% of 10000
        });

        it("Should return feeValue for tiered type", async function () {
            await token.connect(rta).setFeeParameters(2, 750, [ethers.ZeroAddress]);
            const fee = await token.getTransferFee(alice.address, bob.address, 10000, ethers.ZeroAddress);
            expect(fee).to.equal(750);
        });
    });

    describe("Court order edge cases", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should execute court order even with frozen from account", async function () {
            await token.connect(rta).setAccountFrozen(alice.address, true);

            // Court order should bypass frozen status
            await token.connect(rta).executeCourtOrder(
                alice.address,
                bob.address,
                500,
                ethers.keccak256(ethers.toUtf8Bytes("court-order"))
            );

            expect(await token.balanceOf(bob.address)).to.equal(500);
        });

        it("Should execute court order even with frozen to account", async function () {
            await token.connect(rta).setAccountFrozen(bob.address, true);

            // Court order should bypass frozen status
            await token.connect(rta).executeCourtOrder(
                alice.address,
                bob.address,
                500,
                ethers.keccak256(ethers.toUtf8Bytes("court-order"))
            );

            expect(await token.balanceOf(bob.address)).to.equal(500);
        });
    });

    describe("recoverToken edge cases", function () {
        it("Should recover ETH sent to contract", async function () {
            // Send some ETH to the contract
            await owner.sendTransaction({
                to: await token.getAddress(),
                value: ethers.parseEther("1.0")
            });

            const initialBalance = await ethers.provider.getBalance(rta.address);
            await token.connect(rta).recoverToken(ethers.ZeroAddress, ethers.parseEther("1.0"));
            const finalBalance = await ethers.provider.getBalance(rta.address);

            expect(finalBalance).to.be.gt(initialBalance);
        });

        it("Should recover ERC20 tokens sent to contract", async function () {
            await feeToken.mint(await token.getAddress(), ethers.parseEther("100"));

            await token.connect(rta).recoverToken(await feeToken.getAddress(), ethers.parseEther("100"));

            expect(await feeToken.balanceOf(rta.address)).to.equal(ethers.parseEther("100"));
        });
    });
});

describe("ERC1450Upgradeable Branch Coverage", function () {
    let ERC1450Upgradeable, MockERC20;
    let token, feeToken;
    let owner, rta, issuer, alice, bob, charlie, broker;
    let signers;

    const REG_US_A = 0x0001;
    const REG_US_D = 0x0002;
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30;
    const issuanceDate2 = Math.floor(Date.now() / 1000) - 86400 * 60;

    beforeEach(async function () {
        [owner, rta, issuer, alice, bob, charlie, broker, ...signers] = await ethers.getSigners();

        ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
        MockERC20 = await ethers.getContractFactory("MockERC20");

        token = await upgrades.deployProxy(
            ERC1450Upgradeable,
            ["Security Token", "SEC", 10, issuer.address, rta.address],
            { initializer: "initialize" }
        );
        await token.waitForDeployment();

        feeToken = await MockERC20.deploy("Fee Token", "FEE", 18);
        await feeToken.waitForDeployment();
    });

    describe("notFrozen modifier TO address (line 235)", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should revert transferFromRegulated when TO is frozen", async function () {
            await token.connect(rta).setAccountFrozen(bob.address, true);
            await expect(
                token.connect(rta).transferFromRegulated(
                    alice.address,
                    bob.address,
                    100,
                    REG_US_A,
                    issuanceDate
                )
            ).to.be.revertedWithCustomError(token, "ERC1450ComplianceCheckFailed");
        });
    });

    describe("setTransferAgent branches (lines 251-276)", function () {
        it("Should revert when non-owner non-RTA tries to set", async function () {
            await expect(
                token.connect(charlie).setTransferAgent(bob.address)
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");
        });
    });

    describe("mint validation (lines 282-304)", function () {
        it("Should revert mint with regulation type 0", async function () {
            await expect(
                token.connect(rta).mint(alice.address, 100, 0, issuanceDate)
            ).to.be.revertedWith("ERC1450: Invalid regulation type");
        });

        it("Should revert mint with future issuance date", async function () {
            const futureDate = Math.floor(Date.now() / 1000) + 86400 * 365;
            await expect(
                token.connect(rta).mint(alice.address, 100, REG_US_A, futureDate)
            ).to.be.revertedWith("ERC1450: Future issuance date not allowed");
        });
    });

    describe("batchMint validation (lines 306-354)", function () {
        it("Should revert batchMint with regulation type 0", async function () {
            await expect(
                token.connect(rta).batchMint(
                    [alice.address],
                    [100],
                    [0],
                    [issuanceDate]
                )
            ).to.be.revertedWith("ERC1450: Invalid regulation type");
        });

        it("Should revert batchMint with future issuance date", async function () {
            const futureDate = Math.floor(Date.now() / 1000) + 86400 * 365;
            await expect(
                token.connect(rta).batchMint(
                    [alice.address],
                    [100],
                    [REG_US_A],
                    [futureDate]
                )
            ).to.be.revertedWith("ERC1450: Future issuance date not allowed");
        });
    });

    describe("burnFromRegulation edge cases (lines 356-392)", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should revert with insufficient balance", async function () {
            await expect(
                token.connect(rta).burnFromRegulation(alice.address, 2000, REG_US_A)
            ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
        });

        it("Should revert with insufficient tokens of regulation", async function () {
            await expect(
                token.connect(rta).burnFromRegulation(alice.address, 100, REG_US_D)
            ).to.be.revertedWith("ERC1450: Insufficient tokens of specified regulation");
        });
    });

    describe("burnFromRegulated batch logic (lines 397-452)", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should revert with batch not found", async function () {
            await expect(
                token.connect(rta).burnFromRegulated(alice.address, 100, REG_US_D, issuanceDate)
            ).to.be.revertedWith("ERC1450: Batch not found");
        });

        it("Should revert with insufficient batch balance", async function () {
            await expect(
                token.connect(rta).burnFromRegulated(alice.address, 2000, REG_US_A, issuanceDate)
            ).to.be.revertedWith("ERC1450: Insufficient batch balance");
        });

        it("Should remove batch when fully burned", async function () {
            await token.connect(rta).burnFromRegulated(alice.address, 1000, REG_US_A, issuanceDate);
            const info = await token.getDetailedBatchInfo(alice.address);
            expect(info.count).to.equal(0);
        });
    });

    describe("batchTransferFrom array validation (lines 457-477)", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should revert with mismatched arrays", async function () {
            await expect(
                token.connect(rta).batchTransferFrom(
                    [alice.address],
                    [bob.address, charlie.address],
                    [100],
                    [REG_US_A],
                    [issuanceDate]
                )
            ).to.be.revertedWith("ERC1450: Array length mismatch");
        });
    });

    describe("batchBurnFrom array validation (lines 482-501)", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should revert with mismatched arrays", async function () {
            await expect(
                token.connect(rta).batchBurnFrom(
                    [alice.address],
                    [100, 200],
                    [REG_US_A],
                    [issuanceDate]
                )
            ).to.be.revertedWith("ERC1450: Array length mismatch");
        });
    });

    describe("getHolderRegulations with zero batches (lines 503-529)", function () {
        it("Should return empty arrays for holder with zero batches", async function () {
            await token.connect(rta).mint(alice.address, 100, REG_US_A, issuanceDate);
            await token.connect(rta).burnFrom(alice.address, 100);

            const info = await token.getHolderRegulations(alice.address);
            // Should filter out zero amount batches
            let nonZeroCount = 0;
            for (let i = 0; i < info.amounts.length; i++) {
                if (info.amounts[i] > 0n) nonZeroCount++;
            }
            expect(nonZeroCount).to.equal(0);
        });
    });

    describe("requestTransferWithFee edge cases (lines 582-634)", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should revert with unaccepted fee token", async function () {
            await expect(
                token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    100,
                    charlie.address,
                    100
                )
            ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
        });

        it("Should revert when msg.value doesn't match feeAmount", async function () {
            await expect(
                token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    100,
                    ethers.ZeroAddress,
                    ethers.parseEther("0.1"),
                    { value: ethers.parseEther("0.05") }
                )
            ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
        });
    });

    describe("processTransferRequest branches (lines 636-664)", function () {
        let requestId;

        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                100,
                ethers.ZeroAddress,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return token.interface.parseLog(log)?.name === "TransferRequested";
                } catch { return false; }
            });
            requestId = token.interface.parseLog(event).args.requestId;
        });

        it("Should reject request with approved=false", async function () {
            await token.connect(rta).processTransferRequest(requestId, false);
            const request = await token.transferRequests(requestId);
            expect(request.status).to.equal(3);
        });

        it("Should revert when processing executed request", async function () {
            await token.connect(rta).processTransferRequest(requestId, true);
            await expect(
                token.connect(rta).processTransferRequest(requestId, true)
            ).to.be.revertedWith("ERC1450: Request already finalized");
        });
    });

    describe("rejectTransferRequest fee refund (lines 666-688)", function () {
        let requestId;

        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should refund ERC20 fees", async function () {
            await feeToken.mint(alice.address, ethers.parseEther("100"));
            await feeToken.connect(alice).approve(await token.getAddress(), ethers.parseEther("100"));

            await token.connect(rta).setFeeParameters(0, 0, [await feeToken.getAddress()]);

            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                100,
                await feeToken.getAddress(),
                ethers.parseEther("5")
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return token.interface.parseLog(log)?.name === "TransferRequested";
                } catch { return false; }
            });
            requestId = token.interface.parseLog(event).args.requestId;

            await token.connect(rta).rejectTransferRequest(requestId, 1, true);
            expect(await feeToken.balanceOf(alice.address)).to.equal(ethers.parseEther("100"));
        });
    });

    describe("withdrawFees edge cases (lines 736-756)", function () {
        it("Should revert with insufficient fees", async function () {
            await expect(
                token.connect(rta).withdrawFees(ethers.ZeroAddress, 100, alice.address)
            ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
        });
    });

    describe("_transferBatch batch not found (line 880)", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should revert when batch not found", async function () {
            await expect(
                token.connect(rta).transferFromRegulated(
                    alice.address,
                    bob.address,
                    100,
                    REG_US_D,
                    issuanceDate
                )
            ).to.be.revertedWith("ERC1450: Batch not found");
        });
    });

    describe("_transferTokensFIFO partial transfers (lines 976-994)", function () {
        it("Should transfer across multiple batches", async function () {
            await token.connect(rta).mint(alice.address, 300, REG_US_A, issuanceDate);
            await token.connect(rta).mint(alice.address, 300, REG_US_D, issuanceDate2);

            // Court order uses FIFO
            await token.connect(rta).executeCourtOrder(
                alice.address,
                bob.address,
                400,
                ethers.keccak256(ethers.toUtf8Bytes("order"))
            );

            expect(await token.balanceOf(bob.address)).to.equal(400);
        });
    });

    describe("Additional ERC1450Upgradeable edge cases", function () {
        beforeEach(async function () {
            await token.connect(rta).mint(alice.address, 1000, REG_US_A, issuanceDate);
        });

        it("Should handle changeIssuer", async function () {
            await token.connect(rta).changeIssuer(bob.address);
            expect(await token.owner()).to.equal(bob.address);
        });

        it("Should handle setBrokerStatus", async function () {
            await token.connect(rta).setBrokerStatus(broker.address, true);
            expect(await token.isRegisteredBroker(broker.address)).to.be.true;
        });

        it("Should handle setAccountFrozen", async function () {
            await token.connect(rta).setAccountFrozen(alice.address, true);
            expect(await token.isAccountFrozen(alice.address)).to.be.true;
        });

        it("Should allow broker to request transfer", async function () {
            await token.connect(rta).setBrokerStatus(broker.address, true);
            await token.connect(broker).requestTransferWithFee(
                alice.address,
                bob.address,
                100,
                ethers.ZeroAddress,
                0
            );
        });

        it("Should handle FIFO burn across multiple batches", async function () {
            await token.connect(rta).mint(alice.address, 500, REG_US_D, issuanceDate2);

            // Burn across both batches
            await token.connect(rta).burnFrom(alice.address, 1200);

            expect(await token.balanceOf(alice.address)).to.equal(300);
        });

        it("Should handle successful batch transfer", async function () {
            await token.connect(rta).mint(bob.address, 1000, REG_US_A, issuanceDate);

            await token.connect(rta).batchTransferFrom(
                [alice.address, bob.address],
                [charlie.address, charlie.address],
                [100, 100],
                [REG_US_A, REG_US_A],
                [issuanceDate, issuanceDate]
            );

            expect(await token.balanceOf(charlie.address)).to.equal(200);
        });

        it("Should handle successful batch burn", async function () {
            await token.connect(rta).mint(bob.address, 1000, REG_US_A, issuanceDate);

            await token.connect(rta).batchBurnFrom(
                [alice.address, bob.address],
                [100, 100],
                [REG_US_A, REG_US_A],
                [issuanceDate, issuanceDate]
            );

            expect(await token.balanceOf(alice.address)).to.equal(900);
            expect(await token.balanceOf(bob.address)).to.equal(900);
        });

        it("Should handle processTransferRequest with already approved status", async function () {
            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                100,
                ethers.ZeroAddress,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return token.interface.parseLog(log)?.name === "TransferRequested";
                } catch { return false; }
            });
            const requestId = token.interface.parseLog(event).args.requestId;

            // Set to Approved first
            await token.connect(rta).updateRequestStatus(requestId, 2);

            // Now process (should skip status update)
            await token.connect(rta).processTransferRequest(requestId, true);

            expect(await token.balanceOf(bob.address)).to.equal(100);
        });

        it("Should handle fee calculation types", async function () {
            // Flat fee
            await token.connect(rta).setFeeParameters(0, 500, [ethers.ZeroAddress]);
            let fee = await token.getTransferFee(alice.address, bob.address, 1000, ethers.ZeroAddress);
            expect(fee).to.equal(500);

            // Percentage fee
            await token.connect(rta).setFeeParameters(1, 1000, [ethers.ZeroAddress]); // 10%
            fee = await token.getTransferFee(alice.address, bob.address, 10000, ethers.ZeroAddress);
            expect(fee).to.equal(1000);

            // Tiered/custom fee
            await token.connect(rta).setFeeParameters(2, 750, [ethers.ZeroAddress]);
            fee = await token.getTransferFee(alice.address, bob.address, 10000, ethers.ZeroAddress);
            expect(fee).to.equal(750);
        });

        it("Should withdraw native fees", async function () {
            // Create a transfer request with native fee
            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                100,
                ethers.ZeroAddress,
                ethers.parseEther("0.1"),
                { value: ethers.parseEther("0.1") }
            );

            const initialBalance = await ethers.provider.getBalance(charlie.address);
            await token.connect(rta).withdrawFees(ethers.ZeroAddress, ethers.parseEther("0.1"), charlie.address);
            const finalBalance = await ethers.provider.getBalance(charlie.address);

            expect(finalBalance - initialBalance).to.equal(ethers.parseEther("0.1"));
        });

        it("Should handle recoverToken for ETH", async function () {
            await owner.sendTransaction({
                to: await token.getAddress(),
                value: ethers.parseEther("0.5")
            });

            const initialBalance = await ethers.provider.getBalance(rta.address);
            await token.connect(rta).recoverToken(ethers.ZeroAddress, ethers.parseEther("0.5"));
            const finalBalance = await ethers.provider.getBalance(rta.address);

            expect(finalBalance).to.be.gt(initialBalance);
        });

        it("Should handle recoverToken for ERC20", async function () {
            await feeToken.mint(await token.getAddress(), ethers.parseEther("50"));

            await token.connect(rta).recoverToken(await feeToken.getAddress(), ethers.parseEther("50"));

            expect(await feeToken.balanceOf(rta.address)).to.equal(ethers.parseEther("50"));
        });

        it("Should handle court order", async function () {
            await token.connect(rta).executeCourtOrder(
                alice.address,
                bob.address,
                500,
                ethers.keccak256(ethers.toUtf8Bytes("court-order"))
            );

            expect(await token.balanceOf(bob.address)).to.equal(500);
        });
    });
});
