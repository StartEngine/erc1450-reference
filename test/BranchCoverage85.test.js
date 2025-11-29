const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Branch Coverage Push to 85%", function () {
    const REG_US_A = 0x0001;
    const REG_US_CF = 0x0002;
    const issuanceDate1 = Math.floor(Date.now() / 1000) - 86400 * 30;
    const futureDate = Math.floor(Date.now() / 1000) + 86400 * 30;

    let token, tokenUpgradeable;
    let rtaProxy, rtaProxyUpgradeable;
    let owner, rta1, rta2, rta3, alice, bob, carol;
    let tokenAddress, tokenUpgradeableAddress;

    // Helper that submits and confirms, expecting success
    async function submitAndConfirmOperation(proxy, target, data, signers) {
        const opId = await proxy.operationCount();
        await proxy.connect(signers[0]).submitOperation(target, data, 0);
        for (let i = 1; i < signers.length; i++) {
            await proxy.connect(signers[i]).confirmOperation(opId);
        }
        return opId;
    }

    // Helper that submits and expects failure on confirm
    async function submitAndExpectFailure(proxy, target, data, signers) {
        const opId = await proxy.operationCount();
        await proxy.connect(signers[0]).submitOperation(target, data, 0);

        let reverted = false;
        try {
            for (let i = 1; i < signers.length; i++) {
                await proxy.connect(signers[i]).confirmOperation(opId);
            }
        } catch (error) {
            reverted = true;
        }
        expect(reverted, "Expected operation to revert").to.be.true;
    }

    beforeEach(async function () {
        [owner, rta1, rta2, rta3, alice, bob, carol] = await ethers.getSigners();

        // Deploy RTAProxy with 2-of-2 multisig
        const RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy([rta1.address, rta2.address], 2);
        await rtaProxy.waitForDeployment();

        // Deploy ERC1450 token
        const ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy(
            "Test Token", "TEST", 10,
            owner.address, await rtaProxy.getAddress()
        );
        await token.waitForDeployment();
        tokenAddress = await token.getAddress();

        // Deploy RTAProxyUpgradeable
        const RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
        rtaProxyUpgradeable = await upgrades.deployProxy(
            RTAProxyUpgradeable,
            [[rta1.address, rta2.address], 2],
            { initializer: 'initialize' }
        );
        await rtaProxyUpgradeable.waitForDeployment();

        // Deploy ERC1450Upgradeable
        const ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
        tokenUpgradeable = await upgrades.deployProxy(
            ERC1450Upgradeable,
            ["Test Token Upgradeable", "TESTU", 10, owner.address, await rtaProxyUpgradeable.getAddress()],
            { initializer: 'initialize' }
        );
        await tokenUpgradeable.waitForDeployment();
        tokenUpgradeableAddress = await tokenUpgradeable.getAddress();
    });

    describe("ERC1450Upgradeable - Mint Validation Branches", function () {
        it("Should revert mint with zero regulation type", async function () {
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), 0, issuanceDate1
            ]);
            await submitAndExpectFailure(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
        });

        it("Should revert mint with future issuance date", async function () {
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A, futureDate
            ]);
            await submitAndExpectFailure(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
        });
    });

    describe("ERC1450Upgradeable - BatchMint Validation Branches", function () {
        it("Should revert batchMint with empty arrays", async function () {
            const batchMintData = tokenUpgradeable.interface.encodeFunctionData("batchMint", [
                [], [], [], []
            ]);
            await submitAndExpectFailure(rtaProxyUpgradeable, tokenUpgradeableAddress, batchMintData, [rta1, rta2]);
        });

        it("Should revert batchMint with mismatched array lengths", async function () {
            const batchMintData = tokenUpgradeable.interface.encodeFunctionData("batchMint", [
                [alice.address, bob.address],
                [ethers.parseUnits("100", 10)],
                [REG_US_A, REG_US_A],
                [issuanceDate1, issuanceDate1]
            ]);
            await submitAndExpectFailure(rtaProxyUpgradeable, tokenUpgradeableAddress, batchMintData, [rta1, rta2]);
        });

        it("Should revert batchMint with zero address in recipients", async function () {
            const batchMintData = tokenUpgradeable.interface.encodeFunctionData("batchMint", [
                [alice.address, ethers.ZeroAddress],
                [ethers.parseUnits("100", 10), ethers.parseUnits("100", 10)],
                [REG_US_A, REG_US_A],
                [issuanceDate1, issuanceDate1]
            ]);
            await submitAndExpectFailure(rtaProxyUpgradeable, tokenUpgradeableAddress, batchMintData, [rta1, rta2]);
        });

        it("Should revert batchMint with zero regulation type in array", async function () {
            const batchMintData = tokenUpgradeable.interface.encodeFunctionData("batchMint", [
                [alice.address, bob.address],
                [ethers.parseUnits("100", 10), ethers.parseUnits("100", 10)],
                [REG_US_A, 0],
                [issuanceDate1, issuanceDate1]
            ]);
            await submitAndExpectFailure(rtaProxyUpgradeable, tokenUpgradeableAddress, batchMintData, [rta1, rta2]);
        });

        it("Should revert batchMint with future date in array", async function () {
            const batchMintData = tokenUpgradeable.interface.encodeFunctionData("batchMint", [
                [alice.address, bob.address],
                [ethers.parseUnits("100", 10), ethers.parseUnits("100", 10)],
                [REG_US_A, REG_US_A],
                [issuanceDate1, futureDate]
            ]);
            await submitAndExpectFailure(rtaProxyUpgradeable, tokenUpgradeableAddress, batchMintData, [rta1, rta2]);
        });
    });

    describe("ERC1450Upgradeable - BurnFromRegulation Branches", function () {
        it("Should revert burnFromRegulation with zero address", async function () {
            const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFromRegulation", [
                ethers.ZeroAddress, ethers.parseUnits("100", 10), REG_US_A
            ]);
            await submitAndExpectFailure(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);
        });
    });

    describe("ERC1450Upgradeable - ChangeIssuer Branches", function () {
        it("Should revert changeIssuer with zero address", async function () {
            const changeIssuerData = tokenUpgradeable.interface.encodeFunctionData("changeIssuer", [
                ethers.ZeroAddress
            ]);
            await submitAndExpectFailure(rtaProxyUpgradeable, tokenUpgradeableAddress, changeIssuerData, [rta1, rta2]);
        });
    });

    describe("RTAProxyUpgradeable - SubmitUpgradeOperation Branches", function () {
        it("Should revert submitUpgradeOperation with zero address", async function () {
            await expect(
                rtaProxyUpgradeable.connect(rta1).submitUpgradeOperation(ethers.ZeroAddress)
            ).to.be.revertedWith("Invalid implementation");
        });
    });

    describe("RTAProxyUpgradeable - RemoveSigner Branch", function () {
        it("Should revert removeSigner if would break multi-sig threshold", async function () {
            const proxyAddress = await rtaProxyUpgradeable.getAddress();
            const removeSignerData = rtaProxyUpgradeable.interface.encodeFunctionData("removeSigner", [
                rta2.address
            ]);
            await submitAndExpectFailure(rtaProxyUpgradeable, proxyAddress, removeSignerData, [rta1, rta2]);
        });
    });

    describe("ERC1450 - Constructor Branch", function () {
        it("Should revert deployment with zero transfer agent", async function () {
            const ERC1450 = await ethers.getContractFactory("ERC1450");
            await expect(
                ERC1450.deploy("Test", "TEST", 10, owner.address, ethers.ZeroAddress)
            ).to.be.revertedWith("ERC1450: Invalid transfer agent");
        });
    });

    describe("ERC1450 - Mint Validation Branches", function () {
        it("Should revert mint with zero regulation type", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), 0, issuanceDate1
            ]);
            await submitAndExpectFailure(rtaProxy, tokenAddress, mintData, [rta1, rta2]);
        });

        it("Should revert mint with future issuance date", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A, futureDate
            ]);
            await submitAndExpectFailure(rtaProxy, tokenAddress, mintData, [rta1, rta2]);
        });
    });

    describe("ERC1450 - BatchMint Validation Branches", function () {
        it("Should revert batchMint with empty arrays", async function () {
            const batchMintData = token.interface.encodeFunctionData("batchMint", [
                [], [], [], []
            ]);
            await submitAndExpectFailure(rtaProxy, tokenAddress, batchMintData, [rta1, rta2]);
        });

        it("Should revert batchMint with zero regulation in middle of array", async function () {
            const batchMintData = token.interface.encodeFunctionData("batchMint", [
                [alice.address, bob.address, carol.address],
                [ethers.parseUnits("100", 10), ethers.parseUnits("100", 10), ethers.parseUnits("100", 10)],
                [REG_US_A, 0, REG_US_A],
                [issuanceDate1, issuanceDate1, issuanceDate1]
            ]);
            await submitAndExpectFailure(rtaProxy, tokenAddress, batchMintData, [rta1, rta2]);
        });

        it("Should revert batchMint with future date in middle of array", async function () {
            const batchMintData = token.interface.encodeFunctionData("batchMint", [
                [alice.address, bob.address, carol.address],
                [ethers.parseUnits("100", 10), ethers.parseUnits("100", 10), ethers.parseUnits("100", 10)],
                [REG_US_A, REG_US_A, REG_US_A],
                [issuanceDate1, futureDate, issuanceDate1]
            ]);
            await submitAndExpectFailure(rtaProxy, tokenAddress, batchMintData, [rta1, rta2]);
        });
    });

    describe("ERC1450 - ChangeIssuer Branch", function () {
        it("Should revert changeIssuer with zero address", async function () {
            const changeIssuerData = token.interface.encodeFunctionData("changeIssuer", [
                ethers.ZeroAddress
            ]);
            await submitAndExpectFailure(rtaProxy, tokenAddress, changeIssuerData, [rta1, rta2]);
        });
    });

    describe("ERC1450 - TransferFromRegulated Branch Coverage", function () {
        beforeEach(async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);
        });

        it("Should revert transferFromRegulated to zero address", async function () {
            const transferData = token.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, ethers.ZeroAddress, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndExpectFailure(rtaProxy, tokenAddress, transferData, [rta1, rta2]);
        });
    });

    describe("ERC1450Upgradeable - TransferFromRegulated Branch Coverage", function () {
        beforeEach(async function () {
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
        });

        it("Should revert transferFromRegulated to zero address", async function () {
            const transferData = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, ethers.ZeroAddress, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndExpectFailure(rtaProxyUpgradeable, tokenUpgradeableAddress, transferData, [rta1, rta2]);
        });
    });

    describe("ERC1450 - BurnFromRegulation Branches", function () {
        it("Should revert burnFromRegulation with zero address", async function () {
            const burnData = token.interface.encodeFunctionData("burnFromRegulation", [
                ethers.ZeroAddress, ethers.parseUnits("100", 10), REG_US_A
            ]);
            await submitAndExpectFailure(rtaProxy, tokenAddress, burnData, [rta1, rta2]);
        });
    });

    describe("RTAProxy - AddSigner Already Signer Branch", function () {
        it("Should revert addSigner for existing signer", async function () {
            const proxyAddress = await rtaProxy.getAddress();
            const addSignerData = rtaProxy.interface.encodeFunctionData("addSigner", [
                rta1.address
            ]);
            await submitAndExpectFailure(rtaProxy, proxyAddress, addSignerData, [rta1, rta2]);
        });
    });

    describe("RTAProxyUpgradeable - AddSigner Already Signer Branch", function () {
        it("Should revert addSigner for existing signer", async function () {
            const proxyAddress = await rtaProxyUpgradeable.getAddress();
            const addSignerData = rtaProxyUpgradeable.interface.encodeFunctionData("addSigner", [
                rta1.address
            ]);
            await submitAndExpectFailure(rtaProxyUpgradeable, proxyAddress, addSignerData, [rta1, rta2]);
        });
    });

    describe("ERC1450 - SetAccountFrozen Both Branches", function () {
        it("Should cover both freeze and unfreeze paths", async function () {
            const freezeData = token.interface.encodeFunctionData("setAccountFrozen", [alice.address, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, freezeData, [rta1, rta2]);
            expect(await token.isAccountFrozen(alice.address)).to.equal(true);

            const unfreezeData = token.interface.encodeFunctionData("setAccountFrozen", [alice.address, false]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, unfreezeData, [rta1, rta2]);
            expect(await token.isAccountFrozen(alice.address)).to.equal(false);
        });
    });

    describe("ERC1450Upgradeable - SetAccountFrozen Both Branches", function () {
        it("Should cover both freeze and unfreeze paths", async function () {
            const freezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [alice.address, true]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, freezeData, [rta1, rta2]);
            expect(await tokenUpgradeable.isAccountFrozen(alice.address)).to.equal(true);

            const unfreezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [alice.address, false]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, unfreezeData, [rta1, rta2]);
            expect(await tokenUpgradeable.isAccountFrozen(alice.address)).to.equal(false);
        });
    });

    describe("ERC1450 - NotFrozen Modifier Both Branches", function () {
        beforeEach(async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);
        });

        it("Should revert transfer when from is frozen", async function () {
            const freezeData = token.interface.encodeFunctionData("setAccountFrozen", [alice.address, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, freezeData, [rta1, rta2]);

            const transferData = token.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, bob.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndExpectFailure(rtaProxy, tokenAddress, transferData, [rta1, rta2]);
        });

        it("Should revert transfer when to is frozen", async function () {
            const freezeData = token.interface.encodeFunctionData("setAccountFrozen", [bob.address, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, freezeData, [rta1, rta2]);

            const transferData = token.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, bob.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndExpectFailure(rtaProxy, tokenAddress, transferData, [rta1, rta2]);
        });
    });

    describe("ERC1450Upgradeable - NotFrozen Modifier Both Branches", function () {
        beforeEach(async function () {
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
        });

        it("Should revert transfer when from is frozen", async function () {
            const freezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [alice.address, true]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, freezeData, [rta1, rta2]);

            const transferData = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, bob.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndExpectFailure(rtaProxyUpgradeable, tokenUpgradeableAddress, transferData, [rta1, rta2]);
        });

        it("Should revert transfer when to is frozen", async function () {
            const freezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [bob.address, true]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, freezeData, [rta1, rta2]);

            const transferData = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, bob.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndExpectFailure(rtaProxyUpgradeable, tokenUpgradeableAddress, transferData, [rta1, rta2]);
        });
    });
});
