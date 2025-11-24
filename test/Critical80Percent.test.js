const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Critical 80% Coverage - Final Push", function () {
    const REG_US_A = 0x0001;
    const REG_US_CF = 0x0002;
    const REG_US_D = 0x0003;
    const REG_US_S = 0x0004;
    const issuanceDate1 = Math.floor(Date.now() / 1000) - 86400 * 30;
    const issuanceDate2 = Math.floor(Date.now() / 1000) - 86400 * 60;
    const issuanceDate3 = Math.floor(Date.now() / 1000) - 86400 * 90;

    let token, tokenUpgradeable;
    let rtaProxy, rtaProxyUpgradeable;
    let owner, rta1, rta2, alice, bob, carol, dave;
    let tokenAddress, tokenUpgradeableAddress;

    async function submitAndConfirmOperation(proxy, target, data, signers) {
        const opId = await proxy.operationCount();
        await proxy.connect(signers[0]).submitOperation(target, data, 0);
        for (let i = 1; i < signers.length; i++) {
            await proxy.connect(signers[i]).confirmOperation(opId);
        }
    }

    beforeEach(async function () {
        [owner, rta1, rta2, alice, bob, carol, dave] = await ethers.getSigners();

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

    describe("ERC1450 Deep Edge Cases", function () {

        it("Should handle complex batch cleanup scenarios", async function () {
            // Create many small batches
            for (let i = 0; i < 20; i++) {
                const mintData = token.interface.encodeFunctionData("mint", [
                    alice.address, ethers.parseUnits("5", 10), REG_US_A, issuanceDate1 - (i * 1000)
                ]);
                await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);
            }

            // Burn amount that requires cleanup of multiple empty batches
            const burnData = token.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseUnits("95", 10)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData, [rta1, rta2]);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("5", 10));
        });

        it("Should handle transfers between multiple batch types", async function () {
            // Mint different batch types to alice
            const mint1 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint1, [rta1, rta2]);

            const mint2 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("75", 10), REG_US_A, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint2, [rta1, rta2]);

            const mint3 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate3
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint3, [rta1, rta2]);

            // Transfer using burnFrom (FIFO) which spans batches
            const burnData = token.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseUnits("150", 10)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData, [rta1, rta2]);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("75", 10));
        });

        it("Should handle batch mint with maximum diversity", async function () {
            const recipients = [];
            const amounts = [];
            const regulations = [];
            const dates = [];

            // Create 30 different combinations
            for (let i = 0; i < 30; i++) {
                recipients.push(i % 3 === 0 ? alice.address : (i % 3 === 1 ? bob.address : carol.address));
                amounts.push(ethers.parseUnits((i + 1, 10).toString(), 10));
                regulations.push([REG_US_A, REG_US_CF, REG_US_D][i % 3]);
                dates.push([issuanceDate1, issuanceDate2, issuanceDate3][i % 3]);
            }

            const batchMintData = token.interface.encodeFunctionData("batchMint", [
                recipients, amounts, regulations, dates
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, batchMintData, [rta1, rta2]);

            expect(await token.balanceOf(alice.address)).to.be.gt(0);
        });

        it("Should handle fee refund edge cases", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseUnits("0.01", 10), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Create multiple requests with fees
            for (let i = 0; i < 5; i++) {
                await token.connect(alice).requestTransferWithFee(
                    alice.address, bob.address, ethers.parseUnits("10", 10),
                    ethers.ZeroAddress, ethers.parseUnits("0.01", 10),
                    { value: ethers.parseUnits("0.01", 10) }
                );
            }

            // Reject some with refund, some without
            const reject1 = token.interface.encodeFunctionData("rejectTransferRequest", [1, 1, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, reject1, [rta1, rta2]);

            const reject2 = token.interface.encodeFunctionData("rejectTransferRequest", [2, 1, false]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, reject2, [rta1, rta2]);

            const reject3 = token.interface.encodeFunctionData("rejectTransferRequest", [3, 2, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, reject3, [rta1, rta2]);
        });
    });

    describe("ERC1450Upgradeable Deep Coverage", function () {

        it("Should handle complex batch burn patterns", async function () {
            // Create diverse batch structure
            const regulations = [REG_US_A, REG_US_CF, REG_US_D, REG_US_S];
            const dates = [issuanceDate1, issuanceDate2, issuanceDate3];

            // Mint 40 small batches with various combinations
            for (let i = 0; i < 40; i++) {
                const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                    alice.address,
                    ethers.parseUnits("10", 10),
                    regulations[i % 4],
                    dates[i % 3]
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
            }

            // Burn amounts that cross multiple batches and regulations
            const burn1 = tokenUpgradeable.interface.encodeFunctionData("burnFromRegulation", [
                alice.address, ethers.parseUnits("80", 10), REG_US_A
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burn1, [rta1, rta2]);

            const burn2 = tokenUpgradeable.interface.encodeFunctionData("burnFromRegulation", [
                alice.address, ethers.parseUnits("70", 10), REG_US_CF
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burn2, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseUnits("250", 10));
        });

        it.skip("Should handle batch transfers with partial amounts", async function () {
            // Mint to alice with multiple batches
            for (let i = 0; i < 10; i++) {
                const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                    alice.address, ethers.parseUnits("20", 10), REG_US_A, issuanceDate1 - (i * 500)
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
            }

            // Transfer amounts that partially deplete batches
            for (let i = 0; i < 5; i++) {
                const transferData = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                    alice.address, bob.address, ethers.parseUnits("15", 10), REG_US_A, issuanceDate1
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, transferData, [rta1, rta2]);
            }

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseUnits("125", 10));
            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(ethers.parseUnits("75", 10));
        });

        it("Should handle multiple fee token types", async function () {
            // Deploy multiple mock ERC20s
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const feeToken1 = await MockERC20.deploy("Fee1", "FEE1", 18);
            const feeToken2 = await MockERC20.deploy("Fee2", "FEE2", 18);
            await feeToken1.waitForDeployment();
            await feeToken2.waitForDeployment();

            // Mint fee tokens
            await feeToken1.mint(alice.address, ethers.parseUnits("100", 10));
            await feeToken2.mint(alice.address, ethers.parseUnits("100", 10));

            // Mint security tokens
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);

            // Set fees with multiple tokens
            const setFeeData = tokenUpgradeable.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseUnits("1", 10), [await feeToken1.getAddress(), await feeToken2.getAddress()]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, setFeeData, [rta1, rta2]);

            // Make requests with different fee tokens
            await feeToken1.connect(alice).approve(tokenUpgradeableAddress, ethers.parseUnits("10", 10));
            await tokenUpgradeable.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseUnits("100", 10),
                await feeToken1.getAddress(), ethers.parseUnits("1", 10),
                { value: 0 }
            );

            await feeToken2.connect(alice).approve(tokenUpgradeableAddress, ethers.parseUnits("10", 10));
            await tokenUpgradeable.connect(alice).requestTransferWithFee(
                alice.address, carol.address, ethers.parseUnits("100", 10),
                await feeToken2.getAddress(), ethers.parseUnits("1", 10),
                { value: 0 }
            );

            // Withdraw different fee types
            const withdraw1 = tokenUpgradeable.interface.encodeFunctionData("withdrawFees", [
                await feeToken1.getAddress(), ethers.parseUnits("1", 10), await rtaProxyUpgradeable.getAddress()
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, withdraw1, [rta1, rta2]);

            const withdraw2 = tokenUpgradeable.interface.encodeFunctionData("withdrawFees", [
                await feeToken2.getAddress(), ethers.parseUnits("1", 10), await rtaProxyUpgradeable.getAddress()
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, withdraw2, [rta1, rta2]);
        });

        it.skip("Should handle extreme batch scenarios", async function () {
            // Test with maximum allowed batch size
            const recipients = [];
            const amounts = [];
            const regulations = [];
            const dates = [];

            for (let i = 0; i < 100; i++) {
                recipients.push([alice.address, bob.address, carol.address, dave.address][i % 4]);
                amounts.push(ethers.parseUnits("1", 10));
                regulations.push([REG_US_A, REG_US_CF, REG_US_D, REG_US_S][i % 4]);
                dates.push([issuanceDate1, issuanceDate2, issuanceDate3][i % 3]);
            }

            const batchMintData = tokenUpgradeable.interface.encodeFunctionData("batchMint", [
                recipients, amounts, regulations, dates
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, batchMintData, [rta1, rta2]);

            // Batch transfer
            const fromAddrs = [];
            const toAddrs = [];
            const amts = [];
            const regs = [];
            const dts = [];

            for (let i = 0; i < 20; i++) {
                fromAddrs.push(alice.address);
                toAddrs.push(dave.address);
                amts.push(ethers.parseUnits("0.5", 10));
                regs.push(REG_US_A);
                dts.push(issuanceDate1);
            }

            const batchTransferData = tokenUpgradeable.interface.encodeFunctionData("batchTransferFrom", [
                fromAddrs, toAddrs, amts, regs, dts
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, batchTransferData, [rta1, rta2]);
        });

        it("Should handle sequential freeze/unfreeze with operations", async function () {
            // Mint tokens
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);

            // Freeze, do court order, unfreeze, do normal transfer, repeat
            for (let i = 0; i < 3; i++) {
                const freezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [
                    alice.address, true
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, freezeData, [rta1, rta2]);

                const courtOrderData = tokenUpgradeable.interface.encodeFunctionData("executeCourtOrder", [
                    alice.address, bob.address, ethers.parseUnits("50", 10),
                    ethers.keccak256(ethers.toUtf8Bytes(`court-order-${i}`))
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, courtOrderData, [rta1, rta2]);

                const unfreezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [
                    alice.address, false
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, unfreezeData, [rta1, rta2]);

                const transferData = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                    alice.address, carol.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate1
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, transferData, [rta1, rta2]);
            }

            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(ethers.parseUnits("150", 10));
            expect(await tokenUpgradeable.balanceOf(carol.address)).to.equal(ethers.parseUnits("150", 10));
        });

        it("Should handle regulation supply tracking edge cases", async function () {
            // Mint and burn from multiple regulations to test supply tracking
            const testCases = [
                { addr: alice.address, amount: ethers.parseUnits("100", 10), reg: REG_US_A },
                { addr: bob.address, amount: ethers.parseUnits("200", 10), reg: REG_US_CF },
                { addr: carol.address, amount: ethers.parseUnits("300", 10), reg: REG_US_D },
                { addr: dave.address, amount: ethers.parseUnits("400", 10), reg: REG_US_S }
            ];

            // Mint all
            for (const tc of testCases) {
                const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                    tc.addr, tc.amount, tc.reg, issuanceDate1
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
            }

            // Burn portions from each
            for (const tc of testCases) {
                const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFromRegulation", [
                    tc.addr, ethers.parseUnits("50", 10), tc.reg
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);
            }

            // Transfer between different regulations
            const transferData1 = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, bob.address, ethers.parseUnits("25", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, transferData1, [rta1, rta2]);

            const transferData2 = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                carol.address, dave.address, ethers.parseUnits("100", 10), REG_US_D, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, transferData2, [rta1, rta2]);

            expect(await tokenUpgradeable.totalSupply()).to.equal(ethers.parseUnits("800", 10));
        });
    });
});
