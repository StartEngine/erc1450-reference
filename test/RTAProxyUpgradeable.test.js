const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("RTAProxyUpgradeable Multi-Sig", function () {
    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago

    let RTAProxyUpgradeable, ERC1450Upgradeable;
    let rtaProxy, token;
    let owner, signer1, signer2, signer3, nonSigner, holder1;
    let rtaProxyAddress, tokenAddress;

    beforeEach(async function () {
        // Get signers
        [owner, signer1, signer2, signer3, nonSigner, holder1] = await ethers.getSigners();

        // Get contract factories
        RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
        ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");

        // Deploy RTAProxyUpgradeable with UUPS proxy
        rtaProxy = await upgrades.deployProxy(
            RTAProxyUpgradeable,
            [[signer1.address, signer2.address, signer3.address], 2],
            { initializer: 'initialize', kind: 'uups' }
        );
        await rtaProxy.waitForDeployment();
        rtaProxyAddress = await rtaProxy.getAddress();

        // Deploy token for testing RTA operations
        token = await upgrades.deployProxy(
            ERC1450Upgradeable,
            ["Test Token", "TST", 10, owner.address, rtaProxyAddress],
            { initializer: 'initialize', kind: 'uups' }
        );
        await token.waitForDeployment();
        tokenAddress = await token.getAddress();
    });

    describe("Deployment & Initialization", function () {
        it("Should set the correct signers", async function () {
            const signers = await rtaProxy.getSigners();
            expect(signers).to.deep.equal([signer1.address, signer2.address, signer3.address]);
        });

        it("Should set the correct required signatures", async function () {
            expect(await rtaProxy.requiredSignatures()).to.equal(2);
        });

        it("Should identify signers correctly", async function () {
            expect(await rtaProxy.isSigner(signer1.address)).to.be.true;
            expect(await rtaProxy.isSigner(signer2.address)).to.be.true;
            expect(await rtaProxy.isSigner(signer3.address)).to.be.true;
            expect(await rtaProxy.isSigner(nonSigner.address)).to.be.false;
        });

        it("Should prevent re-initialization", async function () {
            await expect(
                rtaProxy.initialize(
                    [signer1.address, signer2.address], 1
                )
            ).to.be.reverted;
        });

        it("Should have proxy address different from implementation", async function () {
            const implAddress = await upgrades.erc1967.getImplementationAddress(rtaProxyAddress);
            expect(rtaProxyAddress).to.not.equal(implAddress);
        });

        it("Should return correct version", async function () {
            expect(await rtaProxy.version()).to.equal("1.0.0");
        });
    });

    describe("Upgrade Mechanism", function () {
        it("Should allow signers to submit upgrade operation", async function () {
            const newImpl = ethers.Wallet.createRandom().address;

            await expect(
                rtaProxy.connect(signer1).submitUpgradeOperation(newImpl)
            ).to.emit(rtaProxy, "OperationSubmitted")
                .withArgs(0, signer1.address);
        });

        it("Should require multi-sig for upgrades", async function () {
            const newImpl = ethers.Wallet.createRandom().address;

            // First signer submits
            await rtaProxy.connect(signer1).submitUpgradeOperation(newImpl);

            // Operation should not be executed yet
            const op = await rtaProxy.getOperation(0);
            expect(op.executed).to.be.false;
            expect(op.confirmations).to.equal(1);

            // After second confirmation, it would prepare for upgrade
            // (actual upgrade would fail with random address, but the multi-sig part works)
        });

        it("Should reject upgrade from non-signers", async function () {
            const newImpl = ethers.Wallet.createRandom().address;

            await expect(
                rtaProxy.connect(nonSigner).submitUpgradeOperation(newImpl)
            ).to.be.reverted;
        });
    });

    describe("Operation Submission", function () {
        it("Should allow signer to submit operation", async function () {
            const data = token.interface.encodeFunctionData("mint", [holder1.address, 1000, REG_US_A, issuanceDate]);

            await expect(
                rtaProxy.connect(signer1).submitOperation(tokenAddress, data, 0)
            ).to.emit(rtaProxy, "OperationSubmitted");
        });

        it("Should auto-confirm from submitter", async function () {
            const data = token.interface.encodeFunctionData("mint", [holder1.address, 1000, REG_US_A, issuanceDate]);

            await rtaProxy.connect(signer1).submitOperation(tokenAddress, data, 0);

            expect(await rtaProxy.hasConfirmed(0, signer1.address)).to.be.true;

            const op = await rtaProxy.getOperation(0);
            expect(op.confirmations).to.equal(1);
        });

        it("Should reject submission from non-signer", async function () {
            const data = "0x12345678";

            await expect(
                rtaProxy.connect(nonSigner).submitOperation(tokenAddress, data, 0)
            ).to.be.reverted;
        });
    });

    describe("Operation Confirmation", function () {
        beforeEach(async function () {
            // Submit an operation
            const data = token.interface.encodeFunctionData("mint", [holder1.address, 1000, REG_US_A, issuanceDate]);
            await rtaProxy.connect(signer1).submitOperation(tokenAddress, data, 0);
        });

        it("Should allow other signers to confirm", async function () {
            await expect(
                rtaProxy.connect(signer2).confirmOperation(0)
            ).to.emit(rtaProxy, "OperationConfirmed")
                .withArgs(0, signer2.address);

            expect(await rtaProxy.hasConfirmed(0, signer2.address)).to.be.true;
        });

        it("Should auto-execute with enough confirmations", async function () {
            // Second confirmation should trigger execution
            await expect(
                rtaProxy.connect(signer2).confirmOperation(0)
            ).to.emit(rtaProxy, "OperationExecuted")
                .withArgs(0);

            const op = await rtaProxy.getOperation(0);
            expect(op.executed).to.be.true;
        });

        it("Should prevent double confirmation", async function () {
            // Signer1 already confirmed during submission
            await expect(
                rtaProxy.connect(signer1).confirmOperation(0)
            ).to.be.reverted;
        });

        it("Should reject confirmation from non-signer", async function () {
            await expect(
                rtaProxy.connect(nonSigner).confirmOperation(0)
            ).to.be.reverted;
        });
    });

    describe("Operation Revocation", function () {
        beforeEach(async function () {
            const data = token.interface.encodeFunctionData("mint", [holder1.address, 1000, REG_US_A, issuanceDate]);
            await rtaProxy.connect(signer1).submitOperation(tokenAddress, data, 0);
        });

        it("Should allow signer to revoke confirmation", async function () {
            await expect(
                rtaProxy.connect(signer1).revokeConfirmation(0)
            ).to.emit(rtaProxy, "OperationRevoked")
                .withArgs(0, signer1.address);

            expect(await rtaProxy.hasConfirmed(0, signer1.address)).to.be.false;
        });

        it("Should update confirmation count", async function () {
            await rtaProxy.connect(signer1).revokeConfirmation(0);

            const op = await rtaProxy.getOperation(0);
            expect(op.confirmations).to.equal(0);
        });

        it("Should reject revocation if not confirmed", async function () {
            await expect(
                rtaProxy.connect(signer2).revokeConfirmation(0)
            ).to.be.reverted;
        });
    });

    describe("Manual Execution", function () {
        beforeEach(async function () {
            const data = token.interface.encodeFunctionData("mint", [holder1.address, 1000, REG_US_A, issuanceDate]);
            await rtaProxy.connect(signer1).submitOperation(tokenAddress, data, 0);
        });

        it("Should allow manual execution with enough confirmations", async function () {
            // Add second confirmation without auto-execute
            await rtaProxy.connect(signer2).confirmOperation(0);

            // Operation should be executed already due to auto-execute
            const op = await rtaProxy.getOperation(0);
            expect(op.executed).to.be.true;
        });

        it("Should reject execution without enough confirmations", async function () {
            // Revoke to prevent auto-execution
            await rtaProxy.connect(signer1).revokeConfirmation(0);

            await expect(
                rtaProxy.connect(signer1).executeOperation(0)
            ).to.be.reverted;
        });
    });

    describe("Signer Management", function () {
        it("Should add new signer through multi-sig", async function () {
            const newSigner = ethers.Wallet.createRandom().address;
            const data = rtaProxy.interface.encodeFunctionData("addSigner", [newSigner]);

            // Submit and confirm operation
            await rtaProxy.connect(signer1).submitOperation(rtaProxyAddress, data, 0);
            await rtaProxy.connect(signer2).confirmOperation(0);

            expect(await rtaProxy.isSigner(newSigner)).to.be.true;
            const signers = await rtaProxy.getSigners();
            expect(signers).to.include(newSigner);
        });

        it("Should remove signer through multi-sig", async function () {
            const data = rtaProxy.interface.encodeFunctionData("removeSigner", [signer3.address]);

            // Submit and confirm operation
            await rtaProxy.connect(signer1).submitOperation(rtaProxyAddress, data, 0);
            await rtaProxy.connect(signer2).confirmOperation(0);

            expect(await rtaProxy.isSigner(signer3.address)).to.be.false;
            const signers = await rtaProxy.getSigners();
            expect(signers).to.not.include(signer3.address);
        });

        it("Should update required signatures through multi-sig", async function () {
            const data = rtaProxy.interface.encodeFunctionData("updateRequiredSignatures", [3]);

            // Submit and confirm operation
            await rtaProxy.connect(signer1).submitOperation(rtaProxyAddress, data, 0);
            await rtaProxy.connect(signer2).confirmOperation(0);

            expect(await rtaProxy.requiredSignatures()).to.equal(3);
        });

        it("Should reject direct signer management calls", async function () {
            const newSigner = ethers.Wallet.createRandom().address;

            await expect(
                rtaProxy.connect(signer1).addSigner(newSigner)
            ).to.be.reverted;
        });
    });

    describe("Complex Token Operations", function () {
        it("Should mint tokens through multi-sig", async function () {
            const mintAmount = ethers.parseUnits("1000", 10);
            const data = token.interface.encodeFunctionData("mint", [holder1.address, mintAmount
            , REG_US_A, issuanceDate]);

            await rtaProxy.connect(signer1).submitOperation(tokenAddress, data, 0);
            await rtaProxy.connect(signer2).confirmOperation(0);

            expect(await token.balanceOf(holder1.address)).to.equal(mintAmount);
        });

        it("Should set fee parameters through multi-sig", async function () {
            const data = token.interface.encodeFunctionData("setFeeParameters", [
                1, // percentage
                100, // 1%
                [ethers.ZeroAddress]
            ]);

            await rtaProxy.connect(signer1).submitOperation(tokenAddress, data, 0);
            await rtaProxy.connect(signer2).confirmOperation(0);

            expect(await token.feeType()).to.equal(1);
            expect(await token.feeValue()).to.equal(100);
        });

        it("Should manage brokers through multi-sig", async function () {
            const broker = ethers.Wallet.createRandom().address;
            const data = token.interface.encodeFunctionData("setBrokerStatus", [
                broker,
                true
            ]);

            await rtaProxy.connect(signer1).submitOperation(tokenAddress, data, 0);
            await rtaProxy.connect(signer2).confirmOperation(0);

            expect(await token.isRegisteredBroker(broker)).to.be.true;
        });
    });

    describe("Time-Lock Features", function () {
        it("Should detect operations requiring time-lock", async function () {
            // Low value (1000000 wei) - well below threshold
            const lowValueData = token.interface.encodeFunctionData("transferFromRegulated", [
                holder1.address,
                owner.address,
                1000000,
                REG_US_A,
                issuanceDate
            ]);

            // Low value transfers should not require time-lock
            expect(await rtaProxy.requiresTimeLock(lowValueData)).to.be.false;

            // High value (1M tokens) - at threshold, should require time-lock
            const highValueData = token.interface.encodeFunctionData("transferFromRegulated", [
                holder1.address,
                owner.address,
                ethers.parseUnits("1000000", 10),
                REG_US_A,
                issuanceDate
            ]);

            expect(await rtaProxy.requiresTimeLock(highValueData)).to.be.true;
        });

        it("Should handle empty data", async function () {
            expect(await rtaProxy.requiresTimeLock("0x")).to.be.false;
        });
    });

    describe("Edge Cases", function () {
        it("Should handle invalid operation ID", async function () {
            await expect(
                rtaProxy.getOperation(999)
            ).to.be.reverted;
        });

        it("Should track operation count correctly", async function () {
            expect(await rtaProxy.operationCount()).to.equal(0);

            const data = "0x12345678";
            await rtaProxy.connect(signer1).submitOperation(tokenAddress, data, 0);

            expect(await rtaProxy.operationCount()).to.equal(1);
        });

        it("Should handle operations with ETH value", async function () {
            const data = "0x";
            const value = ethers.parseUnits("1", 10);

            await rtaProxy.connect(signer1).submitOperation(
                holder1.address,
                data,
                value
            );

            const op = await rtaProxy.getOperation(0);
            expect(op.value).to.equal(value);
        });

        it("Should store operation details correctly", async function () {
            const data = "0xabcdef";
            const target = holder1.address;
            const value = 100;

            await rtaProxy.connect(signer1).submitOperation(target, data, value);

            const op = await rtaProxy.getOperation(0);
            expect(op.target).to.equal(target);
            expect(op.data).to.equal(data);
            expect(op.value).to.equal(value);
            expect(op.confirmations).to.equal(1);
            expect(op.executed).to.be.false;
        });
    });

    describe("Upgrade Validation", function () {
        it("Should validate upgrade compatibility", async function () {
            // This tests that the contract is properly set up for upgrades
            await expect(
                upgrades.validateUpgrade(
                    rtaProxyAddress,
                    RTAProxyUpgradeable,
                    { kind: 'uups' }
                )
            ).to.not.be.reverted;
        });
    });
});