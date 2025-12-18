const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ERC1450 Invariant Tests - Security Properties", function () {
    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago
    let ERC1450, MockERC20, token, feeToken;
    let owner, issuer, rta, alice, bob, carol, dave;
    let users;

    beforeEach(async function () {
        [owner, issuer, rta, alice, bob, carol, dave] = await ethers.getSigners();
        users = [alice, bob, carol, dave];

        ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy(
            "Test Security Token",
            "TST",
            18,
            issuer.address,
            rta.address
        );
        await token.waitForDeployment();

        // Deploy MockERC20 for fee token (6 decimals like USDC)
        MockERC20 = await ethers.getContractFactory("MockERC20");
        feeToken = await MockERC20.deploy("Fee Token", "FEE", 6);
        await feeToken.waitForDeployment();
    });

    describe("Invariant 1: Total Supply Conservation", function () {
        it("Total supply should equal sum of all balances", async function () {
            // Mint tokens to multiple users
            const amounts = [
                ethers.parseUnits("100", 10),
                ethers.parseUnits("200", 10),
                ethers.parseUnits("150", 10),
                ethers.parseUnits("50", 10)
            ];

            for (let i = 0; i < users.length; i++) {
                await token.connect(rta).mint(users[i].address, amounts[i], REG_US_A, issuanceDate);
            }

            // Calculate total supply and sum of balances
            const totalSupply = await token.totalSupply();
            let balanceSum = 0n;

            for (const user of users) {
                balanceSum += await token.balanceOf(user.address);
            }

            expect(totalSupply).to.equal(balanceSum);
        });

        it("Total supply should never decrease except on burn", async function () {
            const initialSupply = await token.totalSupply();

            // Mint some tokens
            await token.connect(rta).mint(alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate);
            const afterMint = await token.totalSupply();
            expect(afterMint).to.be.gt(initialSupply);

            // Transfer doesn't change total supply
            await token.connect(rta).mint(bob.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate);
            await token.connect(rta).transferFromRegulated(bob.address, alice.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate);
            const afterTransfer = await token.totalSupply();
            expect(afterTransfer).to.equal(afterMint + ethers.parseUnits("50", 10));

            // Burn decreases total supply
            await token.connect(rta).burnFrom(alice.address, ethers.parseUnits("30", 10));
            const afterBurn = await token.totalSupply();
            expect(afterBurn).to.equal(afterTransfer - ethers.parseUnits("30", 10));
        });
    });

    describe("Invariant 2: Balance Integrity", function () {
        it("Balance should never be negative (checked via type safety)", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate);

            // Attempting to transfer more than balance should revert
            await expect(
                token.connect(rta).transferFromRegulated(alice.address, bob.address, ethers.parseUnits("200", 10), REG_US_A, issuanceDate)
            ).to.be.revertedWith("ERC1450: Insufficient batch balance");

            // Balance remains intact
            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("100", 10));
        });

        it("Sum of balances before transfer equals sum after transfer", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate);
            await token.connect(rta).mint(bob.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate);

            const aliceBalanceBefore = await token.balanceOf(alice.address);
            const bobBalanceBefore = await token.balanceOf(bob.address);
            const sumBefore = aliceBalanceBefore + bobBalanceBefore;

            // Transfer
            await token.connect(rta).transferFromRegulated(alice.address, bob.address, ethers.parseUnits("30", 10), REG_US_A, issuanceDate);

            const aliceBalanceAfter = await token.balanceOf(alice.address);
            const bobBalanceAfter = await token.balanceOf(bob.address);
            const sumAfter = aliceBalanceAfter + bobBalanceAfter;

            expect(sumAfter).to.equal(sumBefore);
        });
    });

    describe("Invariant 3: RTA Exclusive Control", function () {
        it("Only RTA can perform privileged operations", async function () {
            // Non-RTA cannot mint
            await expect(
                token.connect(alice).mint(bob.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate)
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");

            // Non-RTA cannot burn
            await token.connect(rta).mint(alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate);
            await expect(
                token.connect(bob).burnFrom(alice.address, ethers.parseUnits("50", 10))
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");

            // Non-RTA cannot transfer (transferFrom is disabled)
            await expect(
                token.connect(alice).transferFrom(alice.address, bob.address, ethers.parseUnits("50", 10))
            ).to.be.revertedWithCustomError(token, "ERC1450TransferDisabled");

            // Non-RTA cannot freeze accounts
            await expect(
                token.connect(alice).setAccountFrozen(bob.address, true)
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");

            // Non-RTA cannot set broker status
            await expect(
                token.connect(alice).setBrokerStatus(bob.address, true)
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");
        });

        it("Direct ERC20 functions should be disabled", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate);

            // transfer() should revert
            await expect(
                token.connect(alice).transfer(bob.address, ethers.parseUnits("50", 10))
            ).to.be.revertedWithCustomError(token, "ERC1450TransferDisabled");

            // approve() should revert
            await expect(
                token.connect(alice).approve(bob.address, ethers.parseUnits("50", 10))
            ).to.be.revertedWithCustomError(token, "ERC1450TransferDisabled");

            // transferFrom() is disabled for everyone
            await expect(
                token.connect(bob).transferFrom(alice.address, bob.address, ethers.parseUnits("50", 10))
            ).to.be.revertedWithCustomError(token, "ERC1450TransferDisabled");

            // allowance should always return 0
            expect(await token.allowance(alice.address, bob.address)).to.equal(0);
        });
    });

    describe("Invariant 4: Frozen Account Restrictions", function () {
        it("Frozen accounts cannot send or receive (except court orders)", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate);
            await token.connect(rta).mint(bob.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate);

            // Freeze alice
            await token.connect(rta).setAccountFrozen(alice.address, true);

            // Alice cannot send
            await expect(
                token.connect(rta).transferFromRegulated(alice.address, bob.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate)
            ).to.be.revertedWithCustomError(token, "ERC1450ComplianceCheckFailed");

            // Alice cannot receive
            await expect(
                token.connect(rta).transferFromRegulated(bob.address, alice.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate)
            ).to.be.revertedWithCustomError(token, "ERC1450ComplianceCheckFailed");

            // Controller transfer should still work (ERC-1644)
            const documentHash = ethers.keccak256(ethers.toUtf8Bytes("court-order"));
            await expect(
                token.connect(rta).controllerTransfer(
                    alice.address,
                    bob.address,
                    ethers.parseUnits("30", 10),
                    documentHash,
                    ethers.toUtf8Bytes("COURT_ORDER")
                )
            ).to.emit(token, "ControllerTransfer");
        });
    });

    describe("Invariant 5: Fee Collection Integrity", function () {
        it("Collected fees should never decrease except on withdrawal", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            // Set fee token and fee parameters
            await token.connect(rta).setFeeToken(feeToken.target);
            await token.connect(rta).setFeeParameters(0, ethers.parseUnits("1", 6));

            // Mint fee tokens to alice and approve
            await feeToken.mint(alice.address, ethers.parseUnits("10", 6));
            await feeToken.connect(alice).approve(token.target, ethers.parseUnits("10", 6));

            const initialFees = await token.collectedFees();

            // Create transfer request with fee
            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10),
                ethers.parseUnits("1", 6)
            );

            const afterRequest = await token.collectedFees();
            expect(afterRequest).to.be.gt(initialFees);

            // Another request increases fees
            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10),
                ethers.parseUnits("1", 6)
            );

            const afterSecondRequest = await token.collectedFees();
            expect(afterSecondRequest).to.be.gt(afterRequest);

            // Withdrawal decreases fees
            await token.connect(rta).withdrawFees(
                ethers.parseUnits("1", 6),
                rta.address
            );

            const afterWithdrawal = await token.collectedFees();
            expect(afterWithdrawal).to.equal(afterSecondRequest - ethers.parseUnits("1", 6));
        });

        it("Cannot withdraw more fees than collected", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            // Set fee token and fee parameters
            await token.connect(rta).setFeeToken(feeToken.target);
            await token.connect(rta).setFeeParameters(0, ethers.parseUnits("1", 6));

            // Mint fee tokens to alice and approve
            await feeToken.mint(alice.address, ethers.parseUnits("10", 6));
            await feeToken.connect(alice).approve(token.target, ethers.parseUnits("10", 6));

            // Collect 1 FEE in fees
            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10),
                ethers.parseUnits("1", 6)
            );

            // Try to withdraw 2 FEE
            await expect(
                token.connect(rta).withdrawFees(
                    ethers.parseUnits("2", 6),
                    rta.address
                )
            ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
        });
    });

    describe("Invariant 6: Transfer Request State Machine", function () {
        it("Transfer requests follow valid state transitions", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            // Set fee token and fee parameters
            await token.connect(rta).setFeeToken(feeToken.target);
            await token.connect(rta).setFeeParameters(0, 0);

            // Create request (Pending)
            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10),
                0
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    const parsed = token.interface.parseLog(log);
                    return parsed && parsed.name === "TransferRequested";
                } catch {
                    return false;
                }
            });
            const requestId = token.interface.parseLog(event).args.requestId;

            // Check initial state
            const request = await token.transferRequests(requestId);
            expect(request.status).to.equal(0); // Pending

            // Process -> Approved -> Executed
            await token.connect(rta).processTransferRequest(requestId, true);
            const processedRequest = await token.transferRequests(requestId);
            expect(processedRequest.status).to.equal(4); // Executed
        });

        it("Rejected requests cannot be processed", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            // Set fee token and fee parameters
            await token.connect(rta).setFeeToken(feeToken.target);
            await token.connect(rta).setFeeParameters(0, 0);

            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10),
                0
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    const parsed = token.interface.parseLog(log);
                    return parsed && parsed.name === "TransferRequested";
                } catch {
                    return false;
                }
            });
            const requestId = token.interface.parseLog(event).args.requestId;

            // Reject
            await token.connect(rta).rejectTransferRequest(requestId, 3, false);

            const rejectedRequest = await token.transferRequests(requestId);
            expect(rejectedRequest.status).to.equal(3); // Rejected

            // Try to process rejected request - should fail (security fix)
            // Rejected requests are finalized and cannot be re-processed
            await expect(
                token.connect(rta).processTransferRequest(requestId, true)
            ).to.be.revertedWith("ERC1450: Request already finalized");

            // Verify status remains rejected
            const finalRequest = await token.transferRequests(requestId);
            expect(finalRequest.status).to.equal(3); // Still Rejected
        });
    });

    describe("Invariant 7: Interface Compliance", function () {
        it("Should always report correct interface support", async function () {
            // ERC1450
            expect(await token.supportsInterface("0xaf175dee")).to.be.true;

            // ERC20
            expect(await token.supportsInterface("0x36372b07")).to.be.false;

            // ERC165
            expect(await token.supportsInterface("0x01ffc9a7")).to.be.true;

            // Should always identify as security token
            expect(await token.isSecurityToken()).to.be.true;
        });
    });

    describe("Stress Test: Multiple Operations", function () {
        it("Should maintain invariants under multiple rapid operations", async function () {
            // Mint to multiple users
            for (const user of users) {
                await token.connect(rta).mint(user.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);
            }

            const initialTotalSupply = await token.totalSupply();

            // Perform multiple transfers
            await token.connect(rta).transferFromRegulated(alice.address, bob.address, ethers.parseUnits("10", 10), REG_US_A, issuanceDate);
            await token.connect(rta).transferFromRegulated(bob.address, carol.address, ethers.parseUnits("20", 10), REG_US_A, issuanceDate);
            await token.connect(rta).transferFromRegulated(carol.address, dave.address, ethers.parseUnits("15", 10), REG_US_A, issuanceDate);

            // Total supply unchanged
            expect(await token.totalSupply()).to.equal(initialTotalSupply);

            // Burn from one user
            await token.connect(rta).burnFrom(dave.address, ethers.parseUnits("5", 10));

            // Total supply decreased by burn amount
            expect(await token.totalSupply()).to.equal(initialTotalSupply - ethers.parseUnits("5", 10));

            // Sum of all balances equals total supply
            let balanceSum = 0n;
            for (const user of users) {
                balanceSum += await token.balanceOf(user.address);
            }
            expect(await token.totalSupply()).to.equal(balanceSum);
        });
    });
});
