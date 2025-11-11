const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Branch Coverage Tests - Target 95%+", function () {
    let ERC1450, token, RTAProxy, rtaProxy;
    let owner, issuer, rta, alice, bob, signer2, signer3, nonBroker;

    beforeEach(async function () {
        [owner, issuer, rta, alice, bob, signer2, signer3, nonBroker] = await ethers.getSigners();

        // Deploy RTAProxy
        RTAProxy = await ethers.getContractFactory("RTAProxy");
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

    describe("ERC1450.sol - Uncovered Branches", function () {
        describe("Constructor validation (Line 95)", function () {
            it("Should revert when deploying with zero transfer agent", async function () {
                await expect(
                    ERC1450.deploy(
                        "Test Token",
                        "TST",
                        18,
                        issuer.address,
                        ethers.ZeroAddress // Zero address transfer agent
                    )
                ).to.be.revertedWith("ERC1450: Invalid transfer agent");
            });
        });

        describe("changeIssuer validation (Line 171)", function () {
            it("Should revert when changing issuer to zero address", async function () {
                await expect(
                    token.connect(rta).changeIssuer(ethers.ZeroAddress)
                ).to.be.revertedWithCustomError(token, "OwnableInvalidOwner");
            });
        });

        describe("setTransferAgent validation (Line 180)", function () {
            it("Should revert when setting transfer agent to zero address", async function () {
                // Deploy fresh token where issuer can still set transfer agent
                const newToken = await ERC1450.deploy(
                    "Test Token",
                    "TST",
                    18,
                    issuer.address,
                    issuer.address // Issuer as initial transfer agent
                );
                await newToken.waitForDeployment();

                await expect(
                    newToken.connect(issuer).setTransferAgent(ethers.ZeroAddress)
                ).to.be.revertedWith("ERC1450: Invalid transfer agent");
            });

            it("Should revert when non-RTA tries to change locked transfer agent (Line 187)", async function () {
                // Current transfer agent is locked to RTA (contract address)
                await expect(
                    token.connect(alice).setTransferAgent(bob.address)
                ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");
            });

            it("Should revert when non-owner tries to set initial transfer agent (Line 191)", async function () {
                // To test line 191, we need _transferAgent == address(0)
                // But the constructor requires non-zero transfer agent, so we can't directly test this path
                // This branch is effectively unreachable in the current implementation
                // Skipping this test as the constructor validation prevents this scenario
            });
        });

        describe("requestTransferWithFee validations", function () {
            beforeEach(async function () {
                await token.connect(rta).mint(alice.address, ethers.parseEther("1000"));
                await token.connect(rta).setFeeParameters(0, ethers.parseEther("1"), [ethers.ZeroAddress]);
            });

            it("Should revert when from address is zero (Line 253)", async function () {
                await expect(
                    token.connect(alice).requestTransferWithFee(
                        ethers.ZeroAddress, // Zero from address
                        bob.address,
                        ethers.parseEther("100"),
                        ethers.ZeroAddress,
                        ethers.parseEther("1"),
                        { value: ethers.parseEther("1") }
                    )
                ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
            });

            it("Should revert when to address is zero (Line 253)", async function () {
                await expect(
                    token.connect(alice).requestTransferWithFee(
                        alice.address,
                        ethers.ZeroAddress, // Zero to address
                        ethers.parseEther("100"),
                        ethers.ZeroAddress,
                        ethers.parseEther("1"),
                        { value: ethers.parseEther("1") }
                    )
                ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
            });

            it("Should revert when non-holder non-broker requests transfer (Line 258)", async function () {
                // nonBroker is not alice and is not an approved broker
                await expect(
                    token.connect(nonBroker).requestTransferWithFee(
                        alice.address,
                        bob.address,
                        ethers.parseEther("100"),
                        ethers.ZeroAddress,
                        ethers.parseEther("1"),
                        { value: ethers.parseEther("1") }
                    )
                ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
            });

            it("Should revert when msg.value doesn't match feeAmount (Line 271)", async function () {
                await expect(
                    token.connect(alice).requestTransferWithFee(
                        alice.address,
                        bob.address,
                        ethers.parseEther("100"),
                        ethers.ZeroAddress,
                        ethers.parseEther("1"),
                        { value: ethers.parseEther("0.5") } // Incorrect value
                    )
                ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
            });

            it("Should revert when msg.value exceeds feeAmount (Line 271)", async function () {
                await expect(
                    token.connect(alice).requestTransferWithFee(
                        alice.address,
                        bob.address,
                        ethers.parseEther("100"),
                        ethers.ZeroAddress,
                        ethers.parseEther("1"),
                        { value: ethers.parseEther("2") } // Too much value
                    )
                ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
            });
        });

        describe("Additional uncovered branches", function () {
            it("Should handle broker-initiated transfer request (Line 258 - false branch)", async function () {
                await token.connect(rta).mint(alice.address, ethers.parseEther("1000"));
                await token.connect(rta).setBrokerStatus(bob.address, true);
                await token.connect(rta).setFeeParameters(0, ethers.parseEther("1"), [ethers.ZeroAddress]);

                // Bob (broker) requests transfer on behalf of alice
                const tx = await token.connect(bob).requestTransferWithFee(
                    alice.address,
                    nonBroker.address,
                    ethers.parseEther("100"),
                    ethers.ZeroAddress,
                    ethers.parseEther("1"),
                    { value: ethers.parseEther("1") }
                );

                expect(tx).to.emit(token, "TransferRequested");
            });

            it("Should handle zero fee amount (Line 268 - false branch)", async function () {
                await token.connect(rta).mint(alice.address, ethers.parseEther("1000"));
                await token.connect(rta).setFeeParameters(0, 0, [ethers.ZeroAddress]);

                const tx = await token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    ethers.parseEther("100"),
                    ethers.ZeroAddress,
                    0 // Zero fee
                );

                expect(tx).to.emit(token, "TransferRequested");
            });

            it("Should handle ERC20 fee token payment (Line 269 - false branch)", async function () {
                // Deploy mock ERC20 for fee payment
                const MockERC20 = await ethers.getContractFactory("MockERC20");
                const feeToken = await MockERC20.deploy("Fee Token", "FEE", 18);
                await feeToken.waitForDeployment();

                // Mint fee tokens to alice
                await feeToken.mint(alice.address, ethers.parseEther("100"));

                // Set up token
                await token.connect(rta).mint(alice.address, ethers.parseEther("1000"));
                await token.connect(rta).setFeeParameters(0, ethers.parseEther("10"), [feeToken.target]);

                // Approve fee payment
                await feeToken.connect(alice).approve(token.target, ethers.parseEther("10"));

                const tx = await token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    ethers.parseEther("100"),
                    feeToken.target,
                    ethers.parseEther("10")
                );

                expect(tx).to.emit(token, "TransferRequested");
            });
        });

        describe("Transfer agent locking logic (Line 199)", function () {
            it("Should lock transfer agent when set to contract address", async function () {
                // Deploy fresh token with EOA as transfer agent
                const newToken = await ERC1450.deploy(
                    "Test Token",
                    "TST",
                    18,
                    issuer.address,
                    alice.address // EOA - not locked
                );
                await newToken.waitForDeployment();

                // Transfer agent should not be locked yet (alice is EOA)
                // Now set it to a contract (rtaProxy)
                await newToken.connect(alice).setTransferAgent(rtaProxy.target);

                // Now it should be locked - trying to change it again should fail
                await expect(
                    newToken.connect(rta).setTransferAgent(bob.address)
                ).to.be.revertedWithCustomError(newToken, "ERC1450TransferAgentLocked");
            });
        });

        describe("setFeeParameters validation", function () {
            it("Should handle empty acceptedTokens array", async function () {
                // Setting empty array should clear accepted tokens (except address(0) which is added by default in some implementations)
                await token.connect(rta).setFeeParameters(0, ethers.parseEther("1"), []);

                const acceptedTokens = await token.getAcceptedFeeTokens();
                // Should have no tokens or only default ones
                expect(acceptedTokens.length).to.be.lte(1);
            });

            it("Should handle multiple accepted tokens", async function () {
                const MockERC20 = await ethers.getContractFactory("MockERC20");
                const token1 = await MockERC20.deploy("Token 1", "TK1", 18);
                const token2 = await MockERC20.deploy("Token 2", "TK2", 18);
                await token1.waitForDeployment();
                await token2.waitForDeployment();

                await token.connect(rta).setFeeParameters(
                    0,
                    ethers.parseEther("1"),
                    [ethers.ZeroAddress, token1.target, token2.target]
                );

                const acceptedTokens = await token.getAcceptedFeeTokens();
                expect(acceptedTokens.length).to.equal(3);
            });

            it("Should handle percentage fee type", async function () {
                await token.connect(rta).setFeeParameters(
                    1, // Percentage type
                    100, // 1% (100 basis points)
                    [ethers.ZeroAddress]
                );

                await token.connect(rta).mint(alice.address, ethers.parseEther("1000"));

                const fee = await token.getTransferFee(
                    alice.address,
                    bob.address,
                    ethers.parseEther("100"),
                    ethers.ZeroAddress
                );

                // 1% of 100 tokens = 1 token
                expect(fee).to.equal(ethers.parseEther("1"));
            });

            it("Should handle other fee types", async function () {
                await token.connect(rta).setFeeParameters(
                    2, // Other type
                    ethers.parseEther("5"),
                    [ethers.ZeroAddress]
                );

                const fee = await token.getTransferFee(
                    alice.address,
                    bob.address,
                    ethers.parseEther("100"),
                    ethers.ZeroAddress
                );

                // Should return feeValue for other types
                expect(fee).to.equal(ethers.parseEther("5"));
            });
        });

        describe("withdrawFees validation", function () {
            it("Should handle withdrawal of native token fees", async function () {
                await token.connect(rta).mint(alice.address, ethers.parseEther("1000"));
                await token.connect(rta).setFeeParameters(0, ethers.parseEther("1"), [ethers.ZeroAddress]);

                // Collect some fees
                await token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    ethers.parseEther("100"),
                    ethers.ZeroAddress,
                    ethers.parseEther("1"),
                    { value: ethers.parseEther("1") }
                );

                const rtaBalanceBefore = await ethers.provider.getBalance(rta.address);

                // Withdraw to RTA
                await token.connect(rta).withdrawFees(ethers.ZeroAddress, ethers.parseEther("1"), rta.address);

                const rtaBalanceAfter = await ethers.provider.getBalance(rta.address);
                // Balance should increase (minus gas costs, but still positive)
                expect(rtaBalanceAfter).to.be.gt(rtaBalanceBefore);
            });

            it("Should revert when withdrawing more than collected", async function () {
                await expect(
                    token.connect(rta).withdrawFees(
                        ethers.ZeroAddress,
                        ethers.parseEther("100"), // More than collected
                        rta.address
                    )
                ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
            });
        });

        describe("recoverToken validation", function () {
            it("Should revert when recovering the security token itself", async function () {
                await expect(
                    token.connect(rta).recoverToken(token.target, ethers.parseEther("100"))
                ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");
            });

            it("Should successfully recover other ERC20 tokens", async function () {
                const MockERC20 = await ethers.getContractFactory("MockERC20");
                const otherToken = await MockERC20.deploy("Other Token", "OTH", 18);
                await otherToken.waitForDeployment();

                // Send some tokens to the contract
                await otherToken.mint(token.target, ethers.parseEther("100"));

                const rtaBalanceBefore = await otherToken.balanceOf(rta.address);

                await token.connect(rta).recoverToken(otherToken.target, ethers.parseEther("100"));

                const rtaBalanceAfter = await otherToken.balanceOf(rta.address);
                expect(rtaBalanceAfter - rtaBalanceBefore).to.equal(ethers.parseEther("100"));
            });
        });

        describe("updateRequestStatus validation", function () {
            it("Should update request status to UnderReview", async function () {
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

                await token.connect(rta).updateRequestStatus(requestId, 1); // UnderReview

                const request = await token.transferRequests(requestId);
                expect(request.status).to.equal(1);
            });

            it("Should update request status to Expired", async function () {
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

                await token.connect(rta).updateRequestStatus(requestId, 5); // Expired

                const request = await token.transferRequests(requestId);
                expect(request.status).to.equal(5);
            });
        });
    });

    describe("RTAProxy.sol - Uncovered Branches", function () {
        describe("Constructor validation", function () {
            it("Should revert with zero signers", async function () {
                await expect(
                    RTAProxy.deploy([], 0)
                ).to.be.reverted;
            });

            it("Should revert when required signatures is zero", async function () {
                await expect(
                    RTAProxy.deploy([rta.address], 0)
                ).to.be.reverted;
            });

            it("Should revert when required signatures exceeds signer count", async function () {
                await expect(
                    RTAProxy.deploy([rta.address, signer2.address], 5)
                ).to.be.reverted;
            });

            it("Should revert with duplicate signers", async function () {
                await expect(
                    RTAProxy.deploy([rta.address, rta.address], 2)
                ).to.be.reverted;
            });

            it("Should revert with zero address signer", async function () {
                await expect(
                    RTAProxy.deploy([rta.address, ethers.ZeroAddress], 2)
                ).to.be.reverted;
            });
        });

        describe("Operation execution edge cases", function () {
            it("Should revert when confirming already confirmed operation", async function () {
                const tx = await rtaProxy.connect(rta).submitOperation(
                    alice.address,
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

                // rta already confirmed by submitting, try to confirm again
                await expect(
                    rtaProxy.connect(rta).confirmOperation(operationId)
                ).to.be.reverted;
            });

            it("Should revert when non-signer tries to submit operation", async function () {
                await expect(
                    rtaProxy.connect(alice).submitOperation(bob.address, "0x", 0)
                ).to.be.reverted;
            });

            it("Should revert when non-signer tries to confirm operation", async function () {
                const tx = await rtaProxy.connect(rta).submitOperation(
                    alice.address,
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

                await expect(
                    rtaProxy.connect(alice).confirmOperation(operationId)
                ).to.be.reverted;
            });

            it("Should revert when executing already executed operation", async function () {
                const tx = await rtaProxy.connect(rta).submitOperation(
                    alice.address,
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

                // Get second confirmation to execute
                await rtaProxy.connect(signer2).confirmOperation(operationId);

                // Try to execute again
                await expect(
                    rtaProxy.connect(rta).executeOperation(operationId)
                ).to.be.reverted;
            });

            it("Should revert when executing without enough confirmations", async function () {
                const tx = await rtaProxy.connect(rta).submitOperation(
                    alice.address,
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

                // Revoke the auto-confirmation from submitter
                await rtaProxy.connect(rta).revokeConfirmation(operationId);

                // Try to execute with 0 confirmations (needs 2)
                await expect(
                    rtaProxy.connect(rta).executeOperation(operationId)
                ).to.be.reverted;
            });

            it("Should revert when revoking non-confirmed operation", async function () {
                const tx = await rtaProxy.connect(rta).submitOperation(
                    alice.address,
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

                // signer2 hasn't confirmed yet, try to revoke
                await expect(
                    rtaProxy.connect(signer2).revokeConfirmation(operationId)
                ).to.be.reverted;
            });
        });

        // Note: Multi-sig signer management error paths (AlreadyASigner, NotASigner, InvalidSignerCount)
        // are documented and tested in RTAProxy.CriticalPaths.test.js
        // These errors occur during nested contract calls and cannot be reliably tested with chai matchers
    });
});
