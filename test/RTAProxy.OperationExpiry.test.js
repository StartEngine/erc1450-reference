const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("RTAProxy Operation Expiration (FIND-008)", function () {
    const REG_US_A = 0x0001;
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30;

    let RTAProxy, ERC1450;
    let rtaProxy, token;
    let owner, signer1, signer2, signer3;

    const SEVEN_DAYS = 7 * 24 * 60 * 60; // 7 days in seconds

    beforeEach(async function () {
        [owner, signer1, signer2, signer3] = await ethers.getSigners();

        RTAProxy = await ethers.getContractFactory("RTAProxy");
        ERC1450 = await ethers.getContractFactory("ERC1450");

        // Deploy RTAProxy with 2 of 3 multi-sig
        rtaProxy = await RTAProxy.deploy(
            [signer1.address, signer2.address, signer3.address],
            2
        );
        await rtaProxy.waitForDeployment();

        // Deploy token with RTAProxy as transfer agent
        token = await ERC1450.deploy(
            "Security Token",
            "SEC",
            18,
            owner.address,
            rtaProxy.target
        );
        await token.waitForDeployment();
    });

    describe("OPERATION_EXPIRY constant", function () {
        it("Should have OPERATION_EXPIRY set to 7 days", async function () {
            const expiry = await rtaProxy.OPERATION_EXPIRY();
            expect(expiry).to.equal(SEVEN_DAYS);
        });
    });

    describe("isOperationExpired view function", function () {
        let operationId;

        beforeEach(async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                signer1.address,
                ethers.parseUnits("1000", 18),
                REG_US_A,
                issuanceDate
            ]);

            await rtaProxy.connect(signer1).submitOperation(token.target, mintData, 0);
            operationId = 0;
        });

        it("Should return false for fresh operation", async function () {
            expect(await rtaProxy.isOperationExpired(operationId)).to.be.false;
        });

        it("Should return false just before expiry", async function () {
            // Advance time to just before 7 days
            await time.increase(SEVEN_DAYS - 10);
            expect(await rtaProxy.isOperationExpired(operationId)).to.be.false;
        });

        it("Should return true after 7 days", async function () {
            // Advance time past 7 days
            await time.increase(SEVEN_DAYS + 1);
            expect(await rtaProxy.isOperationExpired(operationId)).to.be.true;
        });

        it("Should revert for non-existent operation", async function () {
            await expect(
                rtaProxy.isOperationExpired(999)
            ).to.be.revertedWith("Operation does not exist");
        });
    });

    describe("Operation execution within expiry period", function () {
        let operationId;
        let mintData;

        beforeEach(async function () {
            mintData = token.interface.encodeFunctionData("mint", [
                signer1.address,
                ethers.parseUnits("1000", 18),
                REG_US_A,
                issuanceDate
            ]);

            await rtaProxy.connect(signer1).submitOperation(token.target, mintData, 0);
            operationId = 0;
        });

        it("Should execute immediately with enough confirmations", async function () {
            await expect(rtaProxy.connect(signer2).confirmOperation(operationId))
                .to.emit(rtaProxy, "OperationExecuted")
                .withArgs(operationId);

            expect(await token.balanceOf(signer1.address)).to.equal(
                ethers.parseUnits("1000", 18)
            );
        });

        it("Should execute after 1 day", async function () {
            await time.increase(1 * 24 * 60 * 60); // 1 day

            await expect(rtaProxy.connect(signer2).confirmOperation(operationId))
                .to.emit(rtaProxy, "OperationExecuted");

            expect(await token.balanceOf(signer1.address)).to.equal(
                ethers.parseUnits("1000", 18)
            );
        });

        it("Should execute after 6 days", async function () {
            await time.increase(6 * 24 * 60 * 60); // 6 days

            await expect(rtaProxy.connect(signer2).confirmOperation(operationId))
                .to.emit(rtaProxy, "OperationExecuted");

            expect(await token.balanceOf(signer1.address)).to.equal(
                ethers.parseUnits("1000", 18)
            );
        });

        it("Should execute just before 7 days boundary", async function () {
            // Advance to 7 days minus a small buffer to account for block timestamp
            await time.increase(SEVEN_DAYS - 60); // 7 days minus 1 minute

            await expect(rtaProxy.connect(signer2).confirmOperation(operationId))
                .to.emit(rtaProxy, "OperationExecuted");

            expect(await token.balanceOf(signer1.address)).to.equal(
                ethers.parseUnits("1000", 18)
            );
        });
    });

    describe("Operation expiration after 7 days", function () {
        let operationId;
        let mintData;

        beforeEach(async function () {
            mintData = token.interface.encodeFunctionData("mint", [
                signer1.address,
                ethers.parseUnits("1000", 18),
                REG_US_A,
                issuanceDate
            ]);

            await rtaProxy.connect(signer1).submitOperation(token.target, mintData, 0);
            operationId = 0;
        });

        it("Should revert execution after 7 days + 1 second", async function () {
            await time.increase(SEVEN_DAYS + 1);

            await expect(
                rtaProxy.connect(signer2).confirmOperation(operationId)
            ).to.be.revertedWithCustomError(rtaProxy, "OperationExpired");

            // Token should not have been minted
            expect(await token.balanceOf(signer1.address)).to.equal(0);
        });

        it("Should revert execution after 14 days", async function () {
            await time.increase(14 * 24 * 60 * 60);

            await expect(
                rtaProxy.connect(signer2).confirmOperation(operationId)
            ).to.be.revertedWithCustomError(rtaProxy, "OperationExpired");
        });

        it("Should revert manual executeOperation after expiry", async function () {
            // Add second confirmation before expiry
            await rtaProxy.connect(signer2).confirmOperation(operationId);
            // Operation is now executed, so this test needs adjustment

            // Create a new operation that won't auto-execute
            // Use 3-of-3 scenario by creating new proxy
            const RTAProxy3of3 = await ethers.getContractFactory("RTAProxy");
            const rtaProxy3 = await RTAProxy3of3.deploy(
                [signer1.address, signer2.address, signer3.address],
                3 // Require all 3 signatures
            );
            await rtaProxy3.waitForDeployment();

            // Submit operation (auto-confirms for signer1)
            await rtaProxy3.connect(signer1).submitOperation(token.target, mintData, 0);
            // Add signer2 confirmation
            await rtaProxy3.connect(signer2).confirmOperation(0);
            // Now we have 2 of 3, not enough to execute

            // Wait past expiry
            await time.increase(SEVEN_DAYS + 1);

            // Try to execute manually
            await expect(
                rtaProxy3.connect(signer1).executeOperation(0)
            ).to.be.revertedWithCustomError(rtaProxy3, "OperationExpired");
        });
    });

    describe("Stale operation scenario (FIND-008 motivation)", function () {
        it("Should prevent stale operations from being executed after context change", async function () {
            // Scenario: Operation submitted, partially confirmed, then forgotten
            // Later someone tries to confirm/execute it

            const mintData = token.interface.encodeFunctionData("mint", [
                signer1.address,
                ethers.parseUnits("1000000", 18), // Large mint
                REG_US_A,
                issuanceDate
            ]);

            // Signer1 submits (auto-confirms)
            await rtaProxy.connect(signer1).submitOperation(token.target, mintData, 0);

            // Simulate "forgotten" operation - time passes
            await time.increase(30 * 24 * 60 * 60); // 30 days pass

            // Later, signer2 tries to confirm without remembering the context
            await expect(
                rtaProxy.connect(signer2).confirmOperation(0)
            ).to.be.revertedWithCustomError(rtaProxy, "OperationExpired");

            // Tokens were NOT minted
            expect(await token.balanceOf(signer1.address)).to.equal(0);
        });

        it("Should allow resubmission of expired operations", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                signer1.address,
                ethers.parseUnits("1000", 18),
                REG_US_A,
                issuanceDate
            ]);

            // Submit first operation
            await rtaProxy.connect(signer1).submitOperation(token.target, mintData, 0);

            // Wait past expiry
            await time.increase(SEVEN_DAYS + 1);

            // Original operation is expired
            await expect(
                rtaProxy.connect(signer2).confirmOperation(0)
            ).to.be.revertedWithCustomError(rtaProxy, "OperationExpired");

            // Resubmit with fresh timestamp
            await rtaProxy.connect(signer1).submitOperation(token.target, mintData, 0);

            // New operation (id=1) can be executed
            await expect(rtaProxy.connect(signer2).confirmOperation(1))
                .to.emit(rtaProxy, "OperationExecuted")
                .withArgs(1);

            expect(await token.balanceOf(signer1.address)).to.equal(
                ethers.parseUnits("1000", 18)
            );
        });
    });

    describe("Edge cases", function () {
        it("Should handle multiple operations with different timestamps", async function () {
            const mintData1 = token.interface.encodeFunctionData("mint", [
                signer1.address,
                ethers.parseUnits("100", 18),
                REG_US_A,
                issuanceDate
            ]);

            const mintData2 = token.interface.encodeFunctionData("mint", [
                signer2.address,
                ethers.parseUnits("200", 18),
                REG_US_A,
                issuanceDate
            ]);

            // Submit first operation
            await rtaProxy.connect(signer1).submitOperation(token.target, mintData1, 0);

            // Wait 5 days
            await time.increase(5 * 24 * 60 * 60);

            // Submit second operation
            await rtaProxy.connect(signer1).submitOperation(token.target, mintData2, 0);

            // Wait 3 more days (total 8 days from first op, 3 days from second)
            await time.increase(3 * 24 * 60 * 60);

            // First operation should be expired
            await expect(
                rtaProxy.connect(signer2).confirmOperation(0)
            ).to.be.revertedWithCustomError(rtaProxy, "OperationExpired");

            // Second operation should still be valid
            await expect(rtaProxy.connect(signer2).confirmOperation(1))
                .to.emit(rtaProxy, "OperationExecuted");

            expect(await token.balanceOf(signer1.address)).to.equal(0);
            expect(await token.balanceOf(signer2.address)).to.equal(
                ethers.parseUnits("200", 18)
            );
        });

        it("Should not affect already executed operations", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                signer1.address,
                ethers.parseUnits("1000", 18),
                REG_US_A,
                issuanceDate
            ]);

            // Submit and execute immediately
            await rtaProxy.connect(signer1).submitOperation(token.target, mintData, 0);
            await rtaProxy.connect(signer2).confirmOperation(0);

            // Verify executed
            const op = await rtaProxy.getOperation(0);
            expect(op[4]).to.be.true; // executed

            // Wait past expiry
            await time.increase(SEVEN_DAYS + 1);

            // Operation shows as expired but that's fine - it was already executed
            expect(await rtaProxy.isOperationExpired(0)).to.be.true;

            // Can't re-execute anyway
            await expect(
                rtaProxy.connect(signer3).confirmOperation(0)
            ).to.be.revertedWithCustomError(rtaProxy, "OperationAlreadyExecuted");
        });
    });
});

