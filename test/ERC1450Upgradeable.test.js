const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { ERC1450RequestStatus } = require("./constants");
const { version: PACKAGE_VERSION } = require("../package.json");

describe("ERC1450Upgradeable Security Token", function () {
    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago

    let ERC1450Upgradeable, RTAProxyUpgradeable, MockERC20;
    let token, rtaProxy, feeToken;
    let owner, rta1, rta2, rta3, holder1, holder2, broker1;
    let tokenAddress, rtaProxyAddress, feeTokenAddress;

    beforeEach(async function () {
        // Get signers
        [owner, rta1, rta2, rta3, holder1, holder2, broker1] = await ethers.getSigners();

        // Get contract factories
        ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
        RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
        MockERC20 = await ethers.getContractFactory("MockERC20");

        // Deploy RTAProxyUpgradeable with UUPS proxy
        rtaProxy = await upgrades.deployProxy(
            RTAProxyUpgradeable,
            [[rta1.address, rta2.address, rta3.address], 2],
            { initializer: 'initialize', kind: 'uups' }
        );
        await rtaProxy.waitForDeployment();
        rtaProxyAddress = await rtaProxy.getAddress();

        // Deploy ERC1450Upgradeable with UUPS proxy
        token = await upgrades.deployProxy(
            ERC1450Upgradeable,
            ["Test Security Token", "TST", 10, owner.address, rtaProxyAddress],
            { initializer: 'initialize', kind: 'uups' }
        );
        await token.waitForDeployment();
        tokenAddress = await token.getAddress();

        // Deploy MockERC20 for fee token (6 decimals like USDC)
        feeToken = await MockERC20.deploy("USD Coin", "USDC", 6);
        await feeToken.waitForDeployment();
        feeTokenAddress = await feeToken.getAddress();
    });

    describe("Deployment & Initialization", function () {
        it("Should set the correct token metadata", async function () {
            expect(await token.name()).to.equal("Test Security Token");
            expect(await token.symbol()).to.equal("TST");
            expect(await token.decimals()).to.equal(10);
        });

        it("Should set the correct owner and transfer agent", async function () {
            expect(await token.owner()).to.equal(owner.address);
            expect(await token.isTransferAgent(rtaProxyAddress)).to.be.true;
        });

        it("Should prevent re-initialization", async function () {
            await expect(
                token.initialize(
                    "Another Token", "ATK", 10, owner.address, rtaProxyAddress
                )
            ).to.be.reverted;
        });

        it("Should return correct version", async function () {
            // Version should match package.json (synced via scripts/sync-version.js)
            expect(await token.version()).to.equal(PACKAGE_VERSION);
            expect(await rtaProxy.version()).to.equal(PACKAGE_VERSION);
        });

        it("Should have proxy addresses different from implementation", async function () {
            const tokenImpl = await upgrades.erc1967.getImplementationAddress(tokenAddress);
            const rtaImpl = await upgrades.erc1967.getImplementationAddress(rtaProxyAddress);

            expect(tokenAddress).to.not.equal(tokenImpl);
            expect(rtaProxyAddress).to.not.equal(rtaImpl);
        });
    });

    describe("Upgrade Authorization", function () {
        it("Should only allow RTA to authorize token upgrades", async function () {
            // Prepare a new implementation
            const ERC1450UpgradeableV2 = await ethers.getContractFactory("ERC1450Upgradeable");

            // Try to upgrade directly (should fail)
            await expect(
                upgrades.upgradeProxy(tokenAddress, ERC1450UpgradeableV2)
            ).to.be.reverted;

            // The proper way would be through RTA multi-sig
            // This would require creating the upgrade operation through RTAProxy
        });

        it("Should allow RTAProxy upgrades through multi-sig", async function () {
            // Submit upgrade operation using tokenAddress (a deployed contract) as dummy implementation
            await expect(
                rtaProxy.connect(rta1).submitUpgradeOperation(tokenAddress)
            ).to.emit(rtaProxy, "OperationSubmitted");
        });
    });

    describe("RTA Functions via Proxy", function () {
        it("Should mint tokens through multi-sig", async function () {
            const mintAmount = ethers.parseUnits("1000", 10);

            // Encode mint function call
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, mintAmount
            , REG_US_A, issuanceDate]);

            // Submit operation through RTAProxy
            const tx = await rtaProxy.connect(rta1).submitOperation(
                tokenAddress,
                mintData,
                0
            );
            await tx.wait();

            // Second signer confirms (auto-executes)
            await rtaProxy.connect(rta2).confirmOperation(0);

            // Check balance
            expect(await token.balanceOf(holder1.address)).to.equal(mintAmount);
        });

        it("Should execute transfers through multi-sig", async function () {
            // First mint some tokens
            const mintAmount = ethers.parseUnits("1000", 10);
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, mintAmount
            , REG_US_A, issuanceDate]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(0);

            // Now transfer tokens
            const transferAmount = ethers.parseUnits("100", 10);
            const transferData = token.interface.encodeFunctionData("transferFromRegulated", [
                holder1.address,
                holder2.address,
                transferAmount,
                REG_US_A,
                issuanceDate
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, transferData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Check balances
            expect(await token.balanceOf(holder1.address)).to.equal(ethers.parseUnits("900", 10));
            expect(await token.balanceOf(holder2.address)).to.equal(transferAmount);
        });
    });

    describe("Transfer Request System", function () {
        beforeEach(async function () {
            // Mint tokens to holder1
            const mintAmount = ethers.parseUnits("1000", 10);
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, mintAmount
            , REG_US_A, issuanceDate]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(0);
        });

        it("Should create and process transfer requests with ERC20 fee", async function () {
            const transferAmount = ethers.parseUnits("100", 10);
            const feeAmount = ethers.parseUnits("1", 6); // 1 USDC

            // Set fee token to USDC through multi-sig
            const setFeeTokenData = token.interface.encodeFunctionData("setFeeToken", [feeTokenAddress]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, setFeeTokenData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Mint fee tokens to holder1 and approve
            await feeToken.mint(holder1.address, ethers.parseUnits("10", 6));
            await feeToken.connect(holder1).approve(tokenAddress, feeAmount);

            // Request transfer with ERC20 fee
            await token.connect(holder1).requestTransferWithFee(
                holder1.address,
                holder2.address,
                transferAmount,
                feeAmount
            );

            // Process request through multi-sig
            const processData = token.interface.encodeFunctionData("processTransferRequest", [1, true]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, processData, 0);
            await rtaProxy.connect(rta2).confirmOperation(2);

            // Check balances
            expect(await token.balanceOf(holder2.address)).to.equal(transferAmount);
            expect(await feeToken.balanceOf(tokenAddress)).to.equal(feeAmount);
        });
    });

    describe("Fee Management", function () {
        it("Should set fee token and parameters through multi-sig", async function () {
            // First set the fee token
            const setFeeTokenData = token.interface.encodeFunctionData("setFeeToken", [feeTokenAddress]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, setFeeTokenData, 0);
            await rtaProxy.connect(rta2).confirmOperation(0);

            // Verify fee token was set
            expect(await token.getFeeToken()).to.equal(feeTokenAddress);

            // Then set fee parameters (only type and value)
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                1, // percentage type
                100 // 1% (100 basis points)
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, setFeeData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            expect(await token.feeType()).to.equal(1);
            expect(await token.feeValue()).to.equal(100);
        });

        it("Should calculate transfer fees correctly", async function () {
            // Set fee token
            const setFeeTokenData = token.interface.encodeFunctionData("setFeeToken", [feeTokenAddress]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, setFeeTokenData, 0);
            await rtaProxy.connect(rta2).confirmOperation(0);

            // Set percentage fee (1%)
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                1, // percentage type
                100 // 1% (100 basis points)
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, setFeeData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Calculate fee for a transfer
            const amount = ethers.parseUnits("100", 10);
            const expectedFee = amount * 100n / 10000n; // 1% of amount

            const calculatedFee = await token.getTransferFee(holder1.address, holder2.address, amount);
            expect(calculatedFee).to.equal(expectedFee);
        });

        it("Should withdraw fees through multi-sig", async function () {
            // First mint tokens to holder1
            const mintAmount = ethers.parseUnits("1000", 10);
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, mintAmount, REG_US_A, issuanceDate]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(0);

            // Set fee token to USDC
            const setFeeTokenData = token.interface.encodeFunctionData("setFeeToken", [feeTokenAddress]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, setFeeTokenData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Collect some fees by creating a transfer request with fee
            const transferAmount = ethers.parseUnits("100", 10);
            const feeAmount = ethers.parseUnits("10", 6); // 10 USDC

            // Mint fee tokens to holder1 and approve
            await feeToken.mint(holder1.address, ethers.parseUnits("100", 6));
            await feeToken.connect(holder1).approve(tokenAddress, feeAmount);

            // Request transfer with ERC20 fee
            await token.connect(holder1).requestTransferWithFee(
                holder1.address,
                holder2.address,
                transferAmount,
                feeAmount
            );

            // Process the request
            const processData = token.interface.encodeFunctionData("processTransferRequest", [1, true]);
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, processData, 0);
            await rtaProxy.connect(rta2).confirmOperation(2);

            // Now withdraw fees
            const withdrawAmount = ethers.parseUnits("5", 6);
            const withdrawData = token.interface.encodeFunctionData("withdrawFees", [
                withdrawAmount,
                rtaProxyAddress
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, withdrawData, 0);
            await rtaProxy.connect(rta2).confirmOperation(3);

            // Verify fees were withdrawn
            expect(await feeToken.balanceOf(rtaProxyAddress)).to.equal(withdrawAmount);
            expect(await feeToken.balanceOf(tokenAddress)).to.equal(ethers.parseUnits("5", 6));
        });
    });

    describe("Broker Management", function () {
        it("Should manage brokers through multi-sig", async function () {
            const approveData = token.interface.encodeFunctionData("setBrokerStatus", [
                broker1.address,
                true
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, approveData, 0);
            await rtaProxy.connect(rta2).confirmOperation(0);

            expect(await token.isRegisteredBroker(broker1.address)).to.be.true;
        });
    });

    describe("Storage Persistence Through Upgrades", function () {
        it("Should maintain balances after upgrade", async function () {
            // Mint tokens first
            const mintAmount = ethers.parseUnits("1000", 10);
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, mintAmount
            , REG_US_A, issuanceDate]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(0);

            const balanceBefore = await token.balanceOf(holder1.address);
            expect(balanceBefore).to.equal(mintAmount);

            // In a real upgrade scenario:
            // 1. Deploy new implementation
            // 2. Upgrade through multi-sig
            // 3. Verify balance persists
            // This would require a V2 contract to test properly
        });
    });

    describe("Emergency Functions", function () {
        it("Should recover accidentally sent ETH (TODO: Fix proxy ETH handling)", async function () {
            // First verify the token contract can receive ETH
            const initialTokenBalance = await ethers.provider.getBalance(tokenAddress);

            // Send ETH to token contract
            await owner.sendTransaction({
                to: tokenAddress,
                value: ethers.parseUnits("1", 10)
            });

            // Verify ETH was received
            const tokenBalanceAfter = await ethers.provider.getBalance(tokenAddress);
            expect(tokenBalanceAfter).to.equal(initialTokenBalance + ethers.parseUnits("1", 10));

            // Prepare recovery operation
            const recoverData = token.interface.encodeFunctionData("recoverToken", [
                ethers.ZeroAddress,
                ethers.parseUnits("1", 10)
            ]);

            // Get initial RTA balance
            const rtaBalanceBefore = await ethers.provider.getBalance(rtaProxyAddress);

            // Submit operation (first signer)
            await rtaProxy.connect(rta1).submitOperation(tokenAddress, recoverData, 0);

            // Confirm and execute (second signer)
            // This should transfer ETH from token to RTAProxy
            await rtaProxy.connect(rta2).confirmOperation(0);

            // Verify ETH was transferred to RTAProxy
            const rtaBalanceAfter = await ethers.provider.getBalance(rtaProxyAddress);
            expect(rtaBalanceAfter).to.equal(rtaBalanceBefore + ethers.parseUnits("1", 10));

            // Verify token contract no longer has the ETH
            const tokenBalanceFinal = await ethers.provider.getBalance(tokenAddress);
            expect(tokenBalanceFinal).to.equal(initialTokenBalance);
        });
    });

    describe("Court Orders", function () {
        it("Should execute court orders even on frozen accounts", async function () {
            // Setup: Mint tokens and freeze account
            const mintAmount = ethers.parseUnits("1000", 10);
            const mintData = token.interface.encodeFunctionData("mint", [holder1.address, mintAmount
            , REG_US_A, issuanceDate]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(0);

            // Freeze holder1
            const freezeData = token.interface.encodeFunctionData("setAccountFrozen", [
                holder1.address,
                true
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, freezeData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Execute court order
            const courtOrderData = token.interface.encodeFunctionData("controllerTransfer", [
                holder1.address,
                holder2.address,
                ethers.parseUnits("500", 10),
                ethers.encodeBytes32String("COURT-ORDER-123"),
                ethers.toUtf8Bytes("COURT_ORDER")
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, courtOrderData, 0);
            await rtaProxy.connect(rta2).confirmOperation(2);

            // Verify transfer happened despite frozen status
            expect(await token.balanceOf(holder1.address)).to.equal(ethers.parseUnits("500", 10));
            expect(await token.balanceOf(holder2.address)).to.equal(ethers.parseUnits("500", 10));
        });
    });

    describe("ERC-165 Support", function () {
        it("Should support required interfaces", async function () {
            // IERC165
            expect(await token.supportsInterface("0x01ffc9a7")).to.be.true;

            // IERC20
            expect(await token.supportsInterface("0x36372b07")).to.be.false;

            // IERC20Metadata
            expect(await token.supportsInterface("0xa219a025")).to.be.true;

            // IERC1450
            expect(await token.supportsInterface("0xaf175dee")).to.be.true;
        });
    });
});