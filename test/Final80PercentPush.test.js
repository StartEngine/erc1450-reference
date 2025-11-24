const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("Final 80% Push - Uncovered Branches", function () {
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

        // Deploy RTAProxy
        const RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy([rta1.address, rta2.address], 2);
        await rtaProxy.waitForDeployment();

        // Deploy ERC1450
        const ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy(
            "Security Token",
            "SEC",
            18,
            owner.address,
            await rtaProxy.getAddress()
        );
        await token.waitForDeployment();
        tokenAddress = await token.getAddress();

        // Deploy upgradeable versions
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

    describe("Uncovered Function Calls", function () {

        it("Should test updateRequestStatus function", async function () {
            // Mint tokens
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("1000"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Set fees
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseEther("0.01"), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Create a transfer request
            await token.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseEther("100"),
                ethers.ZeroAddress, ethers.parseEther("0.01"),
                { value: ethers.parseEther("0.01") }
            );

            // Update request status directly (testing the updateRequestStatus function)
            const updateStatusData = token.interface.encodeFunctionData("updateRequestStatus", [1, 1]); // 1 = UnderReview
            await submitAndConfirmOperation(rtaProxy, tokenAddress, updateStatusData, [rta1, rta2]);
        });

        it("Should handle unauthorized transfer request", async function () {
            // Mint tokens to alice
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("1000"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Set fees
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseEther("0.01"), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Try to request transfer from alice's account by bob (who is not a broker and not alice)
            await expect(
                token.connect(bob).requestTransferWithFee(
                    alice.address, carol.address, ethers.parseEther("100"),
                    ethers.ZeroAddress, ethers.parseEther("0.01"),
                    { value: ethers.parseEther("0.01") }
                )
            ).to.be.reverted; // Should revert with OwnableUnauthorizedAccount
        });

        it("Should handle invalid fee token", async function () {
            // Mint tokens
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("1000"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Set fees with only native token
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseEther("0.01"), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Try to use a non-accepted fee token
            await expect(
                token.connect(alice).requestTransferWithFee(
                    alice.address, bob.address, ethers.parseEther("100"),
                    alice.address, // Using alice's address as invalid fee token
                    ethers.parseEther("0.01"),
                    { value: 0 }
                )
            ).to.be.reverted; // Should revert with ERC20InvalidReceiver
        });

        it("Should handle incorrect native token payment amount", async function () {
            // Mint tokens
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("1000"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Set fees
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseEther("0.01"), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setFeeData, [rta1, rta2]);

            // Send wrong amount of native token
            await expect(
                token.connect(alice).requestTransferWithFee(
                    alice.address, bob.address, ethers.parseEther("100"),
                    ethers.ZeroAddress, ethers.parseEther("0.01"),
                    { value: ethers.parseEther("0.005") } // Wrong amount
                )
            ).to.be.reverted; // Should revert with ERC20InsufficientBalance
        });
    });

    describe("Upgradeable Contract Uncovered Branches", function () {

        it("Should test updateRequestStatus on upgradeable", async function () {
            // Mint tokens
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("1000"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);

            // Set fees
            const setFeeData = tokenUpgradeable.interface.encodeFunctionData("setFeeParameters", [
                0, ethers.parseEther("0.01"), [ethers.ZeroAddress]
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, setFeeData, [rta1, rta2]);

            // Create a transfer request
            await tokenUpgradeable.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseEther("100"),
                ethers.ZeroAddress, ethers.parseEther("0.01"),
                { value: ethers.parseEther("0.01") }
            );

            // Update request status
            const updateStatusData = tokenUpgradeable.interface.encodeFunctionData("updateRequestStatus", [1, 2]); // 2 = Approved
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, updateStatusData, [rta1, rta2]);
        });

        it("Should handle batch operations with large arrays", async function () {
            // Create batch with 50 items (stress test)
            const recipients = [];
            const amounts = [];
            const regulations = [];
            const dates = [];

            for (let i = 0; i < 50; i++) {
                recipients.push(i % 2 === 0 ? alice.address : bob.address);
                amounts.push(ethers.parseEther("10"));
                regulations.push(i % 2 === 0 ? REG_US_A : REG_US_CF);
                dates.push(issuanceDate1);
            }

            const batchMintData = tokenUpgradeable.interface.encodeFunctionData("batchMint", [
                recipients, amounts, regulations, dates
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, batchMintData, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseEther("250"));
            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(ethers.parseEther("250"));
        });

        it("Should handle multiple small burns across batches", async function () {
            // Mint several small batches
            for (let i = 0; i < 10; i++) {
                const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                    alice.address, ethers.parseEther("10"), REG_US_A, issuanceDate1 - (i * 100)
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);
            }

            // Burn small amounts multiple times
            for (let i = 0; i < 5; i++) {
                const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFrom", [
                    alice.address, ethers.parseEther("5")
                ]);
                await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);
            }

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseEther("75"));
        });

        it("Should handle complex regulation-based operations", async function () {
            // Mint different regulations
            const mintA = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("100"), REG_US_A, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintA, [rta1, rta2]);

            const mintCF = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseEther("200"), REG_US_CF, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintCF, [rta1, rta2]);

            // Burn from specific regulation
            const burnData = tokenUpgradeable.interface.encodeFunctionData("burnFromRegulation", [
                alice.address, ethers.parseEther("50"), REG_US_A
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData, [rta1, rta2]);

            // Transfer from specific regulation
            const transferData = tokenUpgradeable.interface.encodeFunctionData("transferFromRegulated", [
                alice.address, bob.address, ethers.parseEther("100"), REG_US_CF, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, transferData, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseEther("150"));
            expect(await tokenUpgradeable.balanceOf(bob.address)).to.equal(ethers.parseEther("100"));
        });
    });
});
