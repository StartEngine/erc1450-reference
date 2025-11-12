const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Final Branch Coverage - Push to 90%+", function () {
    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago

    let ERC1450, token, RTAProxy, rtaProxy;
    let ERC1450Upgradeable, tokenUpgradeable, RTAProxyUpgradeable, rtaProxyUpgradeable;
    let owner, issuer, rta, alice, bob, charlie, signer2, signer3;
    let mockERC20, mockERC20_2;

    beforeEach(async function () {
        [owner, issuer, rta, alice, bob, charlie, signer2, signer3] = await ethers.getSigners();

        // Deploy mock ERC20 tokens for fee payments
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockERC20 = await MockERC20.deploy("Mock Token", "MOCK", 18);
        await mockERC20.waitForDeployment();
        mockERC20_2 = await MockERC20.deploy("Mock Token 2", "MOCK2", 18);
        await mockERC20_2.waitForDeployment();

        // Mint some mock tokens to alice
        await mockERC20.mint(alice.address, ethers.parseEther("10000"));

        // Deploy standard contracts
        RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy([rta.address, signer2.address, signer3.address], 2);
        await rtaProxy.waitForDeployment();

        ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy("Test Security Token", "TST", 18, issuer.address, rtaProxy.target);
        await token.waitForDeployment();

        // Deploy upgradeable contracts
        RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
        rtaProxyUpgradeable = await upgrades.deployProxy(
            RTAProxyUpgradeable,
            [[rta.address, signer2.address, signer3.address], 2],
            { kind: "uups" }
        );
        await rtaProxyUpgradeable.waitForDeployment();

        ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
        tokenUpgradeable = await upgrades.deployProxy(
            ERC1450Upgradeable,
            ["Test Security Token", "TST", 18, issuer.address, rtaProxyUpgradeable.target],
            { kind: "uups" }
        );
        await tokenUpgradeable.waitForDeployment();
    });

    describe("ERC1450.sol - Remaining Uncovered Branches", function () {
        describe("Line 192: setTransferAgent unauthorized caller", function () {
            it("Should revert when non-owner tries to set initial transfer agent", async function () {
                // This test is actually not feasible because line 192 requires:
                // 1. _transferAgent == address(0) (to pass line 187)
                // 2. msg.sender != owner() (to enter line 191 if-block)
                // 3. msg.sender != _transferAgent (which is address(0))
                // But the constructor always sets a non-zero _transferAgent, making this path unreachable.

                // The error thrown for non-owner/non-RTA calls is ERC1450OnlyRTA (line 188)
                const freshToken = await ERC1450.deploy(
                    "Fresh Token",
                    "FRSH",
                    18,
                    issuer.address,
                    alice.address
                );
                await freshToken.waitForDeployment();

                // Try to have bob (who is neither owner nor transfer agent) set a new agent
                // This hits line 188 (ERC1450OnlyRTA), not line 192
                await expect(
                    freshToken.connect(bob).setTransferAgent(charlie.address)
                ).to.be.revertedWithCustomError(freshToken, "ERC1450OnlyRTA");
            });
        });

        describe("Line 332: ERC20 fee token refund", function () {
            it("Should refund ERC20 token when rejecting transfer request", async function () {
                // Set up ERC20 fee token via multi-sig
                const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                    0,
                    ethers.parseEther("10"),
                    [mockERC20.target]
                ]);
                const tx0 = await rtaProxy.connect(rta).submitOperation(token.target, setFeeData, 0);
                const receipt0 = await tx0.wait();
                const opId0 = rtaProxy.interface.parseLog(
                    receipt0.logs.find(log => {
                        try {
                            return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                        } catch { return false; }
                    })
                ).args.operationId;
                await rtaProxy.connect(signer2).confirmOperation(opId0);

                // Mint tokens to alice
                const mintData = token.interface.encodeFunctionData("mint", [alice.address, ethers.parseEther("1000")
                , REG_US_A, issuanceDate]);
                const tx1 = await rtaProxy.connect(rta).submitOperation(token.target, mintData, 0);
                const receipt1 = await tx1.wait();
                const opId1 = rtaProxy.interface.parseLog(
                    receipt1.logs.find(log => {
                        try {
                            return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                        } catch { return false; }
                    })
                ).args.operationId;
                await rtaProxy.connect(signer2).confirmOperation(opId1);

                // Alice approves ERC20 for fee payment
                await mockERC20.connect(alice).approve(token.target, ethers.parseEther("10"));

                // Alice requests transfer with ERC20 fee
                const tx2 = await token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    ethers.parseEther("100"),
                    mockERC20.target,
                    ethers.parseEther("10")
                );

                const receipt2 = await tx2.wait();
                const requestId = token.interface.parseLog(
                    receipt2.logs.find(log => {
                        try {
                            const parsed = token.interface.parseLog(log);
                            return parsed && parsed.name === "TransferRequested";
                        } catch { return false; }
                    })
                ).args.requestId;

                // Check alice's ERC20 balance before refund
                const balanceBefore = await mockERC20.balanceOf(alice.address);

                // Reject with refund - THIS HITS LINE 332
                const rejectData = token.interface.encodeFunctionData("rejectTransferRequest", [
                    requestId,
                    3,
                    true
                ]);
                const tx3 = await rtaProxy.connect(rta).submitOperation(token.target, rejectData, 0);
                const receipt3 = await tx3.wait();
                const opId2 = rtaProxy.interface.parseLog(
                    receipt3.logs.find(log => {
                        try {
                            return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                        } catch { return false; }
                    })
                ).args.operationId;
                await rtaProxy.connect(signer2).confirmOperation(opId2);

                // Check alice got refund
                const balanceAfter = await mockERC20.balanceOf(alice.address);
                expect(balanceAfter).to.equal(balanceBefore + ethers.parseEther("10"));
            });
        });

        describe("Line 354: getTransferFee with non-accepted token", function () {
            it("Should return 0 for non-accepted fee token", async function () {
                // Set up accepted fee tokens (only mockERC20, not mockERC20_2)
                const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                    0,
                    ethers.parseEther("5"),
                    [mockERC20.target]
                ]);
                const tx = await rtaProxy.connect(rta).submitOperation(token.target, setFeeData, 0);
                const receipt = await tx.wait();
                const opId = rtaProxy.interface.parseLog(
                    receipt.logs.find(log => {
                        try {
                            return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                        } catch { return false; }
                    })
                ).args.operationId;
                await rtaProxy.connect(signer2).confirmOperation(opId);

                // Query fee for non-accepted token - THIS HITS LINE 354
                const fee = await token.getTransferFee(
                    alice.address,
                    bob.address,
                    ethers.parseEther("100"),
                    mockERC20_2.target  // This token is NOT in the accepted list
                );

                expect(fee).to.equal(0);
            });
        });
    });

    describe("ERC1450Upgradeable.sol - Remaining Uncovered Branches", function () {
        describe("Line 372: setTransferAgent unauthorized", function () {
            it("Should revert when non-owner non-RTA tries to set transfer agent", async function () {
                const freshToken = await upgrades.deployProxy(
                    ERC1450Upgradeable,
                    ["Fresh Token", "FRSH", 18, issuer.address, alice.address],
                    { kind: "uups" }
                );
                await freshToken.waitForDeployment();

                // Same as standard version - hits ERC1450OnlyRTA, not OwnableUnauthorizedAccount
                await expect(
                    freshToken.connect(bob).setTransferAgent(charlie.address)
                ).to.be.revertedWithCustomError(freshToken, "ERC1450OnlyRTA");
            });
        });

        describe("ERC20 fee token refund", function () {
            it("Should refund ERC20 token when rejecting transfer request", async function () {
                const setFeeData = tokenUpgradeable.interface.encodeFunctionData("setFeeParameters", [
                    0,
                    ethers.parseEther("10"),
                    [mockERC20.target]
                ]);
                const tx1 = await rtaProxyUpgradeable.connect(rta).submitOperation(
                    tokenUpgradeable.target,
                    setFeeData,
                    0
                );
                const receipt1 = await tx1.wait();
                const opId1 = rtaProxyUpgradeable.interface.parseLog(
                    receipt1.logs.find(log => {
                        try {
                            return rtaProxyUpgradeable.interface.parseLog(log).name === "OperationSubmitted";
                        } catch { return false; }
                    })
                ).args.operationId;
                await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId1);

                const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [alice.address, ethers.parseEther("1000")
                , REG_US_A, issuanceDate]);
                const tx2 = await rtaProxyUpgradeable.connect(rta).submitOperation(
                    tokenUpgradeable.target,
                    mintData,
                    0
                );
                const receipt2 = await tx2.wait();
                const opId2 = rtaProxyUpgradeable.interface.parseLog(
                    receipt2.logs.find(log => {
                        try {
                            return rtaProxyUpgradeable.interface.parseLog(log).name === "OperationSubmitted";
                        } catch { return false; }
                    })
                ).args.operationId;
                await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId2);

                await mockERC20.connect(alice).approve(tokenUpgradeable.target, ethers.parseEther("10"));

                const tx3 = await tokenUpgradeable.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    ethers.parseEther("100"),
                    mockERC20.target,
                    ethers.parseEther("10")
                );

                const receipt3 = await tx3.wait();
                const requestId = tokenUpgradeable.interface.parseLog(
                    receipt3.logs.find(log => {
                        try {
                            const parsed = tokenUpgradeable.interface.parseLog(log);
                            return parsed && parsed.name === "TransferRequested";
                        } catch { return false; }
                    })
                ).args.requestId;

                const balanceBefore = await mockERC20.balanceOf(alice.address);

                const rejectData = tokenUpgradeable.interface.encodeFunctionData("rejectTransferRequest", [
                    requestId,
                    3,
                    true
                ]);
                const tx4 = await rtaProxyUpgradeable.connect(rta).submitOperation(
                    tokenUpgradeable.target,
                    rejectData,
                    0
                );
                const receipt4 = await tx4.wait();
                const opId3 = rtaProxyUpgradeable.interface.parseLog(
                    receipt4.logs.find(log => {
                        try {
                            return rtaProxyUpgradeable.interface.parseLog(log).name === "OperationSubmitted";
                        } catch { return false; }
                    })
                ).args.operationId;
                await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId3);

                const balanceAfter = await mockERC20.balanceOf(alice.address);
                expect(balanceAfter).to.be.gt(balanceBefore);
            });
        });

        describe("getTransferFee with non-accepted token", function () {
            it("Should return 0 for non-accepted fee token", async function () {
                const setFeeData = tokenUpgradeable.interface.encodeFunctionData("setFeeParameters", [
                    0,
                    ethers.parseEther("5"),
                    [mockERC20.target]
                ]);
                const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(
                    tokenUpgradeable.target,
                    setFeeData,
                    0
                );
                const receipt = await tx.wait();
                const opId = rtaProxyUpgradeable.interface.parseLog(
                    receipt.logs.find(log => {
                        try {
                            return rtaProxyUpgradeable.interface.parseLog(log).name === "OperationSubmitted";
                        } catch { return false; }
                    })
                ).args.operationId;
                await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);

                const fee = await tokenUpgradeable.getTransferFee(
                    alice.address,
                    bob.address,
                    ethers.parseEther("100"),
                    mockERC20_2.target
                );

                expect(fee).to.equal(0);
            });
        });
    });

    describe("RTAProxyUpgradeable.sol - Signer Management Error Paths", function () {
        describe("Line 390: addSigner when already a signer", function () {
            it("Should revert when trying to add existing signer", async function () {
                // Try to add rta (who is already a signer) again
                const addSignerData = rtaProxyUpgradeable.interface.encodeFunctionData("addSigner", [
                    rta.address
                ]);

                const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(
                    rtaProxyUpgradeable.target,
                    addSignerData,
                    0
                );
                const receipt = await tx.wait();
                const opId = rtaProxyUpgradeable.interface.parseLog(
                    receipt.logs.find(log => {
                        try {
                            return rtaProxyUpgradeable.interface.parseLog(log).name === "OperationSubmitted";
                        } catch { return false; }
                    })
                ).args.operationId;

                // Confirm and execute - should revert with AlreadyASigner during execution
                // Using try/catch because hardhat chai matchers can't decode nested call errors
                try {
                    await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);
                    expect.fail("Expected transaction to revert");
                } catch (error) {
                    expect(error.message).to.not.equal("Expected transaction to revert");
                }
            });
        });

        describe("Line 408: removeSigner when not a signer", function () {
            it("Should revert when trying to remove non-existent signer", async function () {
                // Try to remove charlie (who is NOT a signer)
                const removeSignerData = rtaProxyUpgradeable.interface.encodeFunctionData("removeSigner", [
                    charlie.address
                ]);

                const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(
                    rtaProxyUpgradeable.target,
                    removeSignerData,
                    0
                );
                const receipt = await tx.wait();
                const opId = rtaProxyUpgradeable.interface.parseLog(
                    receipt.logs.find(log => {
                        try {
                            return rtaProxyUpgradeable.interface.parseLog(log).name === "OperationSubmitted";
                        } catch { return false; }
                    })
                ).args.operationId;

                // Confirm and execute - should revert with NotASigner
                try {
                    await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);
                    expect.fail("Expected transaction to revert");
                } catch (error) {
                    expect(error.message).to.not.equal("Expected transaction to revert");
                }
            });
        });

        describe("Line 433: updateRequiredSignatures with invalid count", function () {
            it("Should revert when setting required signatures to 0", async function () {
                const updateData = rtaProxyUpgradeable.interface.encodeFunctionData(
                    "updateRequiredSignatures",
                    [0]
                );

                const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(
                    rtaProxyUpgradeable.target,
                    updateData,
                    0
                );
                const receipt = await tx.wait();
                const opId = rtaProxyUpgradeable.interface.parseLog(
                    receipt.logs.find(log => {
                        try {
                            return rtaProxyUpgradeable.interface.parseLog(log).name === "OperationSubmitted";
                        } catch { return false; }
                    })
                ).args.operationId;

                try {
                    await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);
                    expect.fail("Expected transaction to revert");
                } catch (error) {
                    expect(error.message).to.not.equal("Expected transaction to revert");
                }
            });

            it("Should revert when setting required signatures above signer count", async function () {
                const updateData = rtaProxyUpgradeable.interface.encodeFunctionData(
                    "updateRequiredSignatures",
                    [10]  // More than the 3 signers we have
                );

                const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(
                    rtaProxyUpgradeable.target,
                    updateData,
                    0
                );
                const receipt = await tx.wait();
                const opId = rtaProxyUpgradeable.interface.parseLog(
                    receipt.logs.find(log => {
                        try {
                            return rtaProxyUpgradeable.interface.parseLog(log).name === "OperationSubmitted";
                        } catch { return false; }
                    })
                ).args.operationId;

                try {
                    await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);
                    expect.fail("Expected transaction to revert");
                } catch (error) {
                    expect(error.message).to.not.equal("Expected transaction to revert");
                }
            });
        });
    });

    describe("RTAProxy.sol - Same error paths", function () {
        it("Should revert when trying to add existing signer", async function () {
            const addSignerData = rtaProxy.interface.encodeFunctionData("addSigner", [rta.address]);
            const tx = await rtaProxy.connect(rta).submitOperation(rtaProxy.target, addSignerData, 0);
            const receipt = await tx.wait();
            const opId = rtaProxy.interface.parseLog(
                receipt.logs.find(log => {
                    try {
                        return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                    } catch { return false; }
                })
            ).args.operationId;

            try {
                await rtaProxy.connect(signer2).confirmOperation(opId);
                expect.fail("Expected transaction to revert");
            } catch (error) {
                expect(error.message).to.not.equal("Expected transaction to revert");
            }
        });

        it("Should revert when trying to remove non-existent signer", async function () {
            const removeSignerData = rtaProxy.interface.encodeFunctionData("removeSigner", [charlie.address]);
            const tx = await rtaProxy.connect(rta).submitOperation(rtaProxy.target, removeSignerData, 0);
            const receipt = await tx.wait();
            const opId = rtaProxy.interface.parseLog(
                receipt.logs.find(log => {
                    try {
                        return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                    } catch { return false; }
                })
            ).args.operationId;

            try {
                await rtaProxy.connect(signer2).confirmOperation(opId);
                expect.fail("Expected transaction to revert");
            } catch (error) {
                expect(error.message).to.not.equal("Expected transaction to revert");
            }
        });

        it("Should revert when setting required signatures to invalid values", async function () {
            const updateData = rtaProxy.interface.encodeFunctionData("updateRequiredSignatures", [0]);
            const tx = await rtaProxy.connect(rta).submitOperation(rtaProxy.target, updateData, 0);
            const receipt = await tx.wait();
            const opId = rtaProxy.interface.parseLog(
                receipt.logs.find(log => {
                    try {
                        return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                    } catch { return false; }
                })
            ).args.operationId;

            try {
                await rtaProxy.connect(signer2).confirmOperation(opId);
                expect.fail("Expected transaction to revert");
            } catch (error) {
                expect(error.message).to.not.equal("Expected transaction to revert");
            }
        });
    });
});
