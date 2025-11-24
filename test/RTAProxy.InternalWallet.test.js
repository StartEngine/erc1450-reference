const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("RTAProxy - Internal Wallet Registry", function () {
  let rtaProxy;
  let erc1450;
  let owner, signer1, signer2, signer3;
  let treasury, primary, secondary, escrow;
  let investor1, investor2;

  // Regulation constants
  const REG_US_A = 0x0001;
  const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago

  beforeEach(async function () {
    // Get signers
    [owner, signer1, signer2, signer3, treasury, primary, secondary, escrow, investor1, investor2] = await ethers.getSigners();

    // Deploy RTAProxy with 3 signers (2-of-3 multisig)
    const RTAProxy = await ethers.getContractFactory("RTAProxy");
    rtaProxy = await RTAProxy.deploy(
      [signer1.address, signer2.address, signer3.address],
      2 // Required signatures
    );
    await rtaProxy.waitForDeployment();

    // Deploy ERC1450 token with RTAProxy as the RTA
    const ERC1450 = await ethers.getContractFactory("ERC1450");
    erc1450 = await ERC1450.deploy(
      "Test Security Token",
      "TST",
      18, // decimals
      owner.address,
      await rtaProxy.getAddress()
    );
    await erc1450.waitForDeployment();
  });

  describe("Internal Wallet Management", function () {
    it("Should not allow direct calls to addInternalWallet", async function () {
      await expect(
        rtaProxy.connect(signer1).addInternalWallet(treasury.address)
      ).to.be.revertedWith("Must be called through multi-sig");
    });

    it("Should add internal wallet through multisig operation", async function () {
      const rtaProxyAddress = await rtaProxy.getAddress();

      // Encode the addInternalWallet function call
      const data = rtaProxy.interface.encodeFunctionData("addInternalWallet", [treasury.address]);

      // Submit operation (from signer1)
      const tx = await rtaProxy.connect(signer1).submitOperation(
        rtaProxyAddress,
        data,
        0
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          const parsed = rtaProxy.interface.parseLog(log);
          return parsed.name === "OperationSubmitted";
        } catch (e) {
          return false;
        }
      });

      const operationId = event.args.operationId;

      // Confirm from signer2 (this will execute since we have 2-of-3)
      await rtaProxy.connect(signer2).confirmOperation(operationId);

      // Check that the wallet was added
      expect(await rtaProxy.isInternalWallet(treasury.address)).to.be.true;
      expect(await rtaProxy.getInternalWalletCount()).to.equal(1);
    });

    it("Should not add zero address as internal wallet", async function () {
      const rtaProxyAddress = await rtaProxy.getAddress();
      const data = rtaProxy.interface.encodeFunctionData("addInternalWallet", [ethers.ZeroAddress]);

      // Submit and confirm operation
      const tx = await rtaProxy.connect(signer1).submitOperation(rtaProxyAddress, data, 0);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          const parsed = rtaProxy.interface.parseLog(log);
          return parsed.name === "OperationSubmitted";
        } catch (e) {
          return false;
        }
      });
      const operationId = event.args.operationId;

      // This should fail when trying to execute
      let reverted = false;
      try {
        await rtaProxy.connect(signer2).confirmOperation(operationId);
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });

    it("Should not add same wallet twice", async function () {
      const rtaProxyAddress = await rtaProxy.getAddress();

      // Add treasury wallet first time
      let data = rtaProxy.interface.encodeFunctionData("addInternalWallet", [treasury.address]);
      let tx = await rtaProxy.connect(signer1).submitOperation(rtaProxyAddress, data, 0);
      let receipt = await tx.wait();
      let event = receipt.logs.find(log => {
        try {
          const parsed = rtaProxy.interface.parseLog(log);
          return parsed.name === "OperationSubmitted";
        } catch (e) {
          return false;
        }
      });
      let operationId = event.args.operationId;
      await rtaProxy.connect(signer2).confirmOperation(operationId);

      // Try to add treasury wallet second time
      data = rtaProxy.interface.encodeFunctionData("addInternalWallet", [treasury.address]);
      tx = await rtaProxy.connect(signer1).submitOperation(rtaProxyAddress, data, 0);
      receipt = await tx.wait();
      event = receipt.logs.find(log => {
        try {
          const parsed = rtaProxy.interface.parseLog(log);
          return parsed.name === "OperationSubmitted";
        } catch (e) {
          return false;
        }
      });
      operationId = event.args.operationId;

      // This should fail when trying to execute
      let reverted = false;
      try {
        await rtaProxy.connect(signer2).confirmOperation(operationId);
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });

    it("Should remove internal wallet through multisig", async function () {
      const rtaProxyAddress = await rtaProxy.getAddress();

      // First add the wallet
      let data = rtaProxy.interface.encodeFunctionData("addInternalWallet", [treasury.address]);
      let tx = await rtaProxy.connect(signer1).submitOperation(rtaProxyAddress, data, 0);
      let receipt = await tx.wait();
      let event = receipt.logs.find(log => {
        try {
          const parsed = rtaProxy.interface.parseLog(log);
          return parsed.name === "OperationSubmitted";
        } catch (e) {
          return false;
        }
      });
      let operationId = event.args.operationId;
      await rtaProxy.connect(signer2).confirmOperation(operationId);

      expect(await rtaProxy.isInternalWallet(treasury.address)).to.be.true;

      // Now remove it
      data = rtaProxy.interface.encodeFunctionData("removeInternalWallet", [treasury.address]);
      tx = await rtaProxy.connect(signer1).submitOperation(rtaProxyAddress, data, 0);
      receipt = await tx.wait();
      event = receipt.logs.find(log => {
        try {
          const parsed = rtaProxy.interface.parseLog(log);
          return parsed.name === "OperationSubmitted";
        } catch (e) {
          return false;
        }
      });
      operationId = event.args.operationId;
      await rtaProxy.connect(signer2).confirmOperation(operationId);

      expect(await rtaProxy.isInternalWallet(treasury.address)).to.be.false;
      expect(await rtaProxy.getInternalWalletCount()).to.equal(0);
    });

    it("Should emit correct events", async function () {
      const rtaProxyAddress = await rtaProxy.getAddress();

      // Add wallet and check event
      const data = rtaProxy.interface.encodeFunctionData("addInternalWallet", [treasury.address]);
      const tx = await rtaProxy.connect(signer1).submitOperation(rtaProxyAddress, data, 0);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          const parsed = rtaProxy.interface.parseLog(log);
          return parsed.name === "OperationSubmitted";
        } catch (e) {
          return false;
        }
      });
      const operationId = event.args.operationId;

      const confirmTx = rtaProxy.connect(signer2).confirmOperation(operationId);
      await expect(confirmTx)
        .to.emit(rtaProxy, "InternalWalletAdded");
    });
  });

  describe("Time-lock Behavior with Internal Wallets", function () {
    beforeEach(async function () {
      // Setup: Add treasury as internal wallet
      const rtaProxyAddress = await rtaProxy.getAddress();
      const data = rtaProxy.interface.encodeFunctionData("addInternalWallet", [treasury.address]);
      const tx = await rtaProxy.connect(signer1).submitOperation(rtaProxyAddress, data, 0);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          const parsed = rtaProxy.interface.parseLog(log);
          return parsed.name === "OperationSubmitted";
        } catch (e) {
          return false;
        }
      });
      const operationId = event.args.operationId;
      await rtaProxy.connect(signer2).confirmOperation(operationId);

      // Mint some tokens to owner for testing through RTAProxy multisig
      const mintAmount = ethers.parseUnits("2000000", 10); // 2M tokens
      const tokenAddress = await erc1450.getAddress();
      const mintData = erc1450.interface.encodeFunctionData("mint", [
        owner.address,
        mintAmount,
        REG_US_A, // Use consistent regulation type
        issuanceDate // Use fixed issuance date constant
      ]);

      const mintTx = await rtaProxy.connect(signer1).submitOperation(tokenAddress, mintData, 0);
      const mintReceipt = await mintTx.wait();
      const mintEvent = mintReceipt.logs.find(log => {
        try {
          const parsed = rtaProxy.interface.parseLog(log);
          return parsed.name === "OperationSubmitted";
        } catch (e) {
          return false;
        }
      });
      const mintOperationId = mintEvent.args.operationId;
      await rtaProxy.connect(signer2).confirmOperation(mintOperationId);
    });

    it("Should NOT require time-lock for high-value transfers to internal wallets", async function () {
      const amount = ethers.parseUnits("1500000", 10); // 1.5M tokens (above threshold)
      const tokenAddress = await erc1450.getAddress();

      // Encode transferFromRegulated to treasury (internal wallet)
      const data = erc1450.interface.encodeFunctionData("transferFromRegulated", [
        owner.address,
        treasury.address,
        amount,
        REG_US_A, // regulationType (matching the mint)
        issuanceDate // issuanceDate (matching the mint)
      ]);

      // Check that time-lock is NOT required
      expect(await rtaProxy.requiresTimeLock(data)).to.be.false;

      // Submit operation
      const tx = await rtaProxy.connect(signer1).submitOperation(tokenAddress, data, 0);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          const parsed = rtaProxy.interface.parseLog(log);
          return parsed.name === "OperationSubmitted";
        } catch (e) {
          return false;
        }
      });
      const operationId = event.args.operationId;

      // Should execute immediately with second signature (no time-lock)
      await expect(rtaProxy.connect(signer2).confirmOperation(operationId))
        .to.emit(rtaProxy, "OperationExecuted")
        .withArgs(operationId);

      // Verify transfer happened
      expect(await erc1450.balanceOf(treasury.address)).to.equal(amount);
    });

    it("Should REQUIRE time-lock for high-value transfers to external wallets", async function () {
      const amount = ethers.parseUnits("1500000", 10); // 1.5M tokens (above threshold)
      const tokenAddress = await erc1450.getAddress();

      // Encode transferFromRegulated to investor1 (external wallet)
      const data = erc1450.interface.encodeFunctionData("transferFromRegulated", [
        owner.address,
        investor1.address,
        amount,
        REG_US_A, // regulationType (matching the mint)
        issuanceDate // issuanceDate (matching the mint)
      ]);

      // Check that time-lock IS required
      expect(await rtaProxy.requiresTimeLock(data)).to.be.true;

      // Submit operation
      const tx = await rtaProxy.connect(signer1).submitOperation(tokenAddress, data, 0);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          const parsed = rtaProxy.interface.parseLog(log);
          return parsed.name === "OperationSubmitted";
        } catch (e) {
          return false;
        }
      });
      const operationId = event.args.operationId;

      // Should fail immediately even with second signature (time-lock not expired)
      await expect(rtaProxy.connect(signer2).confirmOperation(operationId))
        .to.be.revertedWithCustomError(rtaProxy, "TimeLockNotExpired");

      // Fast forward 24 hours
      await time.increase(24 * 60 * 60);

      // Now it should work
      await expect(rtaProxy.connect(signer2).confirmOperation(operationId))
        .to.emit(rtaProxy, "OperationExecuted")
        .withArgs(operationId);

      // Verify transfer happened
      expect(await erc1450.balanceOf(investor1.address)).to.equal(amount);
    });

    it("Should not require time-lock for small transfers regardless of destination", async function () {
      const amount = ethers.parseUnits("500000", 10); // 500K tokens (below threshold)
      const tokenAddress = await erc1450.getAddress();

      // Encode transferFromRegulated to investor1 (external wallet, but small amount)
      const data = erc1450.interface.encodeFunctionData("transferFromRegulated", [
        owner.address,
        investor1.address,
        amount,
        REG_US_A, // regulationType (matching the mint)
        issuanceDate // issuanceDate (matching the mint)
      ]);

      // Check that time-lock is NOT required (amount below threshold)
      expect(await rtaProxy.requiresTimeLock(data)).to.be.false;

      // Submit operation
      const tx = await rtaProxy.connect(signer1).submitOperation(tokenAddress, data, 0);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          const parsed = rtaProxy.interface.parseLog(log);
          return parsed.name === "OperationSubmitted";
        } catch (e) {
          return false;
        }
      });
      const operationId = event.args.operationId;

      // Should execute immediately with second signature
      await expect(rtaProxy.connect(signer2).confirmOperation(operationId))
        .to.emit(rtaProxy, "OperationExecuted")
        .withArgs(operationId);

      // Verify transfer happened
      expect(await erc1450.balanceOf(investor1.address)).to.equal(amount);
    });
  });

  describe("Multiple Internal Wallets", function () {
    it("Should manage multiple internal wallets correctly", async function () {
      const rtaProxyAddress = await rtaProxy.getAddress();
      const wallets = [treasury.address, primary.address, secondary.address, escrow.address];

      // Add all wallets
      for (const wallet of wallets) {
        const data = rtaProxy.interface.encodeFunctionData("addInternalWallet", [wallet]);
        const tx = await rtaProxy.connect(signer1).submitOperation(rtaProxyAddress, data, 0);
        const receipt = await tx.wait();
        const event = receipt.logs.find(log => {
          try {
            const parsed = rtaProxy.interface.parseLog(log);
            return parsed.name === "OperationSubmitted";
          } catch (e) {
            return false;
          }
        });
        const operationId = event.args.operationId;
        await rtaProxy.connect(signer2).confirmOperation(operationId);
      }

      // Check all are registered
      expect(await rtaProxy.getInternalWalletCount()).to.equal(4);
      for (const wallet of wallets) {
        expect(await rtaProxy.isInternalWallet(wallet)).to.be.true;
      }

      // Check non-registered wallet returns false
      expect(await rtaProxy.isInternalWallet(investor1.address)).to.be.false;
    });
  });
});