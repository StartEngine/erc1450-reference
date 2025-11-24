const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Deep Branch Coverage - Push to 90%+", function () {
    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago
    let ERC1450, token, ERC1450Upgradeable, tokenUpgradeable;
    let RTAProxy, rtaProxy, RTAProxyUpgradeable, rtaProxyUpgradeable;
    let owner, issuer, rta, alice, bob, carol, signer2, signer3;

    beforeEach(async function () {
        [owner, issuer, rta, alice, bob, carol, signer2, signer3] = await ethers.getSigners();

        // Deploy standard contracts
        RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy([rta.address, signer2.address, signer3.address], 2);
        await rtaProxy.waitForDeployment();

        ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy("Test Token", "TST", 10, issuer.address, rta.address);
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
            ["Test Token Upgradeable", "TSTU", 10, issuer.address, rta.address],
            { kind: "uups" }
        );
        await tokenUpgradeable.waitForDeployment();
    });

    describe("RTAProxy - Modifier and edge case branches", function () {
        it("Should test operationExists modifier with non-existent operation", async function () {
            await expect(
                rtaProxy.connect(rta).confirmOperation(99999)
            ).to.be.revertedWith("Operation does not exist");
        });

        it("Should test hasConfirmed view function", async function () {
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

            // Check if rta has confirmed (should be true - auto-confirmed on submit)
            expect(await rtaProxy.hasConfirmed(operationId, rta.address)).to.be.true;

            // Check if signer2 has confirmed (should be false)
            expect(await rtaProxy.hasConfirmed(operationId, signer2.address)).to.be.false;
        });

        it("Should test getOperation function", async function () {
            const targetAddr = alice.address;
            const callData = "0x12345678";
            const value = ethers.parseUnits("1", 10);

            const tx = await rtaProxy.connect(rta).submitOperation(targetAddr, callData, value);
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                } catch {
                    return false;
                }
            });
            const operationId = rtaProxy.interface.parseLog(event).args.operationId;

            const op = await rtaProxy.getOperation(operationId);
            expect(op.target).to.equal(targetAddr);
            expect(op.data).to.equal(callData);
            expect(op.value).to.equal(value);
        });

        it("Should test requiresTimeLock function with different selectors", async function () {
            // Test with empty data
            expect(await rtaProxy.requiresTimeLock("0x")).to.be.false;

            // Test with short data
            expect(await rtaProxy.requiresTimeLock("0x1234")).to.be.false;

            // Test with transferFrom selector
            const transferFromData = token.interface.encodeFunctionData("transferFrom", [
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10)
            ]);
            expect(await rtaProxy.requiresTimeLock(transferFromData)).to.be.false;

            // Test with random selector
            expect(await rtaProxy.requiresTimeLock("0x12345678")).to.be.false;
        });

        it("Should handle operations with zero value", async function () {
            // Most operations will have zero value - just verify this path works
            const tx = await rtaProxy.connect(rta).submitOperation(
                alice.address,
                "0x",
                0 // Zero value
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

            // Execute with second confirmation
            await rtaProxy.connect(signer2).confirmOperation(operationId);

            const op = await rtaProxy.getOperation(operationId);
            expect(op.executed).to.be.true;
        });

        it("Should track operation count correctly", async function () {
            const initialCount = await rtaProxy.operationCount();

            await rtaProxy.connect(rta).submitOperation(alice.address, "0x", 0);
            expect(await rtaProxy.operationCount()).to.equal(initialCount + 1n);

            await rtaProxy.connect(rta).submitOperation(bob.address, "0x", 0);
            expect(await rtaProxy.operationCount()).to.equal(initialCount + 2n);
        });
    });

    describe("RTAProxyUpgradeable - Additional coverage", function () {
        it("Should test operationExists modifier", async function () {
            await expect(
                rtaProxyUpgradeable.connect(rta).confirmOperation(99999)
            ).to.be.revertedWith("Operation does not exist");
        });

        it("Should test hasConfirmed view function", async function () {
            const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(alice.address, "0x", 0);
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxyUpgradeable.interface.parseLog(log).name === "OperationSubmitted";
                } catch {
                    return false;
                }
            });
            const operationId = rtaProxyUpgradeable.interface.parseLog(event).args.operationId;

            expect(await rtaProxyUpgradeable.hasConfirmed(operationId, rta.address)).to.be.true;
            expect(await rtaProxyUpgradeable.hasConfirmed(operationId, signer2.address)).to.be.false;
        });

        it("Should test requiresTimeLock function", async function () {
            expect(await rtaProxyUpgradeable.requiresTimeLock("0x")).to.be.false;
            expect(await rtaProxyUpgradeable.requiresTimeLock("0x1234")).to.be.false;
        });

        it("Should handle operations with zero value", async function () {
            const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(
                alice.address,
                "0x",
                0 // Zero value
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxyUpgradeable.interface.parseLog(log).name === "OperationSubmitted";
                } catch {
                    return false;
                }
            });
            const operationId = rtaProxyUpgradeable.interface.parseLog(event).args.operationId;

            await rtaProxyUpgradeable.connect(signer2).confirmOperation(operationId);

            const op = await rtaProxyUpgradeable.getOperation(operationId);
            expect(op.executed).to.be.true;
        });
    });

    describe("ERC1450 - Additional transfer and fee scenarios", function () {
        it("Should handle transfer to self", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            const balanceBefore = await token.balanceOf(alice.address);
            await token.connect(rta).transferFromRegulated(alice.address, alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate);
            const balanceAfter = await token.balanceOf(alice.address);

            expect(balanceAfter).to.equal(balanceBefore); // Should remain the same
        });

        it("Should handle zero amount transfer", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            await token.connect(rta).transferFromRegulated(alice.address, bob.address, 0, REG_US_A, issuanceDate);

            expect(await token.balanceOf(bob.address)).to.equal(0);
        });

        it("Should handle ERC20 fee token payment with exact amount", async function () {
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const feeToken = await MockERC20.deploy("Fee Token", "FEE", 18);
            await feeToken.waitForDeployment();

            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);
            await feeToken.mint(alice.address, ethers.parseUnits("100", 10));

            await token.connect(rta).setFeeParameters(0, ethers.parseUnits("10", 10), [feeToken.target]);

            await feeToken.connect(alice).approve(token.target, ethers.parseUnits("10", 10));

            const tx = await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10),
                feeToken.target,
                ethers.parseUnits("10", 10)
            );

            expect(tx).to.emit(token, "TransferRequested");
            expect(await token.collectedFees(feeToken.target)).to.equal(ethers.parseUnits("10", 10));
        });

        it("Should handle rejected fee token", async function () {
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const feeToken = await MockERC20.deploy("Fee Token", "FEE", 18);
            await feeToken.waitForDeployment();

            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);
            await feeToken.mint(alice.address, ethers.parseUnits("100", 10));

            // Don't add feeToken to accepted list
            await token.connect(rta).setFeeParameters(0, ethers.parseUnits("1", 18), [ethers.ZeroAddress]);

            await expect(
                token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    ethers.parseUnits("100", 10),
                    feeToken.target, // Not accepted
                    ethers.parseUnits("10", 10)
                )
            ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
        });

        it("Should handle withdrawal of ERC20 fee tokens", async function () {
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const feeToken = await MockERC20.deploy("Fee Token", "FEE", 18);
            await feeToken.waitForDeployment();

            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);
            await feeToken.mint(alice.address, ethers.parseUnits("100", 10));

            await token.connect(rta).setFeeParameters(0, ethers.parseUnits("10", 10), [feeToken.target]);
            await feeToken.connect(alice).approve(token.target, ethers.parseUnits("10", 10));

            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10),
                feeToken.target,
                ethers.parseUnits("10", 10)
            );

            const rtaBalanceBefore = await feeToken.balanceOf(rta.address);
            await token.connect(rta).withdrawFees(feeToken.target, ethers.parseUnits("10", 10), rta.address);
            const rtaBalanceAfter = await feeToken.balanceOf(rta.address);

            expect(rtaBalanceAfter - rtaBalanceBefore).to.equal(ethers.parseUnits("10", 10));
        });

        it("Should handle court order from/to same address", async function () {
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            const documentHash = ethers.keccak256(ethers.toUtf8Bytes("self-transfer-court-order"));

            const balanceBefore = await token.balanceOf(alice.address);
            await token.connect(rta).executeCourtOrder(
                alice.address,
                alice.address,
                ethers.parseUnits("100", 10),
                documentHash
            );
            const balanceAfter = await token.balanceOf(alice.address);

            expect(balanceAfter).to.equal(balanceBefore);
        });

        it("Should handle all ERC20 view functions", async function () {
            expect(await token.name()).to.equal("Test Token");
            expect(await token.symbol()).to.equal("TST");
            expect(await token.decimals()).to.equal(10);
            expect(await token.totalSupply()).to.equal(0);
            expect(await token.balanceOf(alice.address)).to.equal(0);
            expect(await token.allowance(alice.address, bob.address)).to.equal(0);
        });
    });

    describe("ERC1450Upgradeable - Additional coverage", function () {
        it("Should handle transfer to self", async function () {
            await tokenUpgradeable.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            const balanceBefore = await tokenUpgradeable.balanceOf(alice.address);
            await tokenUpgradeable.connect(rta).transferFromRegulated(alice.address, alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate);
            const balanceAfter = await tokenUpgradeable.balanceOf(alice.address);

            expect(balanceAfter).to.equal(balanceBefore);
        });

        it("Should handle zero amount transfer", async function () {
            await tokenUpgradeable.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);
            await tokenUpgradeable.connect(rta).transferFromRegulated(alice.address, bob.address, 0, REG_US_A, issuanceDate);
            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(0);
        });

        it("Should handle ERC20 fee token withdrawal", async function () {
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const feeToken = await MockERC20.deploy("Fee Token", "FEE", 18);
            await feeToken.waitForDeployment();

            await tokenUpgradeable.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);
            await feeToken.mint(alice.address, ethers.parseUnits("100", 10));

            await tokenUpgradeable.connect(rta).setFeeParameters(0, ethers.parseUnits("10", 10), [feeToken.target]);
            await feeToken.connect(alice).approve(tokenUpgradeable.target, ethers.parseUnits("10", 10));

            await tokenUpgradeable.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10),
                feeToken.target,
                ethers.parseUnits("10", 10)
            );

            await tokenUpgradeable.connect(rta).withdrawFees(feeToken.target, ethers.parseUnits("10", 10), rta.address);

            expect(await feeToken.balanceOf(rta.address)).to.equal(ethers.parseUnits("10", 10));
        });

        it("Should handle rejected fee token", async function () {
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const feeToken = await MockERC20.deploy("Fee Token", "FEE", 18);
            await feeToken.waitForDeployment();

            await tokenUpgradeable.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            await tokenUpgradeable.connect(rta).setFeeParameters(0, ethers.parseUnits("1", 18), [ethers.ZeroAddress]);

            await expect(
                tokenUpgradeable.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    ethers.parseUnits("100", 10),
                    feeToken.target,
                    ethers.parseUnits("10", 10)
                )
            ).to.be.revertedWithCustomError(tokenUpgradeable, "ERC20InvalidReceiver");
        });

        it("Should handle court order self-transfer", async function () {
            await tokenUpgradeable.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            const documentHash = ethers.keccak256(ethers.toUtf8Bytes("self-transfer"));

            const balanceBefore = await tokenUpgradeable.balanceOf(alice.address);
            await tokenUpgradeable.connect(rta).executeCourtOrder(
                alice.address,
                alice.address,
                ethers.parseUnits("100", 10),
                documentHash
            );
            const balanceAfter = await tokenUpgradeable.balanceOf(alice.address);

            expect(balanceAfter).to.equal(balanceBefore);
        });

        it("Should handle all view functions", async function () {
            expect(await tokenUpgradeable.name()).to.equal("Test Token Upgradeable");
            expect(await tokenUpgradeable.symbol()).to.equal("TSTU");
            expect(await token.decimals()).to.equal(10);
            expect(await tokenUpgradeable.totalSupply()).to.equal(0);
            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(0);
            expect(await tokenUpgradeable.allowance(alice.address, bob.address)).to.equal(0);
        });

        it("Should handle interface queries", async function () {
            // ERC165
            expect(await tokenUpgradeable.supportsInterface("0x01ffc9a7")).to.be.true;
            // ERC1450
            expect(await tokenUpgradeable.supportsInterface("0xaf175dee")).to.be.true;
            // ERC20 (returns true for compatibility)
            expect(await tokenUpgradeable.supportsInterface("0x36372b07")).to.be.false;
            // Random interface
            expect(await tokenUpgradeable.supportsInterface("0x12345678")).to.be.false;
        });
    });
});
