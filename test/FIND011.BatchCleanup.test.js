const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

/**
 * FIND-011: Inconsistent batch cleanup during burns
 *
 * These tests verify that empty batches are properly cleaned up after burns
 * in burnFromRegulation() and _burnTokens() (via burnFrom).
 */
describe("FIND-011: Batch Cleanup During Burns", function () {
    const REG_US_A = 0x0001;
    const REG_US_CF = 0x0002;
    const REG_US_D = 0x0003;
    const issuanceDate1 = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago
    const issuanceDate2 = Math.floor(Date.now() / 1000) - 86400 * 60; // 60 days ago
    const issuanceDate3 = Math.floor(Date.now() / 1000) - 86400 * 90; // 90 days ago

    let ERC1450, token, tokenAddress;
    let ERC1450Upgradeable, tokenUpgradeable, tokenUpgradeableAddress;
    let RTAProxy, rtaProxy;
    let RTAProxyUpgradeable, rtaProxyUpgradeable, rtaProxyUpgradeableAddress;
    let owner, rta1, rta2, rta3, alice, bob;

    async function submitAndConfirmOperation(proxy, target, data, signers) {
        const tx = await proxy.connect(signers[0]).submitOperation(target, data, 0);
        const receipt = await tx.wait();
        const event = receipt.logs.find(log => {
            try {
                const parsed = proxy.interface.parseLog(log);
                return parsed && parsed.name === "OperationSubmitted";
            } catch {
                return false;
            }
        });
        const opId = event ? proxy.interface.parseLog(event).args.operationId : 0;

        if (signers[1]) {
            await proxy.connect(signers[1]).confirmOperation(opId);
        }
        return opId;
    }

    beforeEach(async function () {
        [owner, rta1, rta2, rta3, alice, bob] = await ethers.getSigners();

        // Deploy RTAProxy
        RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy([rta1.address, rta2.address, rta3.address], 2);
        await rtaProxy.waitForDeployment();

        // Deploy ERC1450
        ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy("Test Token", "TST", 10, owner.address, rtaProxy.target);
        await token.waitForDeployment();
        tokenAddress = await token.getAddress();

        // Deploy upgradeable versions
        RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
        rtaProxyUpgradeable = await upgrades.deployProxy(
            RTAProxyUpgradeable,
            [[rta1.address, rta2.address, rta3.address], 2],
            { kind: "uups" }
        );
        await rtaProxyUpgradeable.waitForDeployment();
        rtaProxyUpgradeableAddress = await rtaProxyUpgradeable.getAddress();

        ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
        tokenUpgradeable = await upgrades.deployProxy(
            ERC1450Upgradeable,
            ["Test Token Upgradeable", "TSTU", 10, owner.address, rtaProxyUpgradeableAddress],
            { kind: "uups" }
        );
        await tokenUpgradeable.waitForDeployment();
        tokenUpgradeableAddress = await tokenUpgradeable.getAddress();
    });

    describe("ERC1450 - burnFromRegulation batch cleanup", function () {
        it("Should remove batch when burnFromRegulation empties it completely", async function () {
            // Mint two batches with different regulations
            const mint1 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint1, [rta1, rta2]);

            const mint2 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("200", 10), REG_US_CF, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint2, [rta1, rta2]);

            // Verify 2 batches exist
            let batchInfo = await token.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(2);

            // Burn entire REG_US_A batch using burnFromRegulation
            const burnData = token.interface.encodeFunctionData("burnFromRegulation", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData, [rta1, rta2]);

            // Verify batch was cleaned up - should only have 1 batch now
            batchInfo = await token.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(1);
            expect(batchInfo.regulationTypes[0]).to.equal(REG_US_CF);
            expect(batchInfo.amounts[0]).to.equal(ethers.parseUnits("200", 10));
        });

        it("Should remove multiple batches when burnFromRegulation empties them", async function () {
            // Mint 3 batches of same regulation with different dates
            const mint1 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint1, [rta1, rta2]);

            const mint2 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint2, [rta1, rta2]);

            const mint3 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate3
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint3, [rta1, rta2]);

            // Verify 3 batches exist
            let batchInfo = await token.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(3);

            // Burn all REG_US_A tokens (spans 2 batches)
            const burnData = token.interface.encodeFunctionData("burnFromRegulation", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData, [rta1, rta2]);

            // Verify both REG_US_A batches were cleaned up
            batchInfo = await token.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(1);
            expect(batchInfo.regulationTypes[0]).to.equal(REG_US_CF);
        });

        it("Should NOT remove batch when burnFromRegulation only partially burns it", async function () {
            // Mint a batch
            const mint1 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint1, [rta1, rta2]);

            // Verify 1 batch exists
            let batchInfo = await token.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(1);

            // Burn only part of the batch
            const burnData = token.interface.encodeFunctionData("burnFromRegulation", [
                alice.address, ethers.parseUnits("60", 10), REG_US_A
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData, [rta1, rta2]);

            // Batch should still exist with reduced amount
            batchInfo = await token.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(1);
            expect(batchInfo.amounts[0]).to.equal(ethers.parseUnits("40", 10));
        });
    });

    describe("ERC1450 - burnFrom (FIFO via _burnTokens) batch cleanup", function () {
        it("Should remove batch when burnFrom empties it completely", async function () {
            // Mint two batches
            const mint1 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint1, [rta1, rta2]);

            const mint2 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("200", 10), REG_US_CF, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint2, [rta1, rta2]);

            // Verify 2 batches
            let batchInfo = await token.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(2);

            // FIFO burn exactly the first batch
            const burnData = token.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseUnits("100", 10)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData, [rta1, rta2]);

            // First batch should be cleaned up
            batchInfo = await token.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(1);
            expect(batchInfo.regulationTypes[0]).to.equal(REG_US_CF);
        });

        it("Should remove multiple batches when burnFrom spans and empties them", async function () {
            // Mint 3 small batches
            const mint1 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("30", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint1, [rta1, rta2]);

            const mint2 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("40", 10), REG_US_CF, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint2, [rta1, rta2]);

            const mint3 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("50", 10), REG_US_D, issuanceDate3
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint3, [rta1, rta2]);

            // Verify 3 batches
            let batchInfo = await token.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(3);

            // FIFO burn 70 tokens (empties first batch 30, empties second batch 40)
            const burnData = token.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseUnits("70", 10)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData, [rta1, rta2]);

            // Both emptied batches should be cleaned up
            batchInfo = await token.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(1);
            expect(batchInfo.regulationTypes[0]).to.equal(REG_US_D);
            expect(batchInfo.amounts[0]).to.equal(ethers.parseUnits("50", 10));
        });

        it("Should handle burnFrom that partially burns last touched batch", async function () {
            // Mint 2 batches
            const mint1 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint1, [rta1, rta2]);

            const mint2 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mint2, [rta1, rta2]);

            // FIFO burn 80 tokens (empties first 50, partial second 30)
            const burnData = token.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseUnits("80", 10)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData, [rta1, rta2]);

            // First batch cleaned up, second remains with partial amount
            const batchInfo = await token.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(1);
            expect(batchInfo.regulationTypes[0]).to.equal(REG_US_CF);
            expect(batchInfo.amounts[0]).to.equal(ethers.parseUnits("70", 10));
        });

        it("Should cleanup all batches when burnFrom burns entire balance", async function () {
            // Mint multiple batches
            for (let i = 0; i < 5; i++) {
                const mintData = token.interface.encodeFunctionData("mint", [
                    alice.address, ethers.parseUnits("20", 10), REG_US_A, issuanceDate1 - (i * 1000)
                ]);
                await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);
            }

            // Verify 5 batches
            let batchInfo = await token.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(5);

            // Burn entire balance
            const burnData = token.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseUnits("100", 10)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData, [rta1, rta2]);

            // All batches should be cleaned up
            batchInfo = await token.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(0);
            expect(await token.balanceOf(alice.address)).to.equal(0);
        });
    });

    describe("ERC1450Upgradeable - burnFromRegulation batch cleanup", function () {
        it("Should remove batch when burnFromRegulation empties it completely", async function () {
            // Mint two batches with different regulations
            const mint1 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mint1, [rta1, rta2]);

            const mint2 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("200", 10), REG_US_CF, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mint2, [rta1, rta2]);

            // Verify 2 batches exist
            let batchInfo = await tokenUpgradeable.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(2);

            // Burn entire REG_US_A batch
            const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFromRegulation", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);

            // Verify batch was cleaned up
            batchInfo = await tokenUpgradeable.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(1);
            expect(batchInfo.regulationTypes[0]).to.equal(REG_US_CF);
        });

        it("Should remove multiple batches when burnFromRegulation empties them", async function () {
            // Mint 3 batches of same regulation with different dates
            const mint1 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mint1, [rta1, rta2]);

            const mint2 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("50", 10), REG_US_A, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mint2, [rta1, rta2]);

            const mint3 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate3
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mint3, [rta1, rta2]);

            // Burn all REG_US_A tokens
            const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFromRegulation", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);

            // Verify both REG_US_A batches were cleaned up
            const batchInfo = await tokenUpgradeable.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(1);
            expect(batchInfo.regulationTypes[0]).to.equal(REG_US_CF);
        });

        it("Should NOT remove batch when burnFromRegulation only partially burns it", async function () {
            const mint1 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mint1, [rta1, rta2]);

            // Partial burn
            const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFromRegulation", [
                alice.address, ethers.parseUnits("60", 10), REG_US_A
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);

            // Batch should still exist
            const batchInfo = await tokenUpgradeable.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(1);
            expect(batchInfo.amounts[0]).to.equal(ethers.parseUnits("40", 10));
        });
    });

    describe("ERC1450Upgradeable - burnFrom (FIFO via _burnTokens) batch cleanup", function () {
        it("Should remove batch when burnFrom empties it completely", async function () {
            const mint1 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mint1, [rta1, rta2]);

            const mint2 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("200", 10), REG_US_CF, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mint2, [rta1, rta2]);

            // FIFO burn exactly the first batch
            const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseUnits("100", 10)
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);

            const batchInfo = await tokenUpgradeable.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(1);
            expect(batchInfo.regulationTypes[0]).to.equal(REG_US_CF);
        });

        it("Should remove multiple batches when burnFrom spans and empties them", async function () {
            // Mint 3 small batches
            const mint1 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("30", 10), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mint1, [rta1, rta2]);

            const mint2 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("40", 10), REG_US_CF, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mint2, [rta1, rta2]);

            const mint3 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("50", 10), REG_US_D, issuanceDate3
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mint3, [rta1, rta2]);

            // FIFO burn 70 tokens
            const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseUnits("70", 10)
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);

            const batchInfo = await tokenUpgradeable.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(1);
            expect(batchInfo.regulationTypes[0]).to.equal(REG_US_D);
            expect(batchInfo.amounts[0]).to.equal(ethers.parseUnits("50", 10));
        });

        it("Should cleanup all batches when burnFrom burns entire balance", async function () {
            // Mint multiple batches
            for (let i = 0; i < 5; i++) {
                const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                    alice.address, ethers.parseUnits("20", 10), REG_US_A, issuanceDate1 - (i * 1000)
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
            }

            // Burn entire balance
            const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseUnits("100", 10)
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);

            const batchInfo = await tokenUpgradeable.getDetailedBatchInfo(alice.address);
            expect(batchInfo.count).to.equal(0);
            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(0);
        });
    });
});
