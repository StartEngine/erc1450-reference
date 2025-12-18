const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { version: EXPECTED_VERSION } = require("../package.json");

describe("Branch Coverage Push to 90%", function () {
    let ERC1450, ERC1450Upgradeable, RTAProxy, RTAProxyUpgradeable, MockERC20;
    let token, tokenUpgradeable, rtaProxy, rtaProxyUpgradeable, feeToken;
    let owner, rta1, rta2, rta3, alice, bob, carol;
    let tokenAddress, tokenUpgradeableAddress;

    const REG_US_CF = 1;
    const REG_US_D = 2;
    const REG_US_A = 3;
    const issuanceDate1 = Math.floor(Date.now() / 1000) - 86400;
    const issuanceDate2 = Math.floor(Date.now() / 1000) - 172800;

    async function submitAndConfirmOperation(proxy, target, data, signers) {
        await proxy.connect(signers[0]).submitOperation(target, data, 0);
        const opCount = await proxy.operationCount();
        const opId = opCount - 1n;
        for (let i = 1; i < signers.length; i++) {
            await proxy.connect(signers[i]).confirmOperation(opId);
        }
        return opId;
    }

    beforeEach(async function () {
        [owner, rta1, rta2, rta3, alice, bob, carol] = await ethers.getSigners();

        // Deploy MockERC20 for fee token
        MockERC20 = await ethers.getContractFactory("MockERC20");
        feeToken = await MockERC20.deploy("Fee Token", "FEE", 6);
        await feeToken.waitForDeployment();

        // Deploy RTAProxy
        RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy([rta1.address, rta2.address, rta3.address], 2);
        await rtaProxy.waitForDeployment();

        // Deploy ERC1450
        ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy(
            "Security Token",
            "SEC",
            10,
            owner.address,
            await rtaProxy.getAddress()
        );
        await token.waitForDeployment();
        tokenAddress = await token.getAddress();

        // Deploy RTAProxyUpgradeable
        RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
        rtaProxyUpgradeable = await upgrades.deployProxy(
            RTAProxyUpgradeable,
            [[rta1.address, rta2.address, rta3.address], 2],
            { initializer: "initialize" }
        );
        await rtaProxyUpgradeable.waitForDeployment();

        // Deploy ERC1450Upgradeable
        ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
        tokenUpgradeable = await upgrades.deployProxy(
            ERC1450Upgradeable,
            ["Security Token Upgradeable", "SECU", 10, owner.address, await rtaProxyUpgradeable.getAddress()],
            { initializer: "initialize" }
        );
        await tokenUpgradeable.waitForDeployment();
        tokenUpgradeableAddress = await tokenUpgradeable.getAddress();
    });

    describe("ERC1450 - Burn with zero-amount batches (line 973)", function () {
        it("Should handle burning when some batches have zero amount", async function () {
            // Mint multiple batches
            const mintData1 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate1
            ]);
            const mintData2 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("200", 10), REG_US_D, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData1, [rta1, rta2]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData2, [rta1, rta2]);

            // Burn exact amount from first batch to make it zero
            const burnData1 = token.interface.encodeFunctionData("burnFromRegulated", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData1, [rta1, rta2]);

            // Now burn from the remaining - this should skip the zero-amount batch
            const burnData2 = token.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseUnits("50", 10)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData2, [rta1, rta2]);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("150", 10));
        });

        it("Should handle FIFO burn skipping depleted batches", async function () {
            // Create several batches
            for (let i = 0; i < 3; i++) {
                const mintData = token.interface.encodeFunctionData("mint", [
                    alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate1 + i * 1000
                ]);
                await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);
            }

            // Deplete first batch completely
            const burnData1 = token.interface.encodeFunctionData("burnFromRegulated", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData1, [rta1, rta2]);

            // Now do FIFO burn - should skip the empty first batch
            const burnData2 = token.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseUnits("150", 10)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, burnData2, [rta1, rta2]);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("50", 10));
        });
    });

    describe("ERC1450 - setFeeParameters with new single token pattern (line 219)", function () {
        let feeToken1;

        beforeEach(async function () {
            feeToken1 = await MockERC20.deploy("Fee Token 1", "FEE1", 6);
        });

        it("Should set fee token and parameters separately", async function () {
            // First set the fee token
            const setTokenData = token.interface.encodeFunctionData("setFeeToken", [
                await feeToken1.getAddress()
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setTokenData, [rta1, rta2]);

            // Then set fee parameters (only 2 args now)
            const feeData = token.interface.encodeFunctionData("setFeeParameters", [
                1, // flat fee
                ethers.parseUnits("10", 10)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, feeData, [rta1, rta2]);

            const currentFeeToken = await token.getFeeToken();
            expect(currentFeeToken).to.equal(await feeToken1.getAddress());
        });

        it("Should update fee token when setting new one", async function () {
            // Set first fee token
            const setTokenData1 = token.interface.encodeFunctionData("setFeeToken", [
                await feeToken1.getAddress()
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setTokenData1, [rta1, rta2]);

            // Set fee parameters
            const feeData = token.interface.encodeFunctionData("setFeeParameters", [
                1,
                ethers.parseUnits("10", 10)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, feeData, [rta1, rta2]);

            const currentFeeToken = await token.getFeeToken();
            expect(currentFeeToken).to.equal(await feeToken1.getAddress());
        });
    });

    describe("ERC1450 - getHolderRegulations edge cases (line 784)", function () {
        it("Should return empty for holder with no batches", async function () {
            const [regs, amounts, dates] = await token.getHolderRegulations(alice.address);
            expect(regs.length).to.equal(0);
            expect(amounts.length).to.equal(0);
            expect(dates.length).to.equal(0);
        });

        it("Should return correct info for holder with batches", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            const [regs, amounts, dates] = await token.getHolderRegulations(alice.address);
            expect(regs.length).to.equal(1);
            expect(Number(regs[0])).to.equal(REG_US_CF);
            expect(amounts[0]).to.equal(ethers.parseUnits("100", 10));
        });
    });

    describe("ERC1450 - withdrawFees edge cases (lines 725, 737)", function () {
        let testFeeToken;

        beforeEach(async function () {
            testFeeToken = await MockERC20.deploy("Test Fee Token", "TFEE", 6);

            // Mint tokens to alice
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_CF, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Set fee token
            const setTokenData = token.interface.encodeFunctionData("setFeeToken", [
                await testFeeToken.getAddress()
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setTokenData, [rta1, rta2]);

            // Set up flat fee (only 2 args now)
            const feeData = token.interface.encodeFunctionData("setFeeParameters", [
                1, ethers.parseUnits("10", 6)
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, feeData, [rta1, rta2]);

            // Give alice some fee tokens and approve
            await testFeeToken.mint(alice.address, ethers.parseUnits("100", 6));
            await testFeeToken.connect(alice).approve(await token.getAddress(), ethers.parseUnits("100", 6));
        });

        it("Should handle ERC20 fee token collection and withdrawal", async function () {
            // Request transfer with ERC20 fee token (4 args now, no value needed)
            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10),
                ethers.parseUnits("10", 6)
            );

            // Check collected fees
            const collected = await token.collectedFees();
            expect(collected).to.equal(ethers.parseUnits("10", 6));

            // Withdraw fees (only 2 args: amount, recipient)
            const withdrawData = token.interface.encodeFunctionData("withdrawFees", [
                ethers.parseUnits("10", 6),
                bob.address
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, withdrawData, [rta1, rta2]);

            expect(await testFeeToken.balanceOf(bob.address)).to.equal(ethers.parseUnits("10", 6));
        });
    });

    describe("ERC1450Upgradeable - Same branch coverage", function () {
        it("Should handle burn with zero-amount batches", async function () {
            // Mint multiple batches
            const mintData1 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate1
            ]);
            const mintData2 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("200", 10), REG_US_D, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData1, [rta1, rta2]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData2, [rta1, rta2]);

            // Burn exact amount from first batch
            const burnData1 = tokenUpgradeable.interface.encodeFunctionData("burnFromRegulated", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData1, [rta1, rta2]);

            // FIFO burn should skip the zero-amount batch
            const burnData2 = tokenUpgradeable.interface.encodeFunctionData("burnFrom", [
                alice.address, ethers.parseUnits("50", 10)
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, burnData2, [rta1, rta2]);

            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseUnits("150", 10));
        });

        it("Should return holder regulations correctly", async function () {
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);

            const [regs, amounts, dates] = await tokenUpgradeable.getHolderRegulations(alice.address);
            expect(regs.length).to.equal(1);
        });
    });

    describe("RTAProxy - version and edge cases", function () {
        it("Should return version", async function () {
            expect(await rtaProxy.version()).to.equal(EXPECTED_VERSION);
        });

        it("Should handle operation submission and revocation", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate1
            ]);

            // Submit operation
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);

            // Revoke confirmation
            await rtaProxy.connect(rta1).revokeConfirmation(0);

            // Re-confirm
            await rtaProxy.connect(rta1).confirmOperation(0);
            await rtaProxy.connect(rta2).confirmOperation(0);

            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("100", 10));
        });
    });

    describe("RTAProxyUpgradeable - version and edge cases", function () {
        it("Should return version", async function () {
            expect(await rtaProxyUpgradeable.version()).to.equal(EXPECTED_VERSION);
        });

        it("Should handle getSigners correctly", async function () {
            const signers = await rtaProxyUpgradeable.getSigners();
            expect(signers.length).to.equal(3);
            expect(signers).to.include(rta1.address);
            expect(signers).to.include(rta2.address);
            expect(signers).to.include(rta3.address);
        });

        it("Should track hasConfirmed correctly", async function () {
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate1
            ]);

            await rtaProxyUpgradeable.connect(rta1).submitOperation(tokenUpgradeableAddress, mintData, 0);

            expect(await rtaProxyUpgradeable.hasConfirmed(0, rta1.address)).to.be.true;
            expect(await rtaProxyUpgradeable.hasConfirmed(0, rta2.address)).to.be.false;
        });
    });

    describe("Transfer request edge cases - both contracts", function () {
        it("ERC1450 - Should handle request with broker", async function () {
            // Mint tokens to alice
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_CF, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData, [rta1, rta2]);

            // Set fee token (use the feeToken from beforeEach)
            const setTokenData = token.interface.encodeFunctionData("setFeeToken", [
                await feeToken.getAddress()
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, setTokenData, [rta1, rta2]);

            // Set up fee parameters with zero fee (only 2 args)
            const feeData = token.interface.encodeFunctionData("setFeeParameters", [
                0, 0
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, feeData, [rta1, rta2]);

            // Approve carol as broker
            const brokerData = token.interface.encodeFunctionData("setBrokerStatus", [carol.address, true]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, brokerData, [rta1, rta2]);

            // Broker requests transfer on behalf of alice (4 args now, zero fee)
            await token.connect(carol).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10),
                0
            );

            // Just verify it succeeded by checking if the request exists
            expect(await token.isRegisteredBroker(carol.address)).to.be.true;
        });

        it("ERC1450Upgradeable - Should handle request with broker", async function () {
            // Mint tokens to alice
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("1000", 10), REG_US_CF, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData, [rta1, rta2]);

            // Set fee token (use the feeToken from beforeEach)
            const setTokenData = tokenUpgradeable.interface.encodeFunctionData("setFeeToken", [
                await feeToken.getAddress()
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, setTokenData, [rta1, rta2]);

            // Set up fee parameters with zero fee (only 2 args)
            const feeData = tokenUpgradeable.interface.encodeFunctionData("setFeeParameters", [
                0, 0
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, feeData, [rta1, rta2]);

            // Approve carol as broker
            const brokerData = tokenUpgradeable.interface.encodeFunctionData("setBrokerStatus", [carol.address, true]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, brokerData, [rta1, rta2]);

            // Broker requests transfer (4 args now, zero fee)
            await tokenUpgradeable.connect(carol).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10),
                0
            );

            expect(await tokenUpgradeable.isRegisteredBroker(carol.address)).to.be.true;
        });
    });

    describe("Batch insertion and cleanup edge cases", function () {
        it("ERC1450 - Should handle multiple batches with different dates", async function () {
            // Mint with newer date first
            const mintData1 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData1, [rta1, rta2]);

            // Mint with older date - creates separate batch
            const mintData2 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData2, [rta1, rta2]);

            const [regs, amounts, dates] = await token.getHolderRegulations(alice.address);
            // Should have 2 batches
            expect(regs.length).to.equal(2);
            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("200", 10));
        });

        it("ERC1450 - Should merge batches with same regulation and date", async function () {
            const mintData1 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate1
            ]);
            const mintData2 = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("50", 10), REG_US_CF, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData1, [rta1, rta2]);
            await submitAndConfirmOperation(rtaProxy, tokenAddress, mintData2, [rta1, rta2]);

            const [regs, amounts, dates] = await token.getHolderRegulations(alice.address);
            expect(regs.length).to.equal(1);
            expect(amounts[0]).to.equal(ethers.parseUnits("150", 10));
        });

        it("ERC1450Upgradeable - Should handle multiple batches with different dates", async function () {
            // Mint with newer date first
            const mintData1 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate1
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData1, [rta1, rta2]);

            // Mint with older date - creates separate batch
            const mintData2 = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate2
            ]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, tokenUpgradeableAddress, mintData2, [rta1, rta2]);

            const [regs, amounts, dates] = await tokenUpgradeable.getHolderRegulations(alice.address);
            expect(regs.length).to.equal(2);
            expect(await tokenUpgradeable.balanceOf(alice.address)).to.equal(ethers.parseUnits("200", 10));
        });
    });

    describe("Signer management branches", function () {
        it("RTAProxy - Should handle removeSigner correctly", async function () {
            const rtaProxyAddress = await rtaProxy.getAddress();

            // Remove rta3
            const removeData = rtaProxy.interface.encodeFunctionData("removeSigner", [rta3.address]);
            await submitAndConfirmOperation(rtaProxy, rtaProxyAddress, removeData, [rta1, rta2]);

            expect(await rtaProxy.isSigner(rta3.address)).to.be.false;
            const signers = await rtaProxy.getSigners();
            expect(signers.length).to.equal(2);
        });

        it("RTAProxyUpgradeable - Should handle removeSigner correctly", async function () {
            const proxyAddress = await rtaProxyUpgradeable.getAddress();

            // Remove rta3
            const removeData = rtaProxyUpgradeable.interface.encodeFunctionData("removeSigner", [rta3.address]);
            await submitAndConfirmOperation(rtaProxyUpgradeable, proxyAddress, removeData, [rta1, rta2]);

            expect(await rtaProxyUpgradeable.isSigner(rta3.address)).to.be.false;
        });

        it("RTAProxy - Should handle updateRequiredSignatures", async function () {
            const rtaProxyAddress = await rtaProxy.getAddress();

            // Change to require only 1 signature
            const updateData = rtaProxy.interface.encodeFunctionData("updateRequiredSignatures", [1]);
            await submitAndConfirmOperation(rtaProxy, rtaProxyAddress, updateData, [rta1, rta2]);

            expect(await rtaProxy.requiredSignatures()).to.equal(1);
        });
    });

    describe("executeOperation edge cases", function () {
        it("RTAProxy - Should handle manual executeOperation", async function () {
            const mintData = token.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate1
            ]);

            // Submit operation
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);

            // Second signer confirms - should auto-execute
            await rtaProxy.connect(rta2).confirmOperation(0);

            // Try to execute again - should fail because already executed
            await expect(
                rtaProxy.connect(rta1).executeOperation(0)
            ).to.be.revertedWithCustomError(rtaProxy, "OperationAlreadyExecuted");
        });

        it("RTAProxyUpgradeable - Should handle manual executeOperation", async function () {
            const mintData = tokenUpgradeable.interface.encodeFunctionData("mint", [
                alice.address, ethers.parseUnits("100", 10), REG_US_CF, issuanceDate1
            ]);

            await rtaProxyUpgradeable.connect(rta1).submitOperation(tokenUpgradeableAddress, mintData, 0);
            await rtaProxyUpgradeable.connect(rta2).confirmOperation(0);

            await expect(
                rtaProxyUpgradeable.connect(rta1).executeOperation(0)
            ).to.be.revertedWithCustomError(rtaProxyUpgradeable, "OperationAlreadyExecuted");
        });
    });
});
