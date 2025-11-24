const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Time-Lock Coverage Tests - Reach 90%+", function () {
    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago

    let ERC1450, token;
    let RTAProxy, rtaProxy;
    let ERC1450Upgradeable, tokenUpgradeable;
    let RTAProxyUpgradeable, rtaProxyUpgradeable;
    let owner, rta, signer2, signer3, alice, bob;

    const HIGH_VALUE = ethers.parseUnits("1000000", 10); // 1M tokens - meets threshold
    const LOW_VALUE = ethers.parseUnits("100", 10); // Below threshold
    const TIME_LOCK_DURATION = 24 * 60 * 60; // 24 hours

    beforeEach(async function () {
        [owner, rta, signer2, signer3, alice, bob] = await ethers.getSigners();

        // Deploy standard RTAProxy
        RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy([rta.address, signer2.address, signer3.address], 2);
        await rtaProxy.waitForDeployment();

        // Deploy standard ERC1450 token
        ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy("Security Token", "SEC", 10, owner.address, rtaProxy.target);
        await token.waitForDeployment();

        // Deploy upgradeable RTAProxy
        RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
        rtaProxyUpgradeable = await upgrades.deployProxy(
            RTAProxyUpgradeable,
            [[rta.address, signer2.address, signer3.address], 2],
            { kind: "uups" }
        );
        await rtaProxyUpgradeable.waitForDeployment();

        // Deploy upgradeable ERC1450 token
        ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
        tokenUpgradeable = await upgrades.deployProxy(
            ERC1450Upgradeable,
            ["Security Token", "SEC", 10, owner.address, rtaProxyUpgradeable.target],
            { initializer: "initialize" }
        );
        await tokenUpgradeable.waitForDeployment();

        // Mint tokens to alice for testing
        const mintData = token.interface.encodeFunctionData("mint", [alice.address, HIGH_VALUE * 2n, REG_US_A, issuanceDate]);
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

        // Mint tokens to alice on upgradeable token
        const mintDataUpgradeable = tokenUpgradeable.interface.encodeFunctionData("mint", [alice.address, HIGH_VALUE * 2n, REG_US_A, issuanceDate]);
        const tx2 = await rtaProxyUpgradeable.connect(rta).submitOperation(tokenUpgradeable.target, mintDataUpgradeable, 0);
        const receipt2 = await tx2.wait();
        const opId2 = rtaProxyUpgradeable.interface.parseLog(
            receipt2.logs.find(log => {
                try {
                    return rtaProxyUpgradeable.interface.parseLog(log).name === "OperationSubmitted";
                } catch { return false; }
            })
        ).args.operationId;
        await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId2);
    });

    describe("RTAProxy - Time-Lock on High-Value transferFrom (Lines 236-237)", function () {
        it("Should require time-lock for high-value transferFromRegulated and enforce delay", async function () {
            // Encode high-value transferFromRegulated operation
            const transferData = token.interface.encodeFunctionData("transferFromRegulated", [
                alice.address,
                bob.address,
                HIGH_VALUE,
                REG_US_A,
                issuanceDate
            ]);

            // Verify requiresTimeLock returns true for high-value
            expect(await rtaProxy.requiresTimeLock(transferData)).to.be.true;

            // Submit operation
            const tx = await rtaProxy.connect(rta).submitOperation(token.target, transferData, 0);
            const receipt = await tx.wait();
            const opId = rtaProxy.interface.parseLog(
                receipt.logs.find(log => {
                    try {
                        return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                    } catch { return false; }
                })
            ).args.operationId;

            // Try to confirm with signer2 - will try to auto-execute and hit time-lock (HITS LINE 236-237)
            try {
                await rtaProxy.connect(signer2).confirmOperation(opId);
                expect.fail("Expected TimeLockNotExpired error");
            } catch (error) {
                expect(error.message).to.include("TimeLockNotExpired");
            }

            // Operation should still not be executed
            const op = await rtaProxy.getOperation(opId);
            expect(op.executed).to.be.false;

            // Fast-forward time by 24 hours
            await time.increase(TIME_LOCK_DURATION);

            // Now confirm with signer2 - should auto-execute successfully
            await rtaProxy.connect(signer2).confirmOperation(opId);

            // Verify transfer completed
            expect(await token.balanceOf(bob.address)).to.equal(HIGH_VALUE);
        });

        it("Should NOT require time-lock for low-value transferFromRegulated", async function () {
            // Encode low-value transferFromRegulated operation
            const transferData = token.interface.encodeFunctionData("transferFromRegulated", [
                alice.address,
                bob.address,
                LOW_VALUE,
                REG_US_A,
                issuanceDate
            ]);

            // Verify requiresTimeLock returns false for low-value
            expect(await rtaProxy.requiresTimeLock(transferData)).to.be.false;

            // Submit and execute immediately
            const tx = await rtaProxy.connect(rta).submitOperation(token.target, transferData, 0);
            const receipt = await tx.wait();
            const opId = rtaProxy.interface.parseLog(
                receipt.logs.find(log => {
                    try {
                        return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                    } catch { return false; }
                })
            ).args.operationId;

            // Confirm - should auto-execute without time-lock
            await rtaProxy.connect(signer2).confirmOperation(opId);

            // Verify transfer completed immediately
            expect(await token.balanceOf(bob.address)).to.equal(LOW_VALUE);
        });

        it("Should require time-lock for high-value executeCourtOrder", async function () {
            // Encode high-value court order
            const courtOrderData = token.interface.encodeFunctionData("executeCourtOrder", [
                alice.address,
                bob.address,
                HIGH_VALUE,
                ethers.keccak256(ethers.toUtf8Bytes("court-order-123"))
            ]);

            // Verify requiresTimeLock returns true
            expect(await rtaProxy.requiresTimeLock(courtOrderData)).to.be.true;

            // Submit operation
            const tx = await rtaProxy.connect(rta).submitOperation(token.target, courtOrderData, 0);
            const receipt = await tx.wait();
            const opId = rtaProxy.interface.parseLog(
                receipt.logs.find(log => {
                    try {
                        return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                    } catch { return false; }
                })
            ).args.operationId;

            // Try to confirm - should fail due to time-lock (HITS LINE 236-237)
            try {
                await rtaProxy.connect(signer2).confirmOperation(opId);
                expect.fail("Expected TimeLockNotExpired error");
            } catch (error) {
                expect(error.message).to.include("TimeLockNotExpired");
            }

            // Fast-forward time
            await time.increase(TIME_LOCK_DURATION);

            // Now confirm - should auto-execute successfully
            await rtaProxy.connect(signer2).confirmOperation(opId);

            // Verify court order executed
            expect(await token.balanceOf(bob.address)).to.equal(HIGH_VALUE);
        });
    });

    describe("RTAProxyUpgradeable - Time-Lock on High-Value Operations (Lines 292-293)", function () {
        it("Should require time-lock for high-value transferFromRegulated and enforce delay", async function () {
            // Encode high-value transferFromRegulated operation
            const transferData = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                alice.address,
                bob.address,
                HIGH_VALUE,
                REG_US_A,
                issuanceDate
            ]);

            // Verify requiresTimeLock returns true
            expect(await rtaProxyUpgradeable.requiresTimeLock(transferData)).to.be.true;

            // Submit operation
            const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(
                tokenUpgradeable.target,
                transferData,
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

            // Try to confirm - will try to auto-execute and hit time-lock (HITS LINE 292-293)
            try {
                await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);
                expect.fail("Expected TimeLockNotExpired error");
            } catch (error) {
                expect(error.message).to.include("TimeLockNotExpired");
            }

            // Operation should still not be executed
            const op = await rtaProxyUpgradeable.getOperation(opId);
            expect(op.executed).to.be.false;

            // Fast-forward time by 24 hours
            await time.increase(TIME_LOCK_DURATION);

            // Now confirm - should auto-execute successfully
            await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);

            // Verify transfer completed
            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(HIGH_VALUE);
        });

        it("Should NOT require time-lock for low-value transferFromRegulated", async function () {
            // Encode low-value transferFromRegulated operation
            const transferData = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                alice.address,
                bob.address,
                LOW_VALUE,
                REG_US_A,
                issuanceDate
            ]);

            // Verify requiresTimeLock returns false
            expect(await rtaProxyUpgradeable.requiresTimeLock(transferData)).to.be.false;

            // Submit and execute immediately
            const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(
                tokenUpgradeable.target,
                transferData,
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

            // Confirm - should auto-execute
            await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);

            // Verify transfer completed immediately
            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(LOW_VALUE);
        });

        it("Should require time-lock for high-value executeCourtOrder", async function () {
            // Encode high-value court order
            const courtOrderData = tokenUpgradeable.interface.encodeFunctionData("executeCourtOrder", [
                alice.address,
                bob.address,
                HIGH_VALUE,
                ethers.keccak256(ethers.toUtf8Bytes("court-order-456"))
            ]);

            // Verify requiresTimeLock returns true
            expect(await rtaProxyUpgradeable.requiresTimeLock(courtOrderData)).to.be.true;

            // Submit operation
            const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(
                tokenUpgradeable.target,
                courtOrderData,
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

            // Try to confirm - should fail due to time-lock (HITS LINE 292-293)
            try {
                await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);
                expect.fail("Expected TimeLockNotExpired error");
            } catch (error) {
                expect(error.message).to.include("TimeLockNotExpired");
            }

            // Fast-forward time
            await time.increase(TIME_LOCK_DURATION);

            // Now confirm - should auto-execute successfully
            await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);

            // Verify court order executed
            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(HIGH_VALUE);
        });

        it("Should verify time-lock branch with exact threshold amount", async function () {
            // Test with exactly 1M tokens (the threshold)
            const exactThreshold = ethers.parseUnits("1000000", 10);

            const transferData = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                alice.address,
                bob.address,
                exactThreshold,
                REG_US_A,
                issuanceDate
            ]);

            // Should require time-lock for exact threshold
            expect(await rtaProxyUpgradeable.requiresTimeLock(transferData)).to.be.true;

            // Submit operation
            const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(
                tokenUpgradeable.target,
                transferData,
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

            // Try to confirm - should enforce time-lock (HITS LINE 292-293)
            try {
                await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);
                expect.fail("Expected TimeLockNotExpired error");
            } catch (error) {
                expect(error.message).to.include("TimeLockNotExpired");
            }
        });

        it("Should NOT require time-lock for operations other than transferFrom/executeCourtOrder", async function () {
            // Test with mint operation (high value but not subject to time-lock)
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [bob.address, HIGH_VALUE
            , REG_US_A, issuanceDate]);

            // Mint should NOT require time-lock even for high amounts
            expect(await rtaProxyUpgradeable.requiresTimeLock(mintData)).to.be.false;

            // Submit and execute immediately
            const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(
                tokenUpgradeable.target,
                mintData,
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

            // Should execute immediately without time-lock
            await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);

            // Verify mint completed
            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(HIGH_VALUE);
        });
    });

    describe("Edge Cases - Time-Lock Logic", function () {
        it("Should handle data length check in requiresTimeLock", async function () {
            // Test with insufficient data length
            const shortData = "0x12345678"; // Only selector, no params

            expect(await rtaProxy.requiresTimeLock(shortData)).to.be.false;
            expect(await rtaProxyUpgradeable.requiresTimeLock(shortData)).to.be.false;
        });

        it("Should verify time-lock is enforced before expiry and allows execution after", async function () {
            // Encode high-value transfer
            const transferData = token.interface.encodeFunctionData("transferFromRegulated", [
                alice.address,
                bob.address,
                HIGH_VALUE,
                REG_US_A,
                issuanceDate
            ]);

            // Submit operation
            const tx = await rtaProxy.connect(rta).submitOperation(token.target, transferData, 0);
            const receipt = await tx.wait();
            const opId = rtaProxy.interface.parseLog(
                receipt.logs.find(log => {
                    try {
                        return rtaProxy.interface.parseLog(log).name === "OperationSubmitted";
                    } catch { return false; }
                })
            ).args.operationId;

            // Get the operation timestamp for verification
            const op = await rtaProxy.getOperation(opId);
            const opTimestamp = op.timestamp;

            // Try to confirm before time-lock expires - should fail
            try {
                await rtaProxy.connect(signer2).confirmOperation(opId);
                expect.fail("Expected TimeLockNotExpired error");
            } catch (error) {
                expect(error.message).to.include("TimeLockNotExpired");
            }

            // Fast-forward past the time-lock duration
            await time.increaseTo(opTimestamp + BigInt(TIME_LOCK_DURATION));

            // Now confirmation should succeed and auto-execute
            await rtaProxy.connect(signer2).confirmOperation(opId);

            // Verify transfer completed
            expect(await token.balanceOf(bob.address)).to.equal(HIGH_VALUE);
        });
    });
});
