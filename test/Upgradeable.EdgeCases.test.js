const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Upgradeable Contracts - Edge Cases & Additional Coverage", function () {
    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago
    let ERC1450Upgradeable, token, rtaProxy;
    let owner, issuer, rta, alice, bob, broker;
    let mockERC20, feeToken;

    beforeEach(async function () {
        [owner, issuer, rta, alice, bob, broker] = await ethers.getSigners();

        // Deploy mock ERC20 for testing
        const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
        mockERC20 = await MockERC20.deploy("Mock Token", "MOCK", 18);
        await mockERC20.waitForDeployment();

        // Deploy fee token with 6 decimals (like USDC)
        feeToken = await MockERC20.deploy("Fee Token", "FEE", 6);
        await feeToken.waitForDeployment();

        // Deploy upgradeable RTAProxy
        const RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
        rtaProxy = await upgrades.deployProxy(
            RTAProxyUpgradeable,
            [[rta.address, alice.address, bob.address], 2],
            { kind: "uups" }
        );
        await rtaProxy.waitForDeployment();

        // Deploy upgradeable ERC1450 token
        ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
        token = await upgrades.deployProxy(
            ERC1450Upgradeable,
            ["Test Security Token", "TST", 10, issuer.address, rta.address],
            { kind: "uups" }
        );
        await token.waitForDeployment();
    });

    describe("Fee Token Validation", function () {
        it("Should reject transfer request when fee token not approved", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            // Set fee token
            await token.connect(rta).setFeeToken(feeToken.target);
            await token.connect(rta).setFeeParameters(
                0,
                ethers.parseUnits("1", 6)
            );

            // Mint fee tokens but DON'T approve
            await feeToken.mint(alice.address, ethers.parseUnits("10", 6));

            await expect(
                token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    ethers.parseUnits("100", 10),
                    ethers.parseUnits("1", 6)
                )
            ).to.be.reverted; // Should revert due to no approval
        });

        it("Should handle fee token correctly", async function () {
            // Set fee token to feeToken
            await token.connect(rta).setFeeToken(feeToken.target);
            await token.connect(rta).setFeeParameters(
                0,
                ethers.parseUnits("1", 6)
            );

            const currentFeeToken = await token.getFeeToken();
            expect(currentFeeToken).to.equal(feeToken.target);

            // Change to mockERC20
            await token.connect(rta).setFeeToken(mockERC20.target);
            const newFeeToken = await token.getFeeToken();
            expect(newFeeToken).to.equal(mockERC20.target);
        });
    });

    describe("Token Recovery", function () {
        it("Should allow RTA to recover ERC20 tokens", async function () {
            const amount = ethers.parseUnits("100", 10);
            await mockERC20.mint(token.target, amount);

            expect(await mockERC20.balanceOf(token.target)).to.equal(amount);

            const rtaBalanceBefore = await mockERC20.balanceOf(rta.address);
            await token.connect(rta).recoverToken(mockERC20.target, amount);
            const rtaBalanceAfter = await mockERC20.balanceOf(rta.address);

            expect(rtaBalanceAfter - rtaBalanceBefore).to.equal(amount);
            expect(await mockERC20.balanceOf(token.target)).to.equal(0);
        });

        it("Should allow RTA to recover ETH", async function () {
            const amount = ethers.parseUnits("0.1", 18); // 0.1 ETH
            await owner.sendTransaction({
                to: token.target,
                value: amount
            });

            const rtaBalanceBefore = await ethers.provider.getBalance(rta.address);
            await token.connect(rta).recoverToken(ethers.ZeroAddress, amount);
            const rtaBalanceAfter = await ethers.provider.getBalance(rta.address);

            expect(rtaBalanceAfter).to.be.gt(rtaBalanceBefore);
        });

        it("Should not allow recovering the security token itself", async function () {
            await expect(
                token.connect(rta).recoverToken(token.target, 100)
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");
        });

        it("Should not allow non-RTA to recover tokens", async function () {
            const amount = ethers.parseUnits("100", 10);
            await mockERC20.mint(token.target, amount);

            await expect(
                token.connect(alice).recoverToken(mockERC20.target, amount)
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");
        });
    });

    describe("Interface Support", function () {
        it("Should support ERC1450 interface", async function () {
            expect(await token.supportsInterface("0xaf175dee")).to.be.true;
        });

        it("Should NOT support ERC20 interface (per spec)", async function () {
            const ERC20InterfaceId = "0x36372b07";
            expect(await token.supportsInterface(ERC20InterfaceId)).to.be.false;
        });

        it("Should support ERC165 interface", async function () {
            const ERC165InterfaceId = "0x01ffc9a7";
            expect(await token.supportsInterface(ERC165InterfaceId)).to.be.true;
        });

        it("Should not support unknown interface", async function () {
            const unknownInterfaceId = "0xffffffff";
            expect(await token.supportsInterface(unknownInterfaceId)).to.be.false;
        });
    });

    describe("Account Status Queries", function () {
        it("Should return false for non-frozen account", async function () {
            expect(await token.isAccountFrozen(alice.address)).to.be.false;
        });

        it("Should return true for frozen account", async function () {
            await token.connect(rta).setAccountFrozen(alice.address, true);
            expect(await token.isAccountFrozen(alice.address)).to.be.true;
        });

        it("Should return false for non-broker", async function () {
            expect(await token.isRegisteredBroker(broker.address)).to.be.false;
        });

        it("Should return true for approved broker", async function () {
            await token.connect(rta).setBrokerStatus(broker.address, true);
            expect(await token.isRegisteredBroker(broker.address)).to.be.true;
        });
    });

    describe("Transfer Internal Edge Cases", function () {
        it("Should revert on insufficient balance", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate);

            await expect(
                token.connect(rta).burnFrom(alice.address, ethers.parseUnits("200", 10))
            ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
        });

        it("Should handle zero address validation in internal transfer", async function () {
            // Try to mint to zero address
            await expect(
                token.connect(rta).mint(ethers.ZeroAddress, ethers.parseUnits("100", 10), REG_US_A, issuanceDate)
            ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
        });
    });

    describe("Fee Withdrawal with ERC20", function () {
        it("Should allow withdrawing ERC20 fee tokens", async function () {
            // Set fee token
            await token.connect(rta).setFeeToken(feeToken.target);
            await token.connect(rta).setFeeParameters(
                0,
                ethers.parseUnits("1", 6)
            );

            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            // Mint and approve fee tokens
            await feeToken.mint(alice.address, ethers.parseUnits("10", 6));
            await feeToken.connect(alice).approve(token.target, ethers.parseUnits("10", 6));

            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10),
                ethers.parseUnits("1", 6)
            );

            expect(await token.collectedFeesTotal()).to.equal(ethers.parseUnits("1", 6));

            const rtaBalanceBefore = await feeToken.balanceOf(rta.address);
            await token.connect(rta).withdrawFees(
                ethers.parseUnits("1", 6),
                rta.address
            );
            const rtaBalanceAfter = await feeToken.balanceOf(rta.address);

            expect(rtaBalanceAfter - rtaBalanceBefore).to.equal(ethers.parseUnits("1", 6));
        });

        it("Should revert withdrawal to zero address", async function () {
            await expect(
                token.connect(rta).withdrawFees(
                    ethers.parseUnits("1", 10),
                    ethers.ZeroAddress
                )
            ).to.be.revertedWith("ERC1450: Invalid recipient");
        });
    });

    describe("RTAProxy Upgradeable - Signer Management Edge Cases", function () {
        it("Should handle signer queries correctly", async function () {
            expect(await rtaProxy.isSigner(rta.address)).to.be.true;
            expect(await rtaProxy.isSigner(broker.address)).to.be.false;

            const signers = await rtaProxy.getSigners();
            expect(signers.length).to.equal(3);
            expect(signers).to.include(rta.address);
        });

        it("Should track required signatures correctly", async function () {
            expect(await rtaProxy.requiredSignatures()).to.equal(2);
        });

        it("Should handle operation submissions correctly", async function () {
            // Submit an operation
            await expect(
                rtaProxy.connect(rta).submitOperation(
                    alice.address,
                    "0x",
                    0
                )
            ).to.emit(rtaProxy, "OperationSubmitted");
        });

        it("Should return correct operation details", async function () {
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

            const operation = await rtaProxy.getOperation(operationId);
            expect(operation.target).to.equal(alice.address);
            expect(operation.confirmations).to.equal(1);
            expect(operation.executed).to.be.false;
        });

        it("Should revert queries for non-existent operations", async function () {
            await expect(
                rtaProxy.getOperation(9999)
            ).to.be.revertedWith("Operation does not exist");
        });
    });

    describe("Percentage Fee Calculation Edge Cases", function () {
        it("Should calculate percentage fees correctly", async function () {
            await token.connect(rta).setFeeToken(feeToken.target);
            await token.connect(rta).setFeeParameters(
                1, // percentage
                250 // 2.5%
            );

            const feeAmount = await token.getTransferFee(
                alice.address,
                bob.address,
                ethers.parseUnits("1000", 10)
            );

            expect(feeAmount).to.equal(ethers.parseUnits("25", 10));
        });

        it("Should handle flat fee calculation", async function () {
            await token.connect(rta).setFeeToken(feeToken.target);
            await token.connect(rta).setFeeParameters(
                0, // flat
                ethers.parseUnits("10", 6)
            );

            const feeAmount = await token.getTransferFee(
                alice.address,
                bob.address,
                ethers.parseUnits("1000", 10)
            );

            expect(feeAmount).to.equal(ethers.parseUnits("10", 6));
        });

        it("Should reject invalid fee types", async function () {
            await token.connect(rta).setFeeToken(feeToken.target);

            // Type 2 is not valid (only 0=flat and 1=percentage are valid)
            await expect(
                token.connect(rta).setFeeParameters(
                    2, // invalid type
                    ethers.parseUnits("5", 6)
                )
            ).to.be.revertedWith("ERC1450: Invalid fee type (0=flat, 1=percentage)");
        });
    });

    describe("Controller Transfer (ERC-1644)", function () {
        it("Should execute controller transfer with event", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            const documentHash = ethers.keccak256(ethers.toUtf8Bytes("court-order-123"));
            const operatorData = ethers.toUtf8Bytes("COURT_ORDER");
            const tx = await token.connect(rta).controllerTransfer(
                alice.address,
                bob.address,
                ethers.parseUnits("500", 10),
                documentHash,
                operatorData
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    const parsed = token.interface.parseLog(log);
                    return parsed && parsed.name === "ControllerTransfer";
                } catch {
                    return false;
                }
            });

            expect(event).to.not.be.undefined;
            const parsedEvent = token.interface.parseLog(event);
            // ERC-1644 event: ControllerTransfer(controller, from, to, value, data, operatorData)
            expect(parsedEvent.args.controller).to.equal(rta.address);
            expect(parsedEvent.args.from).to.equal(alice.address);
            expect(parsedEvent.args.to).to.equal(bob.address);
            expect(parsedEvent.args.value).to.equal(ethers.parseUnits("500", 10));
            expect(parsedEvent.args.data).to.equal(documentHash);
        });
    });

    describe("Security Token Identity", function () {
        it("Should identify as security token", async function () {
            expect(await token.isSecurityToken()).to.be.true;
        });
    });
});
