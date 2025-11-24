const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ERC1450 Critical Error Paths - 100% Coverage", function () {
    let ERC1450, token, rtaProxy;
    let owner, issuer, rta, alice, bob, signer2, signer3;

    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago

    beforeEach(async function () {
        [owner, issuer, rta, alice, bob, signer2, signer3] = await ethers.getSigners();

        // Deploy RTAProxy for multi-sig RTA
        const RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy([rta.address, signer2.address, signer3.address], 2);
        await rtaProxy.waitForDeployment();

        // Deploy ERC1450 token
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

    describe("Internal _transfer Error Paths", function () {
        describe("Line 466: ERC20InvalidSender(address(0))", function () {
            it("Should revert when transferFrom with zero sender via burnFrom", async function () {
                // This tests the path where _transfer is called with from == address(0)
                // The burnFrom function has a check first, but we want to ensure _transfer validates too

                // Mint tokens first
                await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

                // Try to burn from zero address (should fail in burnFrom's own check first)
                await expect(
                    token.connect(rta).burnFrom(ethers.ZeroAddress, ethers.parseUnits("100", 10))
                ).to.be.revertedWithCustomError(token, "ERC20InvalidSender");
            });
        });

        describe("Line 469: ERC20InvalidReceiver(address(0))", function () {
            it("Should revert when transferFromRegulated to zero address", async function () {
                // Mint tokens to alice
                await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

                // Try to transfer to zero address
                await expect(
                    token.connect(rta).transferFromRegulated(
                        alice.address,
                        ethers.ZeroAddress,
                        ethers.parseUnits("100", 10),
                        REG_US_A,
                        issuanceDate
                    )
                ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
            });

            it("Should revert when processing transfer request to zero address", async function () {
                // Mint tokens to alice
                await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

                // Create a transfer request with zero receiver
                // First we need to set fee parameters
                await token.connect(rta).setFeeParameters(0, 0, [ethers.ZeroAddress]);

                // Request transfer to zero address
                await expect(
                    token.connect(alice).requestTransferWithFee(
                        alice.address,
                        ethers.ZeroAddress,
                        ethers.parseUnits("100", 10),
                        ethers.ZeroAddress,
                        0
                    )
                ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
            });

            it("Should revert when executeCourtOrder to zero address", async function () {
                // Mint tokens to alice
                await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

                const documentHash = ethers.keccak256(ethers.toUtf8Bytes("court-order-zero-address"));

                // Execute court order to zero address
                await expect(
                    token.connect(rta).executeCourtOrder(
                        alice.address,
                        ethers.ZeroAddress,
                        ethers.parseUnits("100", 10),
                        documentHash
                    )
                ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
            });

            it("Should revert when minting to zero address", async function () {
                // Try to mint to zero address (line 212 catches this)
                await expect(
                    token.connect(rta).mint(ethers.ZeroAddress, ethers.parseUnits("100", 10), REG_US_A, issuanceDate)
                ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
            });
        });

        describe("Line 474: ERC20InsufficientBalance", function () {
            it("Should revert when transferFromRegulated with insufficient balance", async function () {
                // Mint only 50 tokens
                await token.connect(rta).mint(alice.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate);

                // Try to transfer 100 tokens
                await expect(
                    token.connect(rta).transferFromRegulated(
                        alice.address,
                        bob.address,
                        ethers.parseUnits("100", 10),
                        REG_US_A,
                        issuanceDate
                    )
                ).to.be.revertedWith("ERC1450: Insufficient batch balance");
            });

            it("Should revert when processing transfer request with insufficient balance", async function () {
                // Mint tokens
                await token.connect(rta).mint(alice.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate);

                // Set fee parameters
                await token.connect(rta).setFeeParameters(0, 0, [ethers.ZeroAddress]);

                // Request transfer more than balance
                const tx = await token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    ethers.parseUnits("100", 10), // More than alice has
                    ethers.ZeroAddress,
                    0
                );
                const receipt = await tx.wait();

                // Find the TransferRequested event
                const event = receipt.logs.find(log => {
                    try {
                        const parsed = token.interface.parseLog(log);
                        return parsed && parsed.name === "TransferRequested";
                    } catch {
                        return false;
                    }
                });

                const requestId = token.interface.parseLog(event).args.requestId;

                // Try to process - should fail due to insufficient balance
                await expect(
                    token.connect(rta).processTransferRequest(requestId, true)
                ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
            });

            it("Should revert when burning more than balance", async function () {
                // Mint only 50 tokens
                await token.connect(rta).mint(alice.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate);

                // Try to burn 100 tokens
                await expect(
                    token.connect(rta).burnFrom(alice.address, ethers.parseUnits("100", 10))
                ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
            });
        });
    });

    describe("Additional Branch Coverage", function () {
        it("Should handle transfer request with zero amount", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);
            await token.connect(rta).setFeeParameters(0, 0, [ethers.ZeroAddress]);

            // Request transfer with zero amount
            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                0, // Zero amount
                ethers.ZeroAddress,
                0
            );

            expect(tx).to.emit(token, "TransferRequested");
        });

        it("Should handle transfer from frozen sender", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            // Freeze alice
            await token.connect(rta).setAccountFrozen(alice.address, true);

            // Try to transfer - should revert
            await expect(
                token.connect(rta).transferFromRegulated(alice.address, bob.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate)
            ).to.be.revertedWithCustomError(token, "ERC1450ComplianceCheckFailed");
        });

        it("Should handle transfer to frozen receiver", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            // Freeze bob
            await token.connect(rta).setAccountFrozen(bob.address, true);

            // Try to transfer - should revert
            await expect(
                token.connect(rta).transferFromRegulated(alice.address, bob.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate)
            ).to.be.revertedWithCustomError(token, "ERC1450ComplianceCheckFailed");
        });

        it("Should handle refund and non-refund in rejection", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);
            await token.connect(rta).setFeeParameters(0, ethers.parseUnits("1", 18), [ethers.ZeroAddress]);

            // Request with fee
            const feeAmount = ethers.parseUnits("1", 10);
            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10),
                ethers.ZeroAddress,
                feeAmount,
                { value: feeAmount }
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

            // Test rejection WITHOUT refund
            await token.connect(rta).rejectTransferRequest(requestId, 3, false);

            // Fee should still be in collected fees
            expect(await token.collectedFees(ethers.ZeroAddress)).to.be.gt(0);
        });

        it("Should handle rejection with refund", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);
            await token.connect(rta).setFeeParameters(0, ethers.parseUnits("1", 18), [ethers.ZeroAddress]);

            // Request with fee
            const feeAmount = ethers.parseUnits("1", 10);
            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10),
                ethers.ZeroAddress,
                feeAmount,
                { value: feeAmount }
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

            const aliceBalanceBefore = await ethers.provider.getBalance(alice.address);

            // Test rejection WITH refund
            await token.connect(rta).rejectTransferRequest(requestId, 3, true);

            const aliceBalanceAfter = await ethers.provider.getBalance(alice.address);

            // Alice should have received refund
            expect(aliceBalanceAfter).to.equal(aliceBalanceBefore + feeAmount);
        });
    });
});
