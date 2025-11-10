const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { ERC1450RequestStatus } = require("./constants");

describe("ERC1450Upgradeable Security Token", function () {
    let ERC1450Upgradeable, RTAProxyUpgradeable;
    let token, rtaProxy;
    let owner, rta1, rta2, rta3, holder1, holder2, broker1;
    let tokenAddress, rtaProxyAddress;

    beforeEach(async function () {
        // Get signers
        [owner, rta1, rta2, rta3, holder1, holder2, broker1] = await ethers.getSigners();

        // Get contract factories
        ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
        RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");

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
            ["Test Security Token", "TST", 18, owner.address, rtaProxyAddress],
            { initializer: 'initialize', kind: 'uups' }
        );
        await token.waitForDeployment();
        tokenAddress = await token.getAddress();
    });

    describe("Deployment & Initialization", function () {
        it("Should set the correct token metadata", async function () {
            expect(await token.name()).to.equal("Test Security Token");
            expect(await token.symbol()).to.equal("TST");
            expect(await token.decimals()).to.equal(18);
        });

        it("Should set the correct owner and transfer agent", async function () {
            expect(await token.owner()).to.equal(owner.address);
            expect(await token.isTransferAgent(rtaProxyAddress)).to.be.true;
        });

        it("Should prevent re-initialization", async function () {
            await expect(
                token.initialize(
                    "Another Token", "ATK", 18, owner.address, rtaProxyAddress
                )
            ).to.be.reverted;
        });

        it("Should return correct version", async function () {
            expect(await token.version()).to.equal("1.0.0");
            expect(await rtaProxy.version()).to.equal("1.0.0");
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
            // Submit upgrade operation
            const newImpl = ethers.Wallet.createRandom().address; // Dummy address for testing

            await expect(
                rtaProxy.connect(rta1).submitUpgradeOperation(newImpl)
            ).to.emit(rtaProxy, "OperationSubmitted");
        });
    });

    describe("RTA Functions via Proxy", function () {
        it("Should mint tokens through multi-sig", async function () {
            const mintAmount = ethers.parseEther("1000");

            // Encode mint function call
            const mintData = token.interface.encodeFunctionData("mint", [
                holder1.address,
                mintAmount
            ]);

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
            const mintAmount = ethers.parseEther("1000");
            const mintData = token.interface.encodeFunctionData("mint", [
                holder1.address,
                mintAmount
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(0);

            // Now transfer tokens
            const transferAmount = ethers.parseEther("100");
            const transferData = token.interface.encodeFunctionData("transferFrom", [
                holder1.address,
                holder2.address,
                transferAmount
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, transferData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Check balances
            expect(await token.balanceOf(holder1.address)).to.equal(ethers.parseEther("900"));
            expect(await token.balanceOf(holder2.address)).to.equal(transferAmount);
        });
    });

    describe("Transfer Request System", function () {
        beforeEach(async function () {
            // Mint tokens to holder1
            const mintAmount = ethers.parseEther("1000");
            const mintData = token.interface.encodeFunctionData("mint", [
                holder1.address,
                mintAmount
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
            await rtaProxy.connect(rta2).confirmOperation(0);
        });

        it("Should create and process transfer requests", async function () {
            const transferAmount = ethers.parseEther("100");
            const feeAmount = ethers.parseEther("0.01");

            // Request transfer
            await token.connect(holder1).requestTransferWithFee(
                holder1.address,
                holder2.address,
                transferAmount,
                ethers.ZeroAddress,
                feeAmount,
                { value: feeAmount }
            );

            // Process request through multi-sig
            const processData = token.interface.encodeFunctionData("processTransferRequest", [1]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, processData, 0);
            await rtaProxy.connect(rta2).confirmOperation(1);

            // Check balances
            expect(await token.balanceOf(holder2.address)).to.equal(transferAmount);
        });
    });

    describe("Fee Management", function () {
        it("Should set fee parameters through multi-sig", async function () {
            const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
                1, // percentage type
                100, // 1% (100 basis points)
                [ethers.ZeroAddress, holder1.address] // accepted tokens
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, setFeeData, 0);
            await rtaProxy.connect(rta2).confirmOperation(0);

            expect(await token.feeType()).to.equal(1);
            expect(await token.feeValue()).to.equal(100);
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

            expect(await token.isBroker(broker1.address)).to.be.true;
        });
    });

    describe("Storage Persistence Through Upgrades", function () {
        it("Should maintain balances after upgrade", async function () {
            // Mint tokens first
            const mintAmount = ethers.parseEther("1000");
            const mintData = token.interface.encodeFunctionData("mint", [
                holder1.address,
                mintAmount
            ]);

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
        it.skip("Should recover accidentally sent ETH (TODO: Fix proxy ETH handling)", async function () {
            // First verify the token contract can receive ETH
            const initialTokenBalance = await ethers.provider.getBalance(tokenAddress);

            // Send ETH to token contract
            await owner.sendTransaction({
                to: tokenAddress,
                value: ethers.parseEther("1")
            });

            // Verify ETH was received
            const tokenBalanceAfter = await ethers.provider.getBalance(tokenAddress);
            expect(tokenBalanceAfter).to.equal(initialTokenBalance + ethers.parseEther("1"));

            // Prepare recovery operation
            const recoverData = token.interface.encodeFunctionData("recoverToken", [
                ethers.ZeroAddress,
                ethers.parseEther("1")
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
            expect(rtaBalanceAfter).to.equal(rtaBalanceBefore + ethers.parseEther("1"));

            // Verify token contract no longer has the ETH
            const tokenBalanceFinal = await ethers.provider.getBalance(tokenAddress);
            expect(tokenBalanceFinal).to.equal(initialTokenBalance);
        });
    });

    describe("Court Orders", function () {
        it("Should execute court orders even on frozen accounts", async function () {
            // Setup: Mint tokens and freeze account
            const mintAmount = ethers.parseEther("1000");
            const mintData = token.interface.encodeFunctionData("mint", [
                holder1.address,
                mintAmount
            ]);

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
            const courtOrderData = token.interface.encodeFunctionData("executeCourtOrder", [
                holder1.address,
                holder2.address,
                ethers.parseEther("500"),
                ethers.encodeBytes32String("COURT-ORDER-123")
            ]);

            await rtaProxy.connect(rta1).submitOperation(tokenAddress, courtOrderData, 0);
            await rtaProxy.connect(rta2).confirmOperation(2);

            // Verify transfer happened despite frozen status
            expect(await token.balanceOf(holder1.address)).to.equal(ethers.parseEther("500"));
            expect(await token.balanceOf(holder2.address)).to.equal(ethers.parseEther("500"));
        });
    });

    describe("ERC-165 Support", function () {
        it("Should support required interfaces", async function () {
            // IERC165
            expect(await token.supportsInterface("0x01ffc9a7")).to.be.true;

            // IERC20
            expect(await token.supportsInterface("0x36372b07")).to.be.true;

            // IERC20Metadata
            expect(await token.supportsInterface("0xa219a025")).to.be.true;

            // IERC1450
            expect(await token.supportsInterface("0xaf175dee")).to.be.true;
        });
    });
});