const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Upgradeable Contract Focus - Final 1.5%", function () {
    const REG_US_A = 0x0001;
    const REG_US_CF = 0x0002;
    const REG_US_D = 0x0003;
    const REG_US_S = 0x0004;
    const issuanceDate1 = Math.floor(Date.now() / 1000) - 86400 * 30;
    const issuanceDate2 = Math.floor(Date.now() / 1000) - 86400 * 60;
    const issuanceDate3 = Math.floor(Date.now() / 1000) - 86400 * 90;

    let tokenUpgradeable, rtaProxyUpgradeable;
    let owner, rta1, rta2, alice, bob, carol, dave, eve;
    let tokenUpgradeableAddress;

    async function submitAndConfirmOperation(proxy, target, data, signers) {
        const opId = await proxy.operationCount();
        await proxy.connect(signers[0]).submitOperation(target, data, 0);
        for (let i = 1; i < signers.length; i++) {
            await proxy.connect(signers[i]).confirmOperation(opId);
        }
    }

    beforeEach(async function () {
        [owner, rta1, rta2, alice, bob, carol, dave, eve] = await ethers.getSigners();

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
            ["Security Token Upgradeable", "SECU", 18, owner.address, await rtaProxyUpgradeable.getAddress()],
            { initializer: 'initialize' }
        );
        await tokenUpgradeable.waitForDeployment();
        tokenUpgradeableAddress = await tokenUpgradeable.getAddress();
    });

    describe("ERC1450Upgradeable - Maximum Batch Complexity", function () {

        it("Should handle 100-item batch with maximum regulation diversity", async function () {
            const recipients = [];
            const amounts = [];
            const regulations = [];
            const dates = [];

            // Maximum allowed batch size with full diversity
            for (let i = 0; i < 100; i++) {
                recipients.push([alice.address, bob.address, carol.address, dave.address, eve.address][i % 5]);
                amounts.push(ethers.parseEther(((i % 10) + 1).toString()));
                regulations.push([REG_US_A, REG_US_CF, REG_US_D, REG_US_S][i % 4]);
                dates.push([issuanceDate1, issuanceDate2, issuanceDate3][i % 3]);
            }

            const batchMintData = tokenUpgradeable.interface.encodeFunctionData("batchMint", [
                recipients, amounts, regulations, dates
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, batchMintData, [rta1, rta2]);

            expect(await tokenUpgradeable.totalSupply()).to.be.gt(ethers.parseEther("500"));
        });

        it("Should handle massive batch cleanup with 80 batches", async function () {
            // Create 80 tiny batches
            for (let i = 0; i < 80; i++) {
                const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                    alice.address,
                    ethers.parseEther("1.5"),
                    [REG_US_A, REG_US_CF][i % 2],
                    issuanceDate1 - (i * 25)
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
            }

            // Burn amount that depletes many batches
            const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseEther("115")
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseEther("5"));
        });

        it("Should handle complex cross-regulation batch transfers", async function () {
            // Setup with multiple regulations
            const mintA = tokenUpgradeable.interface.encodeFunctionData("batchMint", [
                [alice.address, alice.address, alice.address],
                [ethers.parseEther("100"), ethers.parseEther("100"), ethers.parseEther("100")],
                [REG_US_A, REG_US_A, REG_US_A],
                [issuanceDate1, issuanceDate2, issuanceDate3]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintA, [rta1, rta2]);

            const mintCF = tokenUpgradeable.interface.encodeFunctionData("batchMint", [
                [alice.address, alice.address, alice.address],
                [ethers.parseEther("80"), ethers.parseEther("80"), ethers.parseEther("80")],
                [REG_US_CF, REG_US_CF, REG_US_CF],
                [issuanceDate1, issuanceDate2, issuanceDate3]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintCF, [rta1, rta2]);

            // Complex batch transfers
            const batchTransfer1 = tokenUpgradeable.interface.encodeFunctionData("batchTransferFrom", [
                [alice.address, alice.address, alice.address, alice.address],
                [bob.address, bob.address, carol.address, carol.address],
                [ethers.parseEther("50"), ethers.parseEther("40"), ethers.parseEther("60"), ethers.parseEther("30")],
                [REG_US_A, REG_US_CF, REG_US_A, REG_US_CF],
                [issuanceDate1, issuanceDate1, issuanceDate2, issuanceDate2]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, batchTransfer1, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(ethers.parseEther("90"));
            expect(await tokenUpgradeable.balanceOf(carol.address)).to.equal(ethers.parseEther("90"));
        });

        it("Should handle repeated regulation-specific burns", async function () {
            // Mint to alice with multiple regulations
            for (let i = 0; i < 30; i++) {
                const reg = [REG_US_A, REG_US_CF, REG_US_D][i % 3];
                const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                    alice.address, ethers.parseEther("8"), reg, issuanceDate1 - (i * 33)
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
            }

            // Repeatedly burn from specific regulations
            for (let i = 0; i < 12; i++) {
                const reg = [REG_US_A, REG_US_CF, REG_US_D][i % 3];
                const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFromRegulation", [
                    alice.address, ethers.parseEther("10"), reg
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);
            }

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseEther("120"));
        });

        it("Should handle address zero error paths in request functions", async function () {
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("1000"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);

            const setFeeData = tokenUpgradeable.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseEther("0.01"), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, setFeeData, [rta1, rta2]);

            // Test address(0) as from
            await expect(
                tokenUpgradeable.connect(alice).requestTransferWithFee(
                    ethers.ZeroAddress, bob.address, ethers.parseEther("100"),
                    ethers.ZeroAddress, ethers.parseEther("0.01"),
                    { value: ethers.parseEther("0.01") }
                )
            ).to.be.reverted;

            // Test address(0) as to
            await expect(
                tokenUpgradeable.connect(alice).requestTransferWithFee(
                    alice.address, ethers.ZeroAddress, ethers.parseEther("100"),
                    ethers.ZeroAddress, ethers.parseEther("0.01"),
                    { value: ethers.parseEther("0.01") }
                )
            ).to.be.reverted;
        });

        it("Should handle multi-cycle freeze operations with varied amounts", async function () {
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("2000"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);

            // 10 freeze/court order/unfreeze/transfer cycles with varying amounts
            for (let i = 0; i < 10; i++) {
                const freezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [alice.address, true]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, freezeData, [rta1, rta2]);

                const amount = ethers.parseEther(((i % 5) + 10).toString());
                const courtOrderData = tokenUpgradeable.interface.encodeFunctionData("executeCourtOrder", [
                    alice.address, bob.address, amount,
                    ethers.keccak256(ethers.toUtf8Bytes(`multicycle-${i}`))
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, courtOrderData, [rta1, rta2]);

                const unfreezeData = tokenUpgradeable.interface.encodeFunctionData("setAccountFrozen", [alice.address, false]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, unfreezeData, [rta1, rta2]);

                const transferAmount = ethers.parseEther(((i % 4) + 5).toString());
                const transferData = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                    alice.address, carol.address, transferAmount, REG_US_A, issuanceDate1
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, transferData, [rta1, rta2]);
            }

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.be.lt(ethers.parseEther("2000"));
        });

        it.skip("Should handle batch operations with all four regulation types", async function () {
            // Mint all regulation types
            const batchMint = tokenUpgradeable.interface.encodeFunctionData("batchMint", [
                [alice.address, alice.address, alice.address, alice.address,
                 bob.address, bob.address, bob.address, bob.address],
                [ethers.parseEther("50"), ethers.parseEther("60"), ethers.parseEther("70"), ethers.parseEther("80"),
                 ethers.parseEther("50"), ethers.parseEther("60"), ethers.parseEther("70"), ethers.parseEther("80")],
                [REG_US_A, REG_US_CF, REG_US_D, REG_US_S, REG_US_A, REG_US_CF, REG_US_D, REG_US_S],
                [issuanceDate1, issuanceDate1, issuanceDate1, issuanceDate1,
                 issuanceDate2, issuanceDate2, issuanceDate2, issuanceDate2]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, batchMint, [rta1, rta2]);

            // Batch burn from all types
            const batchBurn = tokenUpgradeable.interface.encodeFunctionData("batchBurnFrom", [
                [alice.address, alice.address, alice.address, alice.address],
                [ethers.parseEther("10"), ethers.parseEther("15"), ethers.parseEther("20"), ethers.parseEther("25")],
                [REG_US_A, REG_US_CF, REG_US_D, REG_US_S],
                [issuanceDate1, issuanceDate1, issuanceDate1, issuanceDate1]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, batchBurn, [rta1, rta2]);

            // Batch transfer with all types
            const batchTransfer = tokenUpgradeable.interface.encodeFunctionData("batchTransferFrom", [
                [alice.address, alice.address, alice.address, alice.address],
                [carol.address, carol.address, carol.address, carol.address],
                [ethers.parseEther("20"), ethers.parseEther("25"), ethers.parseEther("30"), ethers.parseEther("35")],
                [REG_US_A, REG_US_CF, REG_US_D, REG_US_S],
                [issuanceDate1, issuanceDate1, issuanceDate1, issuanceDate1]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, batchTransfer, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(carol.address)).to.equal(ethers.parseEther("110"));
        });

        it("Should handle extreme transfer request management", async function () {
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("5000"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);

            const setFeeData = tokenUpgradeable.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseEther("0.01"), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, setFeeData, [rta1, rta2]);

            // Create 15 requests
            for (let i = 0; i < 15; i++) {
                await tokenUpgradeable.connect(alice).requestTransferWithFee(
                    alice.address, bob.address, ethers.parseEther("100"),
                    ethers.ZeroAddress, ethers.parseEther("0.01"),
                    { value: ethers.parseEther("0.01") }
                );
            }

            // Process/reject/update in various patterns
            for (let i = 1; i <= 15; i++) {
                if (i % 3 === 0) {
                    const processData = tokenUpgradeable.interface.encodeFunctionData("processTransferRequest", [i, true]);
                    await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, processData, [rta1, rta2]);
                } else if (i % 3 === 1) {
                    const rejectData = tokenUpgradeable.interface.encodeFunctionData("rejectTransferRequest", [i, 1, true]);
                    await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, rejectData, [rta1, rta2]);
                } else {
                    const rejectData = tokenUpgradeable.interface.encodeFunctionData("rejectTransferRequest", [i, 2, false]);
                    await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, rejectData, [rta1, rta2]);
                }
            }

            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(ethers.parseEther("500"));
        });

        it("Should handle deep batch nesting with partial depletes", async function () {
            // Create 60 very small batches with mixed regulations
            for (let i = 0; i < 60; i++) {
                const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                    alice.address,
                    ethers.parseEther("2.5"),
                    [REG_US_A, REG_US_CF, REG_US_D][i % 3],
                    issuanceDate1 - (i * 17)
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
            }

            // Multiple small burns that partially deplete batches
            for (let i = 0; i < 15; i++) {
                const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFrom", [
                    alice.address, ethers.parseEther("3.7")
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);
            }

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseEther("94.5"));
        });
    });
});
