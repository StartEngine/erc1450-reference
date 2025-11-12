const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Upgradeable Contracts - Edge Cases & Additional Coverage", function () {
    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago
    let ERC1450Upgradeable, token, rtaProxy;
    let owner, issuer, rta, alice, bob, broker;
    let mockERC20;

    beforeEach(async function () {
        [owner, issuer, rta, alice, bob, broker] = await ethers.getSigners();

        // Deploy mock ERC20 for testing
        const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
        mockERC20 = await MockERC20.deploy("Mock Token", "MOCK", 18);
        await mockERC20.waitForDeployment();

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
            ["Test Security Token", "TST", 18, issuer.address, rta.address],
            { kind: "uups" }
        );
        await token.waitForDeployment();
    });

    describe("Fee Token Validation", function () {
        it("Should reject transfer request with non-accepted fee token", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseEther("1000"), REG_US_A, issuanceDate);

            await token.connect(rta).setFeeParameters(
                0,
                ethers.parseEther("1"),
                [ethers.ZeroAddress]
            );

            await expect(
                token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    ethers.parseEther("100"),
                    mockERC20.target,
                    ethers.parseEther("1")
                )
            ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
        });

        it("Should handle multiple fee tokens correctly", async function () {
            const token1 = ethers.ZeroAddress;
            const token2 = mockERC20.target;

            await token.connect(rta).setFeeParameters(
                0,
                ethers.parseEther("1"),
                [token1, token2]
            );

            const acceptedTokens = await token.getAcceptedFeeTokens();
            expect(acceptedTokens.length).to.equal(2);
            expect(acceptedTokens[0]).to.equal(token1);
            expect(acceptedTokens[1]).to.equal(token2);
        });
    });

    describe("Token Recovery", function () {
        it("Should allow RTA to recover ERC20 tokens", async function () {
            const amount = ethers.parseEther("100");
            await mockERC20.mint(token.target, amount);

            expect(await mockERC20.balanceOf(token.target)).to.equal(amount);

            const rtaBalanceBefore = await mockERC20.balanceOf(rta.address);
            await token.connect(rta).recoverToken(mockERC20.target, amount);
            const rtaBalanceAfter = await mockERC20.balanceOf(rta.address);

            expect(rtaBalanceAfter - rtaBalanceBefore).to.equal(amount);
            expect(await mockERC20.balanceOf(token.target)).to.equal(0);
        });

        it("Should allow RTA to recover ETH", async function () {
            const amount = ethers.parseEther("1");
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
            const amount = ethers.parseEther("100");
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

        it("Should support ERC20 interface", async function () {
            const ERC20InterfaceId = "0x36372b07";
            expect(await token.supportsInterface(ERC20InterfaceId)).to.be.true;
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
            expect(await token.isBroker(broker.address)).to.be.false;
        });

        it("Should return true for approved broker", async function () {
            await token.connect(rta).setBrokerStatus(broker.address, true);
            expect(await token.isBroker(broker.address)).to.be.true;
        });
    });

    describe("Transfer Internal Edge Cases", function () {
        it("Should revert on insufficient balance", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseEther("100"), REG_US_A, issuanceDate);

            await expect(
                token.connect(rta).burnFrom(alice.address, ethers.parseEther("200"))
            ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
        });

        it("Should handle zero address validation in internal transfer", async function () {
            // Try to mint to zero address
            await expect(
                token.connect(rta).mint(ethers.ZeroAddress, ethers.parseEther("100"), REG_US_A, issuanceDate)
            ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
        });
    });

    describe("Fee Withdrawal with ERC20", function () {
        it("Should allow withdrawing ERC20 fee tokens", async function () {
            await token.connect(rta).setFeeParameters(
                0,
                ethers.parseEther("1"),
                [mockERC20.target]
            );

            await token.connect(rta).mint(alice.address, ethers.parseEther("1000"), REG_US_A, issuanceDate);
            await mockERC20.mint(alice.address, ethers.parseEther("10"));
            await mockERC20.connect(alice).approve(token.target, ethers.parseEther("10"));

            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseEther("100"),
                mockERC20.target,
                ethers.parseEther("1")
            );

            expect(await token.collectedFees(mockERC20.target)).to.equal(ethers.parseEther("1"));

            const rtaBalanceBefore = await mockERC20.balanceOf(rta.address);
            await token.connect(rta).withdrawFees(
                mockERC20.target,
                ethers.parseEther("1"),
                rta.address
            );
            const rtaBalanceAfter = await mockERC20.balanceOf(rta.address);

            expect(rtaBalanceAfter - rtaBalanceBefore).to.equal(ethers.parseEther("1"));
        });

        it("Should revert withdrawal to zero address", async function () {
            await expect(
                token.connect(rta).withdrawFees(
                    ethers.ZeroAddress,
                    ethers.parseEther("1"),
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
            await token.connect(rta).setFeeParameters(
                1, // percentage
                250, // 2.5%
                [ethers.ZeroAddress]
            );

            const feeAmount = await token.getTransferFee(
                alice.address,
                bob.address,
                ethers.parseEther("1000"),
                ethers.ZeroAddress
            );

            expect(feeAmount).to.equal(ethers.parseEther("25"));
        });

        it("Should handle flat fee calculation", async function () {
            await token.connect(rta).setFeeParameters(
                0, // flat
                ethers.parseEther("10"),
                [ethers.ZeroAddress]
            );

            const feeAmount = await token.getTransferFee(
                alice.address,
                bob.address,
                ethers.parseEther("1000"),
                ethers.ZeroAddress
            );

            expect(feeAmount).to.equal(ethers.parseEther("10"));
        });

        it("Should handle other fee types", async function () {
            await token.connect(rta).setFeeParameters(
                2, // other type
                ethers.parseEther("5"),
                [ethers.ZeroAddress]
            );

            const feeAmount = await token.getTransferFee(
                alice.address,
                bob.address,
                ethers.parseEther("1000"),
                ethers.ZeroAddress
            );

            // For other types, it returns feeValue directly
            expect(feeAmount).to.equal(ethers.parseEther("5"));
        });
    });

    describe("Court Order Execution", function () {
        it("Should execute court order with event", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseEther("1000"), REG_US_A, issuanceDate);

            const documentHash = ethers.keccak256(ethers.toUtf8Bytes("court-order-123"));
            const tx = await token.connect(rta).executeCourtOrder(
                alice.address,
                bob.address,
                ethers.parseEther("500"),
                documentHash
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    const parsed = token.interface.parseLog(log);
                    return parsed && parsed.name === "CourtOrderExecuted";
                } catch {
                    return false;
                }
            });

            expect(event).to.not.be.undefined;
            const parsedEvent = token.interface.parseLog(event);
            expect(parsedEvent.args[0]).to.equal(alice.address);
            expect(parsedEvent.args[1]).to.equal(bob.address);
            expect(parsedEvent.args[2]).to.equal(ethers.parseEther("500"));
            expect(parsedEvent.args[3]).to.equal(documentHash);
        });
    });

    describe("Security Token Identity", function () {
        it("Should identify as security token", async function () {
            expect(await token.isSecurityToken()).to.be.true;
        });
    });
});
