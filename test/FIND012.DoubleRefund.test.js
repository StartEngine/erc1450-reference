const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * FIND-012: Missing request finalization check allows multiple fee refunds
 *
 * These tests verify that rejectTransferRequest() properly prevents
 * double rejection attempts.
 */
describe("FIND-012: Double Rejection Prevention", function () {
    const REG_US_A = 0x0001;
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30;

    let token;
    let rta, alice, bob;
    let feeToken;

    beforeEach(async function () {
        [, rta, , , alice, bob] = await ethers.getSigners();

        // Deploy fee token
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        feeToken = await MockERC20.deploy("Fee Token", "FEE", 6);
        await feeToken.waitForDeployment();

        // Deploy ERC1450 with direct RTA (no proxy for simpler testing)
        const ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy("Test Token", "TST", 10, rta.address, rta.address);
        await token.waitForDeployment();

        // Setup: Mint tokens to alice
        await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

        // Set fee token and flat fee of 100
        await token.connect(rta).setFeeToken(await feeToken.getAddress());
        await token.connect(rta).setFeeParameters(0, 100);

        // Give alice fee tokens and approve
        await feeToken.mint(alice.address, 1000);
        await feeToken.connect(alice).approve(await token.getAddress(), 1000);
    });

    describe("ERC1450 - rejectTransferRequest finalization check", function () {
        it("Should allow single rejection", async function () {
            // Create transfer request with fee
            await token.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseUnits("100", 10), 100
            );

            // Verify fee was collected
            expect(await token.collectedFees()).to.equal(100);

            // Reject - should succeed
            await expect(
                token.connect(rta).rejectTransferRequest(0, 1, true)
            ).to.not.be.reverted;
        });

        it("Should revert on double rejection attempt", async function () {
            // Create transfer request with fee
            await token.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseUnits("100", 10), 100
            );

            // First rejection
            await token.connect(rta).rejectTransferRequest(0, 1, true);

            // Second rejection should fail with "Request already finalized"
            await expect(
                token.connect(rta).rejectTransferRequest(0, 1, true)
            ).to.be.revertedWith("ERC1450: Request already finalized");
        });

        it("Should revert double rejection even without refund flag", async function () {
            // Create transfer request
            await token.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseUnits("100", 10), 100
            );

            // Reject without refund
            await token.connect(rta).rejectTransferRequest(0, 1, false);

            // Try to reject again (even without refund) - should fail
            await expect(
                token.connect(rta).rejectTransferRequest(0, 1, false)
            ).to.be.revertedWith("ERC1450: Request already finalized");
        });

        it("Should revert rejection after request was approved via processTransferRequest(false)", async function () {
            // Create transfer request
            await token.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseUnits("100", 10), 100
            );

            // Reject via processTransferRequest (approved=false)
            await token.connect(rta).processTransferRequest(0, false);

            // Try to reject again - should fail
            await expect(
                token.connect(rta).rejectTransferRequest(0, 1, true)
            ).to.be.revertedWith("ERC1450: Request already finalized");
        });

        it("Should prevent multiple rejections of same request", async function () {
            // Create two transfer requests
            await token.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseUnits("100", 10), 100
            );
            await token.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseUnits("100", 10), 100
            );

            // Reject first request
            await token.connect(rta).rejectTransferRequest(0, 1, true);

            // Try to reject first request again - should fail
            await expect(
                token.connect(rta).rejectTransferRequest(0, 1, true)
            ).to.be.revertedWith("ERC1450: Request already finalized");

            // Should still be able to reject second request
            await expect(
                token.connect(rta).rejectTransferRequest(1, 1, true)
            ).to.not.be.reverted;
        });
    });

    describe("ERC1450Upgradeable - rejectTransferRequest finalization check", function () {
        let tokenUpgradeable;

        beforeEach(async function () {
            const { upgrades } = require("hardhat");

            // Deploy upgradeable version with direct RTA
            const ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
            tokenUpgradeable = await upgrades.deployProxy(
                ERC1450Upgradeable,
                ["Test Token Upgradeable", "TSTU", 10, rta.address, rta.address],
                { kind: "uups" }
            );
            await tokenUpgradeable.waitForDeployment();

            // Setup
            await tokenUpgradeable.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);
            await tokenUpgradeable.connect(rta).setFeeToken(await feeToken.getAddress());
            await tokenUpgradeable.connect(rta).setFeeParameters(0, 100);
            await feeToken.connect(alice).approve(await tokenUpgradeable.getAddress(), 1000);
        });

        it("Should allow single rejection", async function () {
            await tokenUpgradeable.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseUnits("100", 10), 100
            );

            await expect(
                tokenUpgradeable.connect(rta).rejectTransferRequest(0, 1, true)
            ).to.not.be.reverted;
        });

        it("Should revert on double rejection attempt", async function () {
            await tokenUpgradeable.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseUnits("100", 10), 100
            );

            await tokenUpgradeable.connect(rta).rejectTransferRequest(0, 1, true);

            await expect(
                tokenUpgradeable.connect(rta).rejectTransferRequest(0, 1, true)
            ).to.be.revertedWith("ERC1450: Request already finalized");
        });

        it("Should revert double rejection even without refund flag", async function () {
            await tokenUpgradeable.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseUnits("100", 10), 100
            );

            await tokenUpgradeable.connect(rta).rejectTransferRequest(0, 1, false);

            await expect(
                tokenUpgradeable.connect(rta).rejectTransferRequest(0, 1, false)
            ).to.be.revertedWith("ERC1450: Request already finalized");
        });

        it("Should revert rejection after request was approved via processTransferRequest(false)", async function () {
            await tokenUpgradeable.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseUnits("100", 10), 100
            );

            await tokenUpgradeable.connect(rta).processTransferRequest(0, false);

            await expect(
                tokenUpgradeable.connect(rta).rejectTransferRequest(0, 1, true)
            ).to.be.revertedWith("ERC1450: Request already finalized");
        });

        it("Should prevent multiple rejections of same request", async function () {
            await tokenUpgradeable.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseUnits("100", 10), 100
            );
            await tokenUpgradeable.connect(alice).requestTransferWithFee(
                alice.address, bob.address, ethers.parseUnits("100", 10), 100
            );

            await tokenUpgradeable.connect(rta).rejectTransferRequest(0, 1, true);

            await expect(
                tokenUpgradeable.connect(rta).rejectTransferRequest(0, 1, true)
            ).to.be.revertedWith("ERC1450: Request already finalized");

            await expect(
                tokenUpgradeable.connect(rta).rejectTransferRequest(1, 1, true)
            ).to.not.be.reverted;
        });
    });
});
