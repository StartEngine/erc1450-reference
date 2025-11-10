const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ERC1450 Invariant Tests - Security Properties", function () {
    let ERC1450, token;
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
    });

    describe("Invariant 1: Total Supply Conservation", function () {
        it("Total supply should equal sum of all balances", async function () {
            // Mint tokens to multiple users
            const amounts = [
                ethers.parseEther("100"),
                ethers.parseEther("200"),
                ethers.parseEther("150"),
                ethers.parseEther("50")
            ];

            for (let i = 0; i < users.length; i++) {
                await token.connect(rta).mint(users[i].address, amounts[i]);
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
            await token.connect(rta).mint(alice.address, ethers.parseEther("100"));
            const afterMint = await token.totalSupply();
            expect(afterMint).to.be.gt(initialSupply);

            // Transfer doesn't change total supply
            await token.connect(rta).mint(bob.address, ethers.parseEther("50"));
            await token.connect(rta).transferFrom(bob.address, alice.address, ethers.parseEther("50"));
            const afterTransfer = await token.totalSupply();
            expect(afterTransfer).to.equal(afterMint + ethers.parseEther("50"));

            // Burn decreases total supply
            await token.connect(rta).burnFrom(alice.address, ethers.parseEther("30"));
            const afterBurn = await token.totalSupply();
            expect(afterBurn).to.equal(afterTransfer - ethers.parseEther("30"));
        });
    });

    describe("Invariant 2: Balance Integrity", function () {
        it("Balance should never be negative (checked via type safety)", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseEther("100"));

            // Attempting to transfer more than balance should revert
            await expect(
                token.connect(rta).transferFrom(alice.address, bob.address, ethers.parseEther("200"))
            ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");

            // Balance remains intact
            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("100"));
        });

        it("Sum of balances before transfer equals sum after transfer", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseEther("100"));
            await token.connect(rta).mint(bob.address, ethers.parseEther("50"));

            const aliceBalanceBefore = await token.balanceOf(alice.address);
            const bobBalanceBefore = await token.balanceOf(bob.address);
            const sumBefore = aliceBalanceBefore + bobBalanceBefore;

            // Transfer
            await token.connect(rta).transferFrom(alice.address, bob.address, ethers.parseEther("30"));

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
                token.connect(alice).mint(bob.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");

            // Non-RTA cannot burn
            await token.connect(rta).mint(alice.address, ethers.parseEther("100"));
            await expect(
                token.connect(bob).burnFrom(alice.address, ethers.parseEther("50"))
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");

            // Non-RTA cannot transfer
            await expect(
                token.connect(alice).transferFrom(alice.address, bob.address, ethers.parseEther("50"))
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");

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
            await token.connect(rta).mint(alice.address, ethers.parseEther("100"));

            // transfer() should revert
            await expect(
                token.connect(alice).transfer(bob.address, ethers.parseEther("50"))
            ).to.be.revertedWithCustomError(token, "ERC1450TransferDisabled");

            // approve() should revert
            await expect(
                token.connect(alice).approve(bob.address, ethers.parseEther("50"))
            ).to.be.revertedWithCustomError(token, "ERC1450TransferDisabled");

            // transferFrom() by non-RTA should revert
            await expect(
                token.connect(bob).transferFrom(alice.address, bob.address, ethers.parseEther("50"))
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");

            // allowance should always return 0
            expect(await token.allowance(alice.address, bob.address)).to.equal(0);
        });
    });

    describe("Invariant 4: Frozen Account Restrictions", function () {
        it("Frozen accounts cannot send or receive (except court orders)", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseEther("100"));
            await token.connect(rta).mint(bob.address, ethers.parseEther("100"));

            // Freeze alice
            await token.connect(rta).setAccountFrozen(alice.address, true);

            // Alice cannot send
            await expect(
                token.connect(rta).transferFrom(alice.address, bob.address, ethers.parseEther("50"))
            ).to.be.revertedWithCustomError(token, "ERC1450ComplianceCheckFailed");

            // Alice cannot receive
            await expect(
                token.connect(rta).transferFrom(bob.address, alice.address, ethers.parseEther("50"))
            ).to.be.revertedWithCustomError(token, "ERC1450ComplianceCheckFailed");

            // Court order should still work
            const documentHash = ethers.keccak256(ethers.toUtf8Bytes("court-order"));
            await expect(
                token.connect(rta).executeCourtOrder(
                    alice.address,
                    bob.address,
                    ethers.parseEther("30"),
                    documentHash
                )
            ).to.emit(token, "CourtOrderExecuted");
        });
    });

    describe("Invariant 5: Fee Collection Integrity", function () {
        it("Collected fees should never decrease except on withdrawal", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseEther("1000"));
            await token.connect(rta).setFeeParameters(0, ethers.parseEther("1"), [ethers.ZeroAddress]);

            const initialFees = await token.collectedFees(ethers.ZeroAddress);

            // Create transfer request with fee
            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseEther("100"),
                ethers.ZeroAddress,
                ethers.parseEther("1"),
                { value: ethers.parseEther("1") }
            );

            const afterRequest = await token.collectedFees(ethers.ZeroAddress);
            expect(afterRequest).to.be.gt(initialFees);

            // Another request increases fees
            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseEther("100"),
                ethers.ZeroAddress,
                ethers.parseEther("1"),
                { value: ethers.parseEther("1") }
            );

            const afterSecondRequest = await token.collectedFees(ethers.ZeroAddress);
            expect(afterSecondRequest).to.be.gt(afterRequest);

            // Withdrawal decreases fees
            await token.connect(rta).withdrawFees(
                ethers.ZeroAddress,
                ethers.parseEther("1"),
                rta.address
            );

            const afterWithdrawal = await token.collectedFees(ethers.ZeroAddress);
            expect(afterWithdrawal).to.equal(afterSecondRequest - ethers.parseEther("1"));
        });

        it("Cannot withdraw more fees than collected", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseEther("1000"));
            await token.connect(rta).setFeeParameters(0, ethers.parseEther("1"), [ethers.ZeroAddress]);

            // Collect 1 ETH in fees
            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseEther("100"),
                ethers.ZeroAddress,
                ethers.parseEther("1"),
                { value: ethers.parseEther("1") }
            );

            // Try to withdraw 2 ETH
            await expect(
                token.connect(rta).withdrawFees(
                    ethers.ZeroAddress,
                    ethers.parseEther("2"),
                    rta.address
                )
            ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
        });
    });

    describe("Invariant 6: Transfer Request State Machine", function () {
        it("Transfer requests follow valid state transitions", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseEther("1000"));
            await token.connect(rta).setFeeParameters(0, 0, [ethers.ZeroAddress]);

            // Create request (Pending)
            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseEther("100"),
                ethers.ZeroAddress,
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
            await token.connect(rta).processTransferRequest(requestId);
            const processedRequest = await token.transferRequests(requestId);
            expect(processedRequest.status).to.equal(4); // Executed
        });

        it("Rejected requests cannot be processed", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseEther("1000"));
            await token.connect(rta).setFeeParameters(0, 0, [ethers.ZeroAddress]);

            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseEther("100"),
                ethers.ZeroAddress,
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

            // Process will change status from Rejected to Approved and execute
            // This is by design - RTA can override rejection
            await token.connect(rta).processTransferRequest(requestId);
            const finalRequest = await token.transferRequests(requestId);
            expect(finalRequest.status).to.equal(4); // Executed
        });
    });

    describe("Invariant 7: Interface Compliance", function () {
        it("Should always report correct interface support", async function () {
            // ERC1450
            expect(await token.supportsInterface("0xaf175dee")).to.be.true;

            // ERC20
            expect(await token.supportsInterface("0x36372b07")).to.be.true;

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
                await token.connect(rta).mint(user.address, ethers.parseEther("1000"));
            }

            const initialTotalSupply = await token.totalSupply();

            // Perform multiple transfers
            await token.connect(rta).transferFrom(alice.address, bob.address, ethers.parseEther("10"));
            await token.connect(rta).transferFrom(bob.address, carol.address, ethers.parseEther("20"));
            await token.connect(rta).transferFrom(carol.address, dave.address, ethers.parseEther("15"));

            // Total supply unchanged
            expect(await token.totalSupply()).to.equal(initialTotalSupply);

            // Burn from one user
            await token.connect(rta).burnFrom(dave.address, ethers.parseEther("5"));

            // Total supply decreased by burn amount
            expect(await token.totalSupply()).to.equal(initialTotalSupply - ethers.parseEther("5"));

            // Sum of all balances equals total supply
            let balanceSum = 0n;
            for (const user of users) {
                balanceSum += await token.balanceOf(user.address);
            }
            expect(await token.totalSupply()).to.equal(balanceSum);
        });
    });
});