describe("RTAProxyUpgradeable Operation Expiration (FIND-008)", function () {
    const REG_US_A = 0x0001;
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30;

    let RTAProxyUpgradeable, ERC1450Upgradeable;
    let rtaProxy, token;
    let owner, signer1, signer2, signer3;

    const SEVEN_DAYS = 7 * 24 * 60 * 60;

    beforeEach(async function () {
        [owner, signer1, signer2, signer3] = await ethers.getSigners();

        RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
        ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");

        // Deploy RTAProxyUpgradeable with proxy
        rtaProxy = await upgrades.deployProxy(
            RTAProxyUpgradeable,
            [[signer1.address, signer2.address, signer3.address], 2],
            { initializer: "initialize" }
        );
        await rtaProxy.waitForDeployment();

        // Deploy ERC1450Upgradeable with proxy
        token = await upgrades.deployProxy(
            ERC1450Upgradeable,
            ["Security Token", "SEC", 18, owner.address, rtaProxy.target],
            { initializer: "initialize" }
        );
        await token.waitForDeployment();
    });

    describe("OPERATION_EXPIRY constant", function () {
        it("Should have OPERATION_EXPIRY set to 7 days", async function () {
            const expiry = await rtaProxy.OPERATION_EXPIRY();
            expect(expiry).to.equal(SEVEN_DAYS);
        });
    });

    describe("Operation expiration", function () {
        it("Should execute within 7 days", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                signer1.address,
                ethers.parseUnits("1000", 18),
                REG_US_A,
                issuanceDate
            ]);

            await rtaProxy.connect(signer1).submitOperation(token.target, mintData, 0);

            await time.increase(6 * 24 * 60 * 60); // 6 days

            await expect(rtaProxy.connect(signer2).confirmOperation(0))
                .to.emit(rtaProxy, "OperationExecuted");

            expect(await token.balanceOf(signer1.address)).to.equal(
                ethers.parseUnits("1000", 18)
            );
        });

        it("Should revert after 7 days", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                signer1.address,
                ethers.parseUnits("1000", 18),
                REG_US_A,
                issuanceDate
            ]);

            await rtaProxy.connect(signer1).submitOperation(token.target, mintData, 0);

            await time.increase(SEVEN_DAYS + 1);

            await expect(
                rtaProxy.connect(signer2).confirmOperation(0)
            ).to.be.revertedWithCustomError(rtaProxy, "OperationExpired");
        });

        it("Should return correct isOperationExpired status", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                signer1.address,
                ethers.parseUnits("1000", 18),
                REG_US_A,
                issuanceDate
            ]);

            await rtaProxy.connect(signer1).submitOperation(token.target, mintData, 0);

            expect(await rtaProxy.isOperationExpired(0)).to.be.false;

            await time.increase(SEVEN_DAYS + 1);

            expect(await rtaProxy.isOperationExpired(0)).to.be.true;
        });
    });
});
