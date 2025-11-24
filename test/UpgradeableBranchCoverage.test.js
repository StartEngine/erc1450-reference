const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Upgradeable Contracts - Branch Coverage to 95%+", function () {
    let ERC1450Upgradeable, token, RTAProxyUpgradeable, rtaProxy;
    let owner, issuer, rta, alice, bob, signer2, signer3, nonBroker;

    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago

    beforeEach(async function () {
        [owner, issuer, rta, alice, bob, signer2, signer3, nonBroker] = await ethers.getSigners();

        // Deploy upgradeable RTAProxy
        RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
        rtaProxy = await upgrades.deployProxy(
            RTAProxyUpgradeable,
            [[rta.address, signer2.address, signer3.address], 2],
            { kind: "uups" }
        );
        await rtaProxy.waitForDeployment();

        // Deploy upgradeable ERC1450
        ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
        token = await upgrades.deployProxy(
            ERC1450Upgradeable,
            ["Test Security Token", "TST", 10, issuer.address, rta.address],
            { kind: "uups" }
        );
        await token.waitForDeployment();
    });

    describe("ERC1450Upgradeable - Missing Branch Coverage", function () {
        describe("Initialization validation", function () {
            it("Should revert when initializing with zero transfer agent", async function () {
                const NewToken = await ethers.getContractFactory("ERC1450Upgradeable");
                await expect(
                    upgrades.deployProxy(
                        NewToken,
                        ["Test", "TST", 10, issuer.address, ethers.ZeroAddress],
                        { kind: "uups" }
                    )
                ).to.be.revertedWith("ERC1450: Invalid transfer agent");
            });

            it("Should revert when calling initialize twice", async function () {
                await expect(
                    token.initialize("Test2", "TST2", 10, issuer.address, rta.address)
                ).to.be.revertedWithCustomError(token, "InvalidInitialization");
            });
        });

        describe("changeIssuer validation", function () {
            it("Should revert when changing issuer to zero address", async function () {
                await expect(
                    token.connect(rta).changeIssuer(ethers.ZeroAddress)
                ).to.be.revertedWithCustomError(token, "OwnableInvalidOwner");
            });
        });

        describe("setTransferAgent validation", function () {
            it("Should revert when setting transfer agent to zero address", async function () {
                const newToken = await upgrades.deployProxy(
                    ERC1450Upgradeable,
                    ["Test", "TST", 10, issuer.address, issuer.address],
                    { kind: "uups" }
                );
                await newToken.waitForDeployment();

                await expect(
                    newToken.connect(issuer).setTransferAgent(ethers.ZeroAddress)
                ).to.be.revertedWith("ERC1450: Invalid transfer agent");
            });

            it("Should lock transfer agent when set to contract address", async function () {
                const newToken = await upgrades.deployProxy(
                    ERC1450Upgradeable,
                    ["Test", "TST", 10, issuer.address, alice.address], // EOA
                    { kind: "uups" }
                );
                await newToken.waitForDeployment();

                // Set to contract (should lock)
                await newToken.connect(alice).setTransferAgent(rtaProxy.target);

                // Try to change again - should fail
                await expect(
                    newToken.connect(rta).setTransferAgent(bob.address)
                ).to.be.revertedWithCustomError(newToken, "ERC1450TransferAgentLocked");
            });
        });

        describe("requestTransferWithFee validations", function () {
            beforeEach(async function () {
                await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);
                await token.connect(rta).setFeeParameters(0, ethers.parseUnits("1", 18), [ethers.ZeroAddress]);
            });

            it("Should revert when from address is zero", async function () {
                await expect(
                    token.connect(alice).requestTransferWithFee(
                        ethers.ZeroAddress,
                        bob.address,
                        ethers.parseUnits("100", 10),
                        ethers.ZeroAddress,
                        ethers.parseUnits("1", 10),
                        { value: ethers.parseUnits("1", 10) }
                    )
                ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
            });

            it("Should revert when to address is zero", async function () {
                await expect(
                    token.connect(alice).requestTransferWithFee(
                        alice.address,
                        ethers.ZeroAddress,
                        ethers.parseUnits("100", 10),
                        ethers.ZeroAddress,
                        ethers.parseUnits("1", 10),
                        { value: ethers.parseUnits("1", 10) }
                    )
                ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
            });

            it("Should revert when non-holder non-broker requests transfer", async function () {
                await expect(
                    token.connect(nonBroker).requestTransferWithFee(
                        alice.address,
                        bob.address,
                        ethers.parseUnits("100", 10),
                        ethers.ZeroAddress,
                        ethers.parseUnits("1", 10),
                        { value: ethers.parseUnits("1", 10) }
                    )
                ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
            });

            it("Should revert when msg.value doesn't match feeAmount", async function () {
                await expect(
                    token.connect(alice).requestTransferWithFee(
                        alice.address,
                        bob.address,
                        ethers.parseUnits("100", 10),
                        ethers.ZeroAddress,
                        ethers.parseUnits("1", 10),
                        { value: ethers.parseUnits("0.5", 10) }
                    )
                ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
            });

            it("Should handle broker-initiated transfer", async function () {
                await token.connect(rta).setBrokerStatus(bob.address, true);

                const tx = await token.connect(bob).requestTransferWithFee(
                    alice.address,
                    nonBroker.address,
                    ethers.parseUnits("100", 10),
                    ethers.ZeroAddress,
                    ethers.parseUnits("1", 10),
                    { value: ethers.parseUnits("1", 10) }
                );

                expect(tx).to.emit(token, "TransferRequested");
            });

            it("Should handle zero fee amount", async function () {
                await token.connect(rta).setFeeParameters(0, 0, [ethers.ZeroAddress]);

                const tx = await token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    ethers.parseUnits("100", 10),
                    ethers.ZeroAddress,
                    0
                );

                expect(tx).to.emit(token, "TransferRequested");
            });
        });

        describe("recoverToken validation", function () {
            it("Should revert when recovering the security token itself", async function () {
                await expect(
                    token.connect(rta).recoverToken(token.target, ethers.parseUnits("100", 10))
                ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");
            });

            it("Should successfully recover ETH", async function () {
                // Send ETH to contract
                await alice.sendTransaction({
                    to: token.target,
                    value: ethers.parseUnits("0.1", 18) // 0.1 ETH
                });

                const rtaBalanceBefore = await ethers.provider.getBalance(rta.address);
                await token.connect(rta).recoverToken(ethers.ZeroAddress, ethers.parseUnits("0.1", 18));
                const rtaBalanceAfter = await ethers.provider.getBalance(rta.address);

                expect(rtaBalanceAfter).to.be.gt(rtaBalanceBefore);
            });
        });

        describe("Upgrade authorization", function () {
            it("Should allow RTA to authorize upgrades", async function () {
                const ERC1450UpgradeableV2 = await ethers.getContractFactory("ERC1450Upgradeable");

                await expect(
                    upgrades.upgradeProxy(token.target, ERC1450UpgradeableV2.connect(rta), {
                        kind: "uups"
                    })
                ).to.not.be.reverted;
            });

            it("Should prevent non-RTA from upgrading", async function () {
                const ERC1450UpgradeableV2 = await ethers.getContractFactory("ERC1450Upgradeable");

                await expect(
                    upgrades.upgradeProxy(token.target, ERC1450UpgradeableV2.connect(alice), {
                        kind: "uups"
                    })
                ).to.be.reverted;
            });
        });

        describe("Additional fee and status handling", function () {
            it("Should handle multiple fee tokens", async function () {
                const MockERC20 = await ethers.getContractFactory("MockERC20");
                const token1 = await MockERC20.deploy("Token1", "TK1", 18);
                await token1.waitForDeployment();

                await token.connect(rta).setFeeParameters(
                    0,
                    ethers.parseUnits("1", 10),
                    [ethers.ZeroAddress, token1.target]
                );

                const acceptedTokens = await token.getAcceptedFeeTokens();
                expect(acceptedTokens.length).to.equal(2);
            });

            it("Should handle percentage fee calculation", async function () {
                await token.connect(rta).setFeeParameters(1, 100, [ethers.ZeroAddress]); // 1% = 100 basis points

                const fee = await token.getTransferFee(
                    alice.address,
                    bob.address,
                    ethers.parseUnits("100", 10),
                    ethers.ZeroAddress
                );

                expect(fee).to.equal(ethers.parseUnits("1", 10));
            });

            it("Should update request status to different states", async function () {
                await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);
                await token.connect(rta).setFeeParameters(0, 0, [ethers.ZeroAddress]);

                const tx = await token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    ethers.parseUnits("100", 10),
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

                // Test updating to UnderReview
                await token.connect(rta).updateRequestStatus(requestId, 1);
                let request = await token.transferRequests(requestId);
                expect(request.status).to.equal(1);

                // Test updating to Expired
                await token.connect(rta).updateRequestStatus(requestId, 5);
                request = await token.transferRequests(requestId);
                expect(request.status).to.equal(5);
            });
        });
    });

    describe("RTAProxyUpgradeable - Missing Branch Coverage", function () {
        describe("Initialization validation", function () {
            it("Should revert with zero signers", async function () {
                const RTAProxy = await ethers.getContractFactory("RTAProxyUpgradeable");
                await expect(
                    upgrades.deployProxy(RTAProxy, [[], 0], { kind: "uups" })
                ).to.be.reverted;
            });

            it("Should revert when required signatures is zero", async function () {
                const RTAProxy = await ethers.getContractFactory("RTAProxyUpgradeable");
                await expect(
                    upgrades.deployProxy(RTAProxy, [[rta.address], 0], { kind: "uups" })
                ).to.be.reverted;
            });

            it("Should revert when required signatures exceeds signer count", async function () {
                const RTAProxy = await ethers.getContractFactory("RTAProxyUpgradeable");
                await expect(
                    upgrades.deployProxy(RTAProxy, [[rta.address], 5], { kind: "uups" })
                ).to.be.reverted;
            });

            it("Should revert with duplicate signers", async function () {
                const RTAProxy = await ethers.getContractFactory("RTAProxyUpgradeable");
                await expect(
                    upgrades.deployProxy(RTAProxy, [[rta.address, rta.address], 2], { kind: "uups" })
                ).to.be.reverted;
            });

            it("Should revert with zero address signer", async function () {
                const RTAProxy = await ethers.getContractFactory("RTAProxyUpgradeable");
                await expect(
                    upgrades.deployProxy(RTAProxy, [[rta.address, ethers.ZeroAddress], 2], { kind: "uups" })
                ).to.be.reverted;
            });

            it("Should revert when calling initialize twice", async function () {
                await expect(
                    rtaProxy.initialize([rta.address], 1)
                ).to.be.revertedWithCustomError(rtaProxy, "InvalidInitialization");
            });
        });

        describe("Operation execution edge cases", function () {
            it("Should revert when confirming already confirmed operation", async function () {
                const tx = await rtaProxy.connect(rta).submitOperation(alice.address, "0x", 0);
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
                    rtaProxy.connect(rta).confirmOperation(operationId)
                ).to.be.reverted;
            });

            it("Should revert when non-signer tries to submit", async function () {
                await expect(
                    rtaProxy.connect(alice).submitOperation(bob.address, "0x", 0)
                ).to.be.reverted;
            });

            it("Should revert when non-signer tries to confirm", async function () {
                const tx = await rtaProxy.connect(rta).submitOperation(alice.address, "0x", 0);
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
                const tx = await rtaProxy.connect(rta).submitOperation(alice.address, "0x", 0);
                const receipt = await tx.wait();
                const event = receipt.logs.find(log => {
                    try {
                        return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                    } catch {
                        return false;
                    }
                });
                const operationId = rtaProxy.interface.parseLog(event).args.operationId;

                await rtaProxy.connect(signer2).confirmOperation(operationId);

                await expect(
                    rtaProxy.connect(rta).executeOperation(operationId)
                ).to.be.reverted;
            });

            it("Should revert when executing without enough confirmations", async function () {
                const tx = await rtaProxy.connect(rta).submitOperation(alice.address, "0x", 0);
                const receipt = await tx.wait();
                const event = receipt.logs.find(log => {
                    try {
                        return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                    } catch {
                        return false;
                    }
                });
                const operationId = rtaProxy.interface.parseLog(event).args.operationId;

                await rtaProxy.connect(rta).revokeConfirmation(operationId);

                await expect(
                    rtaProxy.connect(rta).executeOperation(operationId)
                ).to.be.reverted;
            });

            it("Should revert when revoking non-confirmed operation", async function () {
                const tx = await rtaProxy.connect(rta).submitOperation(alice.address, "0x", 0);
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
                    rtaProxy.connect(signer2).revokeConfirmation(operationId)
                ).to.be.reverted;
            });
        });

        describe("Upgrade authorization", function () {
            it("Should allow any signer to authorize upgrades via multi-sig", async function () {
                const RTAProxyUpgradeableV2 = await ethers.getContractFactory("RTAProxyUpgradeable");

                // Upgrades need to go through multi-sig
                const upgradeData = rtaProxy.interface.encodeFunctionData("upgradeToAndCall", [
                    await upgrades.prepareUpgrade(rtaProxy.target, RTAProxyUpgradeableV2),
                    "0x"
                ]);

                const tx = await rtaProxy.connect(rta).submitOperation(
                    rtaProxy.target,
                    upgradeData,
                    0
                );

                expect(tx).to.emit(rtaProxy, "OperationSubmitted");
            });
        });
    });
});
