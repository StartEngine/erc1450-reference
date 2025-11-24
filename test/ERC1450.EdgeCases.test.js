const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ERC1450 Edge Cases & Additional Coverage", function () {
    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago
    let ERC1450, token, rtaProxy;
    let owner, issuer, rta, alice, bob, broker;
    let mockERC20;

    beforeEach(async function () {
        [owner, issuer, rta, alice, bob, broker] = await ethers.getSigners();

        // Deploy RTAProxy for multi-sig RTA
        const RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy([rta.address, alice.address, bob.address], 2);
        await rtaProxy.waitForDeployment();

        // Deploy ERC1450 token
        ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy(
            "Test Security Token",
            "TST",
            18,
            issuer.address,
            rta.address
        );
        await token.waitForDeployment();

        // Deploy mock ERC20 for testing token recovery
        const MockERC20 = await ethers.getContractFactory("contracts/mocks/MockERC20.sol:MockERC20");
        mockERC20 = await MockERC20.deploy("Mock Token", "MOCK", 18);
        await mockERC20.waitForDeployment();
    });

    describe("Fee Token Validation", function () {
        it("Should reject transfer request with non-accepted fee token", async function () {
            // Mint tokens first
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            // Set up fee parameters with only ETH accepted
            await token.connect(rta).setFeeParameters(
                0, // flat fee
                ethers.parseUnits("1", 10),
                [ethers.ZeroAddress] // Only ETH accepted
            );

            // Try to request transfer with non-accepted token (mockERC20)
            await expect(
                token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    ethers.parseUnits("100", 10),
                    mockERC20.target, // Using non-accepted token
                    ethers.parseUnits("1", 10)
                )
            ).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
        });

        it("Should accept transfer request with accepted fee token", async function () {
            // Mint tokens first
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            // Set up fee parameters with ETH accepted
            await token.connect(rta).setFeeParameters(
                0, // flat fee
                ethers.parseUnits("1", 10),
                [ethers.ZeroAddress]
            );

            // Request transfer with accepted token (ETH)
            await expect(
                token.connect(alice).requestTransferWithFee(
                    alice.address,
                    bob.address,
                    ethers.parseUnits("100", 10),
                    ethers.ZeroAddress,
                    ethers.parseUnits("1", 10),
                    { value: ethers.parseUnits("1", 10) }
                )
            ).to.emit(token, "TransferRequested");
        });
    });

    describe("Token Recovery", function () {
        it("Should allow RTA to recover accidentally sent ERC20 tokens", async function () {
            // Send some mock tokens to the contract
            const amount = ethers.parseUnits("100", 10);
            await mockERC20.mint(token.target, amount);

            // Verify contract has the tokens
            expect(await mockERC20.balanceOf(token.target)).to.equal(amount);

            // Recover tokens
            const rtaBalanceBefore = await mockERC20.balanceOf(rta.address);
            await token.connect(rta).recoverToken(mockERC20.target, amount);
            const rtaBalanceAfter = await mockERC20.balanceOf(rta.address);

            // Verify tokens were recovered
            expect(rtaBalanceAfter - rtaBalanceBefore).to.equal(amount);
            expect(await mockERC20.balanceOf(token.target)).to.equal(0);
        });

        it("Should not allow non-RTA to recover tokens", async function () {
            const amount = ethers.parseUnits("100", 10);
            await mockERC20.mint(token.target, amount);

            await expect(
                token.connect(alice).recoverToken(mockERC20.target, amount)
            ).to.be.revertedWithCustomError(token, "ERC1450OnlyRTA");
        });
    });

    describe("Interface Support", function () {
        it("Should support ERC1450 interface", async function () {
            expect(await token.supportsInterface("0xaf175dee")).to.be.true;
        });

        it("Should NOT support ERC20 interface (per spec)", async function () {
            const ERC20InterfaceId = "0x36372b07";
            expect(await token.supportsInterface(ERC20InterfaceId)).to.be.false;
        });

        it("Should support ERC165 interface", async function () {
            const ERC165InterfaceId = "0x01ffc9a7";
            expect(await token.supportsInterface(ERC165InterfaceId)).to.be.true;
        });

        it("Should not support unknown interface", async function () {
            const unknownInterfaceId = "0xffffffff";
            expect(await token.supportsInterface(unknownInterfaceId)).to.be.false;
        });
    });

    describe("Account Status Queries", function () {
        it("Should return false for non-frozen account", async function () {
            expect(await token.isAccountFrozen(alice.address)).to.be.false;
        });

        it("Should return true for frozen account", async function () {
            await token.connect(rta).setAccountFrozen(alice.address, true);
            expect(await token.isAccountFrozen(alice.address)).to.be.true;
        });

        it("Should return false for non-broker", async function () {
            expect(await token.isRegisteredBroker(broker.address)).to.be.false;
        });

        it("Should return true for approved broker", async function () {
            await token.connect(rta).setBrokerStatus(broker.address, true);
            expect(await token.isRegisteredBroker(broker.address)).to.be.true;
        });
    });

    describe("Transfer Internal Edge Cases", function () {
        it("Should revert on insufficient balance in internal transfer", async function () {
            // Mint some tokens
            await token.connect(rta).mint(alice.address, ethers.parseUnits("100", 10), REG_US_A, issuanceDate);

            // Try to burn more than balance (will trigger _transfer with insufficient balance)
            await expect(
                token.connect(rta).burnFrom(alice.address, ethers.parseUnits("200", 10))
            ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
        });

        it("Should handle multiple fee token additions and removals", async function () {
            const token1 = ethers.ZeroAddress;
            const token2 = mockERC20.target;

            // Add multiple fee tokens
            await token.connect(rta).setFeeParameters(
                0,
                ethers.parseUnits("1", 10),
                [token1, token2]
            );

            const acceptedTokens = await token.getAcceptedFeeTokens();
            expect(acceptedTokens.length).to.equal(2);
            expect(acceptedTokens[0]).to.equal(token1);
            expect(acceptedTokens[1]).to.equal(token2);

            // Update to different token
            await token.connect(rta).setFeeParameters(
                0,
                ethers.parseUnits("2", 10),
                [token1]
            );

            const updatedTokens = await token.getAcceptedFeeTokens();
            expect(updatedTokens.length).to.equal(1);
            expect(updatedTokens[0]).to.equal(token1);
        });
    });

    describe("Fee Withdrawal Edge Cases", function () {
        it("Should allow withdrawing ERC20 fee tokens", async function () {
            // Setup mock ERC20 as accepted fee token
            await token.connect(rta).setFeeParameters(
                0,
                ethers.parseUnits("1", 10),
                [mockERC20.target]
            );

            // Mint tokens to alice
            await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);

            // Mint fee tokens to alice
            await mockERC20.mint(alice.address, ethers.parseUnits("10", 10));

            // Alice approves token contract to spend fee tokens
            await mockERC20.connect(alice).approve(token.target, ethers.parseUnits("10", 10));

            // Request transfer with ERC20 fee
            await token.connect(alice).requestTransferWithFee(
                alice.address,
                bob.address,
                ethers.parseUnits("100", 10),
                mockERC20.target,
                ethers.parseUnits("1", 10)
            );

            // Check fee collected
            expect(await token.collectedFees(mockERC20.target)).to.equal(ethers.parseUnits("1", 10));

            // Withdraw fee
            const rtaBalanceBefore = await mockERC20.balanceOf(rta.address);
            await token.connect(rta).withdrawFees(
                mockERC20.target,
                ethers.parseUnits("1", 10),
                rta.address
            );
            const rtaBalanceAfter = await mockERC20.balanceOf(rta.address);

            expect(rtaBalanceAfter - rtaBalanceBefore).to.equal(ethers.parseUnits("1", 10));
        });
    });
});
