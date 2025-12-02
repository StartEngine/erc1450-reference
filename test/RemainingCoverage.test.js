const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { version: EXPECTED_VERSION } = require("../package.json");

describe("Remaining Coverage - Final Push to 90%+", function () {
    const REG_US_A = 0x0001;
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago

    let ERC1450, token, RTAProxy, rtaProxy;
    let ERC1450Upgradeable, tokenUpgradeable, RTAProxyUpgradeable, rtaProxyUpgradeable;
    let owner, issuer, rta, alice, bob, signer2, signer3;
    let mockERC20;

    beforeEach(async function () {
        [owner, issuer, rta, alice, bob, signer2, signer3] = await ethers.getSigners();

        // Deploy mock ERC20
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockERC20 = await MockERC20.deploy("Mock Token", "MOCK", 6);
        await mockERC20.waitForDeployment();

        // Deploy standard contracts
        RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy([rta.address, signer2.address, signer3.address], 2);
        await rtaProxy.waitForDeployment();

        ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy("Test Security Token", "TST", 10, issuer.address, rtaProxy.target);
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
            ["Test Security Token", "TST", 10, issuer.address, rtaProxyUpgradeable.target],
            { kind: "uups" }
        );
        await tokenUpgradeable.waitForDeployment();
    });

    describe("version() function coverage", function () {
        it("Should return version for ERC1450", async function () {
            const version = await token.version();
            expect(version).to.equal(EXPECTED_VERSION);
        });

        it("Should return version for ERC1450Upgradeable", async function () {
            const version = await tokenUpgradeable.version();
            expect(version).to.equal(EXPECTED_VERSION);
        });

        it("Should return version for RTAProxy", async function () {
            const version = await rtaProxy.version();
            expect(version).to.equal(EXPECTED_VERSION);
        });

        it("Should return version for RTAProxyUpgradeable", async function () {
            const version = await rtaProxyUpgradeable.version();
            expect(version).to.equal(EXPECTED_VERSION);
        });
    });

    describe("MockERC20 coverage", function () {
        it("Should return correct decimals", async function () {
            const decimals = await mockERC20.decimals();
            expect(decimals).to.equal(6);
        });

        it("Should burn tokens", async function () {
            // Mint some tokens first
            await mockERC20.mint(alice.address, 1000);
            expect(await mockERC20.balanceOf(alice.address)).to.equal(1000);

            // Burn tokens
            await mockERC20.burn(alice.address, 500);
            expect(await mockERC20.balanceOf(alice.address)).to.equal(500);
        });

        it("Should burn all tokens", async function () {
            await mockERC20.mint(bob.address, 100);
            await mockERC20.burn(bob.address, 100);
            expect(await mockERC20.balanceOf(bob.address)).to.equal(0);
        });
    });

    describe("ERC1450Upgradeable - processTransferRequest with frozen accounts", function () {
        async function mintViaMultiSig(recipient, amount) {
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                recipient,
                amount,
                REG_US_A,
                issuanceDate
            ]);
            const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(
                tokenUpgradeable.target,
                mintData,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxyUpgradeable.interface.parseLog(log)?.name === "OperationSubmitted";
                } catch { return false; }
            });
            const opId = rtaProxyUpgradeable.interface.parseLog(event).args.operationId;
            await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);
        }

        async function executeViaMultiSig(data) {
            const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(
                tokenUpgradeable.target,
                data,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxyUpgradeable.interface.parseLog(log)?.name === "OperationSubmitted";
                } catch { return false; }
            });
            const opId = rtaProxyUpgradeable.interface.parseLog(event).args.operationId;
            await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);
        }

        it("Should revert processTransferRequest when FROM account is frozen", async function () {
            // Mint tokens to alice
            await mintViaMultiSig(alice.address, 1000);

            // Create a transfer request
            await tokenUpgradeable.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                500,
                ethers.ZeroAddress,
                0
            );
            const requestId = 1n;

            // Freeze alice's account
            const freezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [
                alice.address,
                true
            ]);
            await executeViaMultiSig(freezeData);

            // Try to process the transfer - should fail because FROM is frozen
            const processData = tokenUpgradeable.interface.encodeFunctionData("processTransferRequest", [
                requestId,
                true
            ]);

            // Submit and get operation ID
            const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(
                tokenUpgradeable.target,
                processData,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxyUpgradeable.interface.parseLog(log)?.name === "OperationSubmitted";
                } catch { return false; }
            });
            const opId = rtaProxyUpgradeable.interface.parseLog(event).args.operationId;

            // Confirm should revert because the underlying call fails
            let reverted = false;
            try {
                await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);
            } catch (e) {
                reverted = true;
            }
            expect(reverted).to.be.true;
        });

        it("Should revert processTransferRequest when TO account is frozen", async function () {
            // Mint tokens to alice
            await mintViaMultiSig(alice.address, 1000);

            // Create a transfer request
            await tokenUpgradeable.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                500,
                ethers.ZeroAddress,
                0
            );
            const requestId = 1n;

            // Freeze bob's account (recipient)
            const freezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [
                bob.address,
                true
            ]);
            await executeViaMultiSig(freezeData);

            // Try to process the transfer - should fail because TO is frozen
            const processData = tokenUpgradeable.interface.encodeFunctionData("processTransferRequest", [
                requestId,
                true
            ]);

            // Submit and get operation ID
            const tx = await rtaProxyUpgradeable.connect(rta).submitOperation(
                tokenUpgradeable.target,
                processData,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxyUpgradeable.interface.parseLog(log)?.name === "OperationSubmitted";
                } catch { return false; }
            });
            const opId = rtaProxyUpgradeable.interface.parseLog(event).args.operationId;

            // Confirm should revert because the underlying call fails
            let reverted = false;
            try {
                await rtaProxyUpgradeable.connect(signer2).confirmOperation(opId);
            } catch (e) {
                reverted = true;
            }
            expect(reverted).to.be.true;
        });
    });

    describe("ERC1450 - processTransferRequest with frozen accounts", function () {
        async function mintViaMultiSig(recipient, amount) {
            const mintData = token.interface.encodeFunctionData("mint", [
                recipient,
                amount,
                REG_US_A,
                issuanceDate
            ]);
            const tx = await rtaProxy.connect(rta).submitOperation(
                token.target,
                mintData,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxy.interface.parseLog(log)?.name === "OperationSubmitted";
                } catch { return false; }
            });
            const opId = rtaProxy.interface.parseLog(event).args.operationId;
            await rtaProxy.connect(signer2).confirmOperation(opId);
        }

        async function executeViaMultiSig(data) {
            const tx = await rtaProxy.connect(rta).submitOperation(
                token.target,
                data,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxy.interface.parseLog(log)?.name === "OperationSubmitted";
                } catch { return false; }
            });
            const opId = rtaProxy.interface.parseLog(event).args.operationId;
            await rtaProxy.connect(signer2).confirmOperation(opId);
        }

        it("Should revert processTransferRequest when FROM account is frozen", async function () {
            // Mint tokens to alice
            await mintViaMultiSig(alice.address, 1000);

            // Create a transfer request
            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                500,
                ethers.ZeroAddress,
                0
            );
            const requestId = 1n;

            // Freeze alice's account
            const freezeData = token.interface.encodeFunctionData("setAccountFrozen", [
                alice.address,
                true
            ]);
            await executeViaMultiSig(freezeData);

            // Try to process the transfer - should fail because FROM is frozen
            const processData = token.interface.encodeFunctionData("processTransferRequest", [
                requestId,
                true
            ]);

            // Submit and get operation ID
            const tx = await rtaProxy.connect(rta).submitOperation(
                token.target,
                processData,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxy.interface.parseLog(log)?.name === "OperationSubmitted";
                } catch { return false; }
            });
            const opId = rtaProxy.interface.parseLog(event).args.operationId;

            // Confirm should revert because the underlying call fails
            let reverted = false;
            try {
                await rtaProxy.connect(signer2).confirmOperation(opId);
            } catch (e) {
                reverted = true;
            }
            expect(reverted).to.be.true;
        });

        it("Should revert processTransferRequest when TO account is frozen", async function () {
            // Mint tokens to alice
            await mintViaMultiSig(alice.address, 1000);

            // Create a transfer request
            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                500,
                ethers.ZeroAddress,
                0
            );
            const requestId = 1n;

            // Freeze bob's account (recipient)
            const freezeData = token.interface.encodeFunctionData("setAccountFrozen", [
                bob.address,
                true
            ]);
            await executeViaMultiSig(freezeData);

            // Try to process the transfer - should fail because TO is frozen
            const processData = token.interface.encodeFunctionData("processTransferRequest", [
                requestId,
                true
            ]);

            // Submit and get operation ID
            const tx = await rtaProxy.connect(rta).submitOperation(
                token.target,
                processData,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return rtaProxy.interface.parseLog(log)?.name === "OperationSubmitted";
                } catch { return false; }
            });
            const opId = rtaProxy.interface.parseLog(event).args.operationId;

            // Confirm should revert because the underlying call fails
            let reverted = false;
            try {
                await rtaProxy.connect(signer2).confirmOperation(opId);
            } catch (e) {
                reverted = true;
            }
            expect(reverted).to.be.true;
        });
    });

    describe("AccountFrozen event coverage", function () {
        async function executeViaMultiSig(proxy, targetToken, data) {
            const tx = await proxy.connect(rta).submitOperation(
                targetToken.target,
                data,
                0
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try {
                    return proxy.interface.parseLog(log)?.name === "OperationSubmitted";
                } catch { return false; }
            });
            const opId = proxy.interface.parseLog(event).args.operationId;
            await proxy.connect(signer2).confirmOperation(opId);
        }

        it("Should emit AccountFrozen event when freezing (ERC1450)", async function () {
            const freezeData = token.interface.encodeFunctionData("setAccountFrozen", [
                alice.address,
                true
            ]);

            // We need to check events after multi-sig execution
            const tx = await rtaProxy.connect(rta).submitOperation(token.target, freezeData, 0);
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try { return rtaProxy.interface.parseLog(log)?.name === "OperationSubmitted"; }
                catch { return false; }
            });
            const opId = rtaProxy.interface.parseLog(event).args.operationId;

            // Confirm and check for AccountFrozen event
            const confirmTx = await rtaProxy.connect(signer2).confirmOperation(opId);
            const confirmReceipt = await confirmTx.wait();

            // Find the AccountFrozen event
            const frozenEvent = confirmReceipt.logs.find(log => {
                try { return token.interface.parseLog(log)?.name === "AccountFrozen"; }
                catch { return false; }
            });

            expect(frozenEvent).to.not.be.undefined;
            const parsedEvent = token.interface.parseLog(frozenEvent);
            expect(parsedEvent.args.account).to.equal(alice.address);
            expect(parsedEvent.args.frozen).to.equal(true);
        });

        it("Should emit AccountFrozen event when unfreezing (ERC1450)", async function () {
            // First freeze
            await executeViaMultiSig(rtaProxy, token,
                token.interface.encodeFunctionData("setAccountFrozen", [alice.address, true])
            );

            // Then unfreeze and check event
            const unfreezeData = token.interface.encodeFunctionData("setAccountFrozen", [
                alice.address,
                false
            ]);

            const tx = await rtaProxy.connect(rta).submitOperation(token.target, unfreezeData, 0);
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => {
                try { return rtaProxy.interface.parseLog(log)?.name === "OperationSubmitted"; }
                catch { return false; }
            });
            const opId = rtaProxy.interface.parseLog(event).args.operationId;

            const confirmTx = await rtaProxy.connect(signer2).confirmOperation(opId);
            const confirmReceipt = await confirmTx.wait();

            const frozenEvent = confirmReceipt.logs.find(log => {
                try { return token.interface.parseLog(log)?.name === "AccountFrozen"; }
                catch { return false; }
            });

            expect(frozenEvent).to.not.be.undefined;
            const parsedEvent = token.interface.parseLog(frozenEvent);
            expect(parsedEvent.args.account).to.equal(alice.address);
            expect(parsedEvent.args.frozen).to.equal(false);
        });
    });
});
