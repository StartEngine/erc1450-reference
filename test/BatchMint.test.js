const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ERC1450 BatchMint Functionality", function () {
    let token;
    let rtaProxy;
    let owner;
    let rta;
    let alice;
    let bob;
    let charlie;
    let nonRTA;
    let signers;

    // Regulation types
    const REG_A = 1;
    const REG_D = 2;
    const REG_S = 3;
    const REG_CF = 4;

    beforeEach(async function () {
        [owner, rta, alice, bob, charlie, nonRTA, ...signers] = await ethers.getSigners();

        // Deploy ERC1450 token
        const Token = await ethers.getContractFactory("ERC1450");
        token = await Token.deploy(
            "Test Token",
            "TEST",
            18,
            owner.address,
            rta.address // RTA address
        );
        await token.waitForDeployment();
    });

    describe("BatchMint Basic Functionality", function () {
        it("Should successfully batch mint to multiple recipients", async function () {
            const recipients = [alice.address, bob.address, charlie.address];
            const amounts = [
                ethers.parseEther("100"),
                ethers.parseEther("200"),
                ethers.parseEther("300")
            ];
            const regulationTypes = [REG_A, REG_D, REG_A];
            const issuanceDates = [
                Math.floor(Date.now() / 1000) - 86400, // Yesterday
                Math.floor(Date.now() / 1000) - 172800, // 2 days ago
                Math.floor(Date.now() / 1000) - 259200  // 3 days ago
            ];

            await token.connect(rta).batchMint(
                recipients,
                amounts,
                regulationTypes,
                issuanceDates
            );

            // Verify balances
            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("100"));
            expect(await token.balanceOf(bob.address)).to.equal(ethers.parseEther("200"));
            expect(await token.balanceOf(charlie.address)).to.equal(ethers.parseEther("300"));

            // Verify total supply
            expect(await token.totalSupply()).to.equal(ethers.parseEther("600"));
        });

        it("Should emit correct events for each mint in batch", async function () {
            const recipients = [alice.address, bob.address];
            const amounts = [ethers.parseEther("100"), ethers.parseEther("200")];
            const regulationTypes = [REG_A, REG_D];
            const issuanceDate = Math.floor(Date.now() / 1000);
            const issuanceDates = [issuanceDate, issuanceDate];

            const tx = await token.connect(rta).batchMint(
                recipients,
                amounts,
                regulationTypes,
                issuanceDates
            );

            // Check Transfer events
            await expect(tx)
                .to.emit(token, "Transfer")
                .withArgs(ethers.ZeroAddress, alice.address, amounts[0]);
            await expect(tx)
                .to.emit(token, "Transfer")
                .withArgs(ethers.ZeroAddress, bob.address, amounts[1]);

            // Check TokensMinted events
            await expect(tx)
                .to.emit(token, "TokensMinted")
                .withArgs(alice.address, amounts[0], REG_A, issuanceDate, await time.latest());
            await expect(tx)
                .to.emit(token, "TokensMinted")
                .withArgs(bob.address, amounts[1], REG_D, issuanceDate, await time.latest());
        });

        it("Should handle same recipient multiple times in batch", async function () {
            const recipients = [alice.address, alice.address, alice.address];
            const amounts = [
                ethers.parseEther("100"),
                ethers.parseEther("200"),
                ethers.parseEther("300")
            ];
            const regulationTypes = [REG_A, REG_D, REG_A];
            const issuanceDates = [
                Math.floor(Date.now() / 1000),
                Math.floor(Date.now() / 1000) - 86400,
                Math.floor(Date.now() / 1000) - 172800
            ];

            await token.connect(rta).batchMint(
                recipients,
                amounts,
                regulationTypes,
                issuanceDates
            );

            // Alice should receive total of all mints
            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("600"));
        });
    });

    describe("BatchMint Validation", function () {
        it("Should revert if arrays have different lengths", async function () {
            const recipients = [alice.address, bob.address];
            const amounts = [ethers.parseEther("100")]; // Only 1 amount for 2 recipients
            const regulationTypes = [REG_A, REG_D];
            const issuanceDates = [Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000)];

            await expect(
                token.connect(rta).batchMint(recipients, amounts, regulationTypes, issuanceDates)
            ).to.be.revertedWith("ERC1450: Array length mismatch");
        });

        it("Should revert with empty batch", async function () {
            await expect(
                token.connect(rta).batchMint([], [], [], [])
            ).to.be.revertedWith("ERC1450: Empty batch");
        });

        it("Should revert if batch is too large", async function () {
            // Create arrays with 101 elements (over the 100 limit)
            const recipients = new Array(101).fill(alice.address);
            const amounts = new Array(101).fill(ethers.parseEther("1"));
            const regulationTypes = new Array(101).fill(REG_A);
            const issuanceDates = new Array(101).fill(Math.floor(Date.now() / 1000));

            await expect(
                token.connect(rta).batchMint(recipients, amounts, regulationTypes, issuanceDates)
            ).to.be.revertedWith("ERC1450: Batch too large");
        });

        it("Should revert if non-RTA tries to batch mint", async function () {
            const recipients = [alice.address];
            const amounts = [ethers.parseEther("100")];
            const regulationTypes = [REG_A];
            const issuanceDates = [Math.floor(Date.now() / 1000)];

            await expect(
                token.connect(nonRTA).batchMint(recipients, amounts, regulationTypes, issuanceDates)
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");
        });

        it("Should revert if any recipient is zero address", async function () {
            const recipients = [alice.address, ethers.ZeroAddress, bob.address];
            const amounts = [ethers.parseEther("100"), ethers.parseEther("200"), ethers.parseEther("300")];
            const regulationTypes = [REG_A, REG_D, REG_S];
            const issuanceDates = new Array(3).fill(Math.floor(Date.now() / 1000));

            await expect(
                token.connect(rta).batchMint(recipients, amounts, regulationTypes, issuanceDates)
            ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
        });

        it("Should revert if any regulation type is 0", async function () {
            const recipients = [alice.address, bob.address];
            const amounts = [ethers.parseEther("100"), ethers.parseEther("200")];
            const regulationTypes = [REG_A, 0]; // Invalid regulation type
            const issuanceDates = [Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000)];

            await expect(
                token.connect(rta).batchMint(recipients, amounts, regulationTypes, issuanceDates)
            ).to.be.revertedWith("ERC1450: Invalid regulation type");
        });

        it("Should revert if any issuance date is in the future", async function () {
            const recipients = [alice.address, bob.address];
            const amounts = [ethers.parseEther("100"), ethers.parseEther("200")];
            const regulationTypes = [REG_A, REG_D];
            // Use block timestamp to avoid issues with time manipulation in other tests
            const currentBlock = await ethers.provider.getBlock('latest');
            const currentTime = currentBlock.timestamp;
            const futureDate = currentTime + 86400 * 30; // 30 days in future
            const issuanceDates = [currentTime - 86400, futureDate];

            await expect(
                token.connect(rta).batchMint(recipients, amounts, regulationTypes, issuanceDates)
            ).to.be.revertedWith("ERC1450: Future issuance date not allowed");
        });
    });

    describe("BatchMint Regulation Tracking", function () {
        it("Should correctly track regulation types for batch minted tokens", async function () {
            const recipients = [alice.address, bob.address];
            const amounts = [ethers.parseEther("100"), ethers.parseEther("200")];
            const regulationTypes = [REG_A, REG_D];
            const issuanceDates = [
                Math.floor(Date.now() / 1000) - 86400,
                Math.floor(Date.now() / 1000) - 172800
            ];

            await token.connect(rta).batchMint(
                recipients,
                amounts,
                regulationTypes,
                issuanceDates
            );

            // Check regulation supply
            expect(await token.getRegulationSupply(REG_A)).to.equal(ethers.parseEther("100"));
            expect(await token.getRegulationSupply(REG_D)).to.equal(ethers.parseEther("200"));

            // Check holder regulations for Alice
            const aliceRegs = await token.getHolderRegulations(alice.address);
            expect(aliceRegs.regulationTypes[0]).to.equal(REG_A);
            expect(aliceRegs.amounts[0]).to.equal(ethers.parseEther("100"));
            expect(aliceRegs.issuanceDates[0]).to.equal(issuanceDates[0]);

            // Check holder regulations for Bob
            const bobRegs = await token.getHolderRegulations(bob.address);
            expect(bobRegs.regulationTypes[0]).to.equal(REG_D);
            expect(bobRegs.amounts[0]).to.equal(ethers.parseEther("200"));
            expect(bobRegs.issuanceDates[0]).to.equal(issuanceDates[1]);
        });

        it("Should handle mixed regulation types in single batch", async function () {
            const recipients = [alice.address, alice.address, alice.address];
            const amounts = [
                ethers.parseEther("100"),
                ethers.parseEther("200"),
                ethers.parseEther("50")
            ];
            const regulationTypes = [REG_A, REG_D, REG_CF];
            const issuanceDates = [
                Math.floor(Date.now() / 1000) - 259200,
                Math.floor(Date.now() / 1000) - 172800,
                Math.floor(Date.now() / 1000) - 86400
            ];

            await token.connect(rta).batchMint(
                recipients,
                amounts,
                regulationTypes,
                issuanceDates
            );

            // Alice should have tokens under all three regulations
            const aliceRegs = await token.getHolderRegulations(alice.address);
            expect(aliceRegs.regulationTypes).to.have.lengthOf(3);
            expect(aliceRegs.amounts[0]).to.equal(ethers.parseEther("100"));
            expect(aliceRegs.amounts[1]).to.equal(ethers.parseEther("200"));
            expect(aliceRegs.amounts[2]).to.equal(ethers.parseEther("50"));

            // Total balance should be sum of all
            expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("350"));
        });
    });

    describe("BatchMint Gas Optimization", function () {
        it("Should handle maximum batch size efficiently", async function () {
            // Test with 100 mints (the maximum)
            const batchSize = 100;
            const recipients = new Array(batchSize).fill(null).map((_, i) =>
                signers[i % signers.length].address
            );
            const amounts = new Array(batchSize).fill(ethers.parseEther("10"));
            const regulationTypes = new Array(batchSize).fill(null).map((_, i) =>
                (i % 4) + 1 // Cycles through REG_A, REG_D, REG_S, REG_CF
            );
            const currentTime = Math.floor(Date.now() / 1000);
            const issuanceDates = new Array(batchSize).fill(null).map((_, i) =>
                currentTime - (86400 * (batchSize - i)) // Past dates, getting more recent
            );

            const tx = await token.connect(rta).batchMint(
                recipients,
                amounts,
                regulationTypes,
                issuanceDates
            );

            const receipt = await tx.wait();

            // Log gas used for reference
            console.log(`        Gas used for ${batchSize} mints:`, receipt.gasUsed.toString());

            // Verify total supply
            expect(await token.totalSupply()).to.equal(ethers.parseEther("1000"));
        });

        it("Should be more gas efficient than individual mints", async function () {
            const recipients = [alice.address, bob.address, charlie.address];
            const amounts = [ethers.parseEther("100"), ethers.parseEther("200"), ethers.parseEther("300")];
            const regulationTypes = [REG_A, REG_D, REG_S];
            const issuanceDates = new Array(3).fill(Math.floor(Date.now() / 1000));

            // Measure batch mint gas
            const batchTx = await token.connect(rta).batchMint(
                recipients,
                amounts,
                regulationTypes,
                issuanceDates
            );
            const batchReceipt = await batchTx.wait();
            const batchGas = batchReceipt.gasUsed;

            // Deploy fresh token for individual mints
            const Token2 = await ethers.getContractFactory("ERC1450");
            const token2 = await Token2.deploy(
                "Test Token 2",
                "TEST2",
                18,
                owner.address,
                rta.address
            );
            await token2.waitForDeployment();

            // Measure individual mints gas
            let individualGasTotal = 0n;
            for (let i = 0; i < recipients.length; i++) {
                const tx = await token2.connect(rta).mint(
                    recipients[i],
                    amounts[i],
                    regulationTypes[i],
                    issuanceDates[i]
                );
                const receipt = await tx.wait();
                individualGasTotal += receipt.gasUsed;
            }

            console.log(`        Batch mint gas: ${batchGas}`);
            console.log(`        Individual mints gas: ${individualGasTotal}`);
            console.log(`        Gas saved: ${individualGasTotal - batchGas} (${((1n - batchGas * 100n / individualGasTotal)).toString()}%)`);

            // Batch should use less gas than individual mints
            expect(batchGas).to.be.lessThan(individualGasTotal);
        });
    });
});