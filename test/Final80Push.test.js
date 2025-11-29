const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Final 80% Push - Error Paths", function () {
    const REG_US_A = 0x0001;
    const REG_US_CF = 0x0002;
    const issuanceDate1 = Math.floor(Date.now() / 1000) - 86400 * 30;

    let token, tokenUpgradeable;
    let rtaProxy, rtaProxyUpgradeable;
    let owner, rta1, rta2, alice, bob, carol;
    let tokenAddress, tokenUpgradeableAddress;

    async function submitAndConfirmOperation(proxy, target, data, signers) {
        const opId = await proxy.operationCount();
        await proxy.connect(signers[0]).submitOperation(target, data, 0);
        for (let i = 1; i < signers.length; i++) {
            await proxy.connect(signers[i]).confirmOperation(opId);
        }
    }

    beforeEach(async function () {
        [owner, rta1, rta2, alice, bob, carol] = await ethers.getSigners();

        const RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy([rta1.address, rta2.address], 2);
        await rtaProxy.waitForDeployment();

        const ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy("Security Token", "SEC", 10, owner.address, await rtaProxy.getAddress());
        await token.waitForDeployment();
        tokenAddress = await token.getAddress();

        const RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
        rtaProxyUpgradeable = await upgrades.deployProxy(
            RTAProxyUpgradeable,
            [[rta1.address, rta2.address], 2],
            { initializer: 'initialize' }
        );
        await rtaProxyUpgradeable.waitForDeployment();

        const ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
        tokenUpgradeable = await upgrades.deployProxy(
            ERC1450Upgradeable,
            ["Security Token Upgradeable", "SECU", 10, owner.address, await rtaProxyUpgradeable.getAddress()],
            { initializer: 'initialize' }
        );
        await tokenUpgradeable.waitForDeployment();
        tokenUpgradeableAddress = await tokenUpgradeable.getAddress();
    });

    describe("ERC1450 - Comprehensive Batch Coverage", function () {

        it("Should handle very large batch cleanup scenarios", async function () {
            // Create 30 small batches that will mostly be depleted
            for (let i = 0; i < 30; i++) {
                const mintData = token.interface.encodeFunctionData("mint", [
                    alice.address, ethers.parseUnits("3", 10), REG_US_A, issuanceDate1 - (i * 100)
                ]);
                await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);
            }

            // Burn an amount that depletes many batches completely
            const burnData = token.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseUnits("88", 10)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData, [rta1, rta2]);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("2", 10));
        });

        it("Should handle mixed regulation batch minting patterns", async function () {
            // Create complex mixing of regulations and dates
            const recipients = [];
            const amounts = [];
            const regulations = [];
            const dates = [];

            for (let i = 0; i < 40; i++) {
                recipients.push([alice.address, bob.address, carol.address][i % 3]);
                amounts.push(ethers.parseUnits("2", 10));
                regulations.push([REG_US_A, REG_US_CF][i % 2]);
                dates.push(issuanceDate1 - (i * 200));
            }

            const batchMintData = token.interface.encodeFunctionData("batchMint", [
                recipients, amounts, regulations, dates
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, batchMintData, [rta1, rta2]);

            expect(await token.totalSupply()).to.equal(ethers.parseUnits("80", 10));
        });

        it("Should handle multiple sequential batch operations", async function () {
            // Batch mint
            const batchMint1 = token.interface.encodeFunctionData("batchMint", [
                [alice.address, bob.address],
                [ethers.parseUnits("100", 10), ethers.parseUnits("100", 10)],
                [REG_US_A, REG_US_A],
                [issuanceDate1, issuanceDate1]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, batchMint1, [rta1, rta2]);

            // Another batch mint
            const batchMint2 = token.interface.encodeFunctionData("batchMint", [
                [alice.address, bob.address],
                [ethers.parseUnits("50", 10), ethers.parseUnits("50", 10)],
                [REG_US_CF, REG_US_CF],
                [issuanceDate1, issuanceDate1]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, batchMint2, [rta1, rta2]);

            // Batch burn
            const batchBurn = token.interface.encodeFunctionData("batchBurnFrom", [
                [alice.address, bob.address],
                [ethers.parseUnits("25", 10), ethers.parseUnits("25", 10)],
                [REG_US_A, REG_US_A],
                [issuanceDate1, issuanceDate1]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, batchBurn, [rta1, rta2]);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("125", 10));
        });

        it("Should handle edge cases in fee management", async function () {
            // Set fee parameters multiple times with different configurations
            const setFee1 = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseUnits("0.005", 10), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFee1, [rta1, rta2]);

            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const feeToken = await MockERC20.deploy("Fee", "FEE", 18);
            await feeToken.waitForDeployment();

            const setFee2 = token.interface.encodeFunctionData("setFeeParameters", [
                1, ethers.parseUnits("2", 10), [await feeToken.getAddress()]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFee2, [rta1, rta2]);

            // Reset to native only
            const setFee3 = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseUnits("0.01", 10), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFee3, [rta1, rta2]);
        });
    });

    describe("ERC1450Upgradeable - Deep Branch Testing", function () {

        it("Should handle complex sequential operations on upgradeable", async function () {
            // Multiple mint operations with different params
            for (let i = 0; i < 15; i++) {
                const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                    [alice.address, bob.address, carol.address][i % 3],
                    ethers.parseUnits("7", 10),
                    [REG_US_A, REG_US_CF][i % 2],
                    issuanceDate1 - (i * 300)
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
            }

            // Burn from specific regulations
            const burn1 = tokenUpgradeable.interface.encodeFunctionData("burnFromRegulation", [
                alice.address, ethers.parseUnits("20", 10), REG_US_A
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burn1, [rta1, rta2]);

            const burn2 = tokenUpgradeable.interface.encodeFunctionData("burnFromRegulation", [
                bob.address, ethers.parseUnits("15", 10), REG_US_CF
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burn2, [rta1, rta2]);

            expect(await tokenUpgradeable.totalSupply()).to.equal(ethers.parseUnits("70", 10));
        });

        it("Should handle batch operations with minimal sizes", async function () {
            // Batch mint with just 1 item
            const batchMint = tokenUpgradeable.interface.encodeFunctionData("batchMint", [
                [alice.address],
                [ethers.parseUnits("50", 10)],
                [REG_US_A],
                [issuanceDate1]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, batchMint, [rta1, rta2]);

            // Batch burn with 1 item
            const batchBurn = tokenUpgradeable.interface.encodeFunctionData("batchBurnFrom", [
                [alice.address],
                [ethers.parseUnits("10", 10)],
                [REG_US_A],
                [issuanceDate1]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, batchBurn, [rta1, rta2]);

            // Batch transfer with 1 item
            const batchTransfer = tokenUpgradeable.interface.encodeFunctionData("batchTransferFrom", [
                [alice.address],
                [bob.address],
                [ethers.parseUnits("20", 10)],
                [REG_US_A],
                [issuanceDate1]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, batchTransfer, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseUnits("20", 10));
            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(ethers.parseUnits("20", 10));
        });

        it("Should handle alternating freeze operations", async function () {
            // Mint tokens
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("500", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);

            // Alternate freeze/unfreeze multiple times
            for (let i = 0; i < 5; i++) {
                const freezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [
                    alice.address, true
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, freezeData, [rta1, rta2]);

                const courtOrderData = tokenUpgradeable.interface.encodeFunctionData("controllerTransfer", [
                    alice.address, bob.address, ethers.parseUnits("20", 10),
                    ethers.keccak256(ethers.toUtf8Bytes(`order-${i}`)),
                    ethers.toUtf8Bytes("COURT_ORDER")
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, courtOrderData, [rta1, rta2]);

                const unfreezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [
                    alice.address, false
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, unfreezeData, [rta1, rta2]);
            }

            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(ethers.parseUnits("100", 10));
        });

        it("Should handle multiple small burns across many batches", async function () {
            // Create 25 tiny batches
            for (let i = 0; i < 25; i++) {
                const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                    alice.address, ethers.parseUnits("4", 10), REG_US_A, issuanceDate1 - (i * 50)
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
            }

            // Burn in small increments that cross batches
            for (let i = 0; i < 10; i++) {
                const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFrom", [
                    alice.address, ethers.parseUnits("3", 10)
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);
            }

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseUnits("70", 10));
        });

        it("Should handle complex court order scenarios", async function () {
            // Mint to multiple accounts
            for (const addr of [alice.address, bob.address, carol.address]) {
                const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                    addr, ethers.parseUnits("200", 10), REG_US_A, issuanceDate1
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
            }

            // Execute multiple court orders
            const courtOrders = [
                { from: alice.address, to: bob.address, amount: ethers.parseUnits("50", 10) },
                { from: bob.address, to: carol.address, amount: ethers.parseUnits("75", 10) },
                { from: carol.address, to: alice.address, amount: ethers.parseUnits("100", 10) }
            ];

            for (let i = 0; i < courtOrders.length; i++) {
                const order = courtOrders[i];
                const courtOrderData = tokenUpgradeable.interface.encodeFunctionData("controllerTransfer", [
                    order.from, order.to, order.amount,
                    ethers.keccak256(ethers.toUtf8Bytes(`complex-order-${i}`)),
                    ethers.toUtf8Bytes("COURT_ORDER")
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, courtOrderData, [rta1, rta2]);
            }

            expect(await tokenUpgradeable.totalSupply()).to.equal(ethers.parseUnits("600", 10));
        });
    });
});
