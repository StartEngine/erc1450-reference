const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("ERC1450Upgradeable - Additional Coverage", function () {
  let token, rtaProxy;
  let owner, rta1, rta2, rta3, holder1, holder2, feeRecipient;
  let tokenAddress, rtaProxyAddress;

  // Regulation constants
  const REG_US_A = 0x0001;
  const REG_US_CF = 0x0002;
  const REG_US_D = 0x0003;
  const issuanceDate1 = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago
  const issuanceDate2 = Math.floor(Date.now() / 1000) - 86400 * 60; // 60 days ago

  beforeEach(async function () {
    [owner, rta1, rta2, rta3, holder1, holder2, feeRecipient] = await ethers.getSigners();

    // Deploy RTAProxy
    const RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
    rtaProxy = await upgrades.deployProxy(
      RTAProxyUpgradeable,
      [[rta1.address, rta2.address, rta3.address], 2],
      { initializer: 'initialize', kind: 'uups' }
    );
    await rtaProxy.waitForDeployment();
    rtaProxyAddress = await rtaProxy.getAddress();

    // Deploy ERC1450Upgradeable
    const ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
    token = await upgrades.deployProxy(
      ERC1450Upgradeable,
      ["Test Token", "TST", 18, owner.address, rtaProxyAddress],
      { initializer: 'initialize', kind: 'uups' }
    );
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();
  });

  describe("Regulation Details Coverage", function () {
    beforeEach(async function () {
      // Mint tokens with different regulation types
      const mintData1 = token.interface.encodeFunctionData("mint", [
        holder1.address,
        ethers.parseEther("1000"),
        REG_US_A,
        issuanceDate1
      ]);
      await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData1, 0);
      await rtaProxy.connect(rta2).confirmOperation(0);

      const mintData2 = token.interface.encodeFunctionData("mint", [
        holder1.address,
        ethers.parseEther("500"),
        REG_US_CF,
        issuanceDate2
      ]);
      await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData2, 0);
      await rtaProxy.connect(rta2).confirmOperation(1);

      const mintData3 = token.interface.encodeFunctionData("mint", [
        holder1.address,
        ethers.parseEther("750"),
        REG_US_D,
        issuanceDate1
      ]);
      await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData3, 0);
      await rtaProxy.connect(rta2).confirmOperation(2);
    });

    it("Should get regulation details for holder with multiple batches", async function () {
      const details = await token.getHolderRegulations(holder1.address);

      expect(details.regulationTypes.length).to.equal(3);
      expect(details.amounts.length).to.equal(3);
      expect(details.issuanceDates.length).to.equal(3);

      // Check all regulation types are present (BigInt comparison)
      expect(details.regulationTypes.map(Number)).to.include(REG_US_A);
      expect(details.regulationTypes.map(Number)).to.include(REG_US_CF);
      expect(details.regulationTypes.map(Number)).to.include(REG_US_D);
    });

    it("Should get regulation details for holder with no tokens", async function () {
      const details = await token.getHolderRegulations(holder2.address);

      expect(details.regulationTypes.length).to.equal(0);
      expect(details.amounts.length).to.equal(0);
      expect(details.issuanceDates.length).to.equal(0);
    });

    it("Should track regulation supply correctly", async function () {
      const supplyA = await token.getRegulationSupply(REG_US_A);
      const supplyCF = await token.getRegulationSupply(REG_US_CF);
      const supplyD = await token.getRegulationSupply(REG_US_D);

      expect(supplyA).to.equal(ethers.parseEther("1000"));
      expect(supplyCF).to.equal(ethers.parseEther("500"));
      expect(supplyD).to.equal(ethers.parseEther("750"));
    });

    it("Should return zero for unused regulation types", async function () {
      const supply = await token.getRegulationSupply(0x9999); // Unused regulation
      expect(supply).to.equal(0);
    });

    it("Should update regulation supply after transfer", async function () {
      // Transfer some REG_US_A tokens from holder1 to holder2
      const transferData = token.interface.encodeFunctionData("transferFrom", [
        holder1.address,
        holder2.address,
        ethers.parseEther("200")
      ]);
      await rtaProxy.connect(rta1).submitOperation(tokenAddress, transferData, 0);
      await rtaProxy.connect(rta2).confirmOperation(3);

      // Total supply for REG_US_A should remain the same
      const supplyA = await token.getRegulationSupply(REG_US_A);
      expect(supplyA).to.equal(ethers.parseEther("1000"));

      // But holder balances should change
      const holder1Details = await token.getHolderRegulations(holder1.address);
      const holder2Details = await token.getHolderRegulations(holder2.address);

      // holder1 should have less, holder2 should have some
      expect(holder2Details.regulationTypes.map(Number)).to.include(REG_US_A);
    });

    it("Should update regulation supply after burn", async function () {
      const burnData = token.interface.encodeFunctionData("burnFrom", [
        holder1.address,
        ethers.parseEther("100")
      ]);
      await rtaProxy.connect(rta1).submitOperation(tokenAddress, burnData, 0);
      await rtaProxy.connect(rta2).confirmOperation(3);

      // Supply should decrease (burns FIFO - oldest issuance date first)
      // Check that some regulation was burned
      const totalSupply = await token.totalSupply();
      expect(totalSupply).to.equal(ethers.parseEther("2150"));

      // Verify at least one regulation supply decreased
      const supplyA = await token.getRegulationSupply(REG_US_A);
      const supplyCF = await token.getRegulationSupply(REG_US_CF);
      const supplyD = await token.getRegulationSupply(REG_US_D);

      // Total of all regulations should equal total supply
      expect(supplyA + supplyCF + supplyD).to.equal(totalSupply);
    });
  });

  describe("Fee Withdrawal Edge Cases", function () {
    beforeEach(async function () {
      // Mint tokens
      const mintData = token.interface.encodeFunctionData("mint", [
        holder1.address,
        ethers.parseEther("1000"),
        REG_US_A,
        issuanceDate1
      ]);
      await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
      await rtaProxy.connect(rta2).confirmOperation(0);

      // Set fee parameters (feeType, feeValue, acceptedTokens)
      const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
        0, // Flat fee
        ethers.parseEther("0.01"), // 0.01 ETH fee
        [ethers.ZeroAddress] // Accept ETH
      ]);
      await rtaProxy.connect(rta1).submitOperation(tokenAddress, setFeeData, 0);
      await rtaProxy.connect(rta2).confirmOperation(1);
    });

    it("Should revert when withdrawing more fees than collected", async function () {
      // Request transfer with fee
      await token.connect(holder1).requestTransferWithFee(
        holder1.address,
        holder2.address,
        ethers.parseEther("100"),
        ethers.ZeroAddress,
        ethers.parseEther("0.01"),
        { value: ethers.parseEther("0.01") }
      );

      // Try to withdraw more than collected (token, amount, recipient)
      const withdrawData = token.interface.encodeFunctionData("withdrawFees", [
        ethers.ZeroAddress,
        ethers.parseEther("0.02"), // More than collected
        feeRecipient.address
      ]);

      const tx = await rtaProxy.connect(rta1).submitOperation(tokenAddress, withdrawData, 0);
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

      // Should fail when trying to execute
      let reverted = false;
      try {
        await rtaProxy.connect(rta2).confirmOperation(operationId);
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });

    it("Should handle zero fee recipient validation", async function () {
      // Request transfer with fee
      await token.connect(holder1).requestTransferWithFee(
        holder1.address,
        holder2.address,
        ethers.parseEther("100"),
        ethers.ZeroAddress,
        ethers.parseEther("0.01"),
        { value: ethers.parseEther("0.01") }
      );

      // Try to withdraw to zero address (token, amount, recipient)
      const withdrawData = token.interface.encodeFunctionData("withdrawFees", [
        ethers.ZeroAddress,
        ethers.parseEther("0.01"),
        ethers.ZeroAddress // Invalid recipient
      ]);

      const tx = await rtaProxy.connect(rta1).submitOperation(tokenAddress, withdrawData, 0);
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

      let reverted = false;
      try {
        await rtaProxy.connect(rta2).confirmOperation(operationId);
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });

  describe("Transfer Edge Cases", function () {
    beforeEach(async function () {
      // Mint tokens to holder1
      const mintData = token.interface.encodeFunctionData("mint", [
        holder1.address,
        ethers.parseEther("1000"),
        REG_US_A,
        issuanceDate1
      ]);
      await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
      await rtaProxy.connect(rta2).confirmOperation(0);
    });

    it("Should handle transfer of exact balance", async function () {
      const balance = await token.balanceOf(holder1.address);

      const transferData = token.interface.encodeFunctionData("transferFrom", [
        holder1.address,
        holder2.address,
        balance
      ]);
      await rtaProxy.connect(rta1).submitOperation(tokenAddress, transferData, 0);
      await rtaProxy.connect(rta2).confirmOperation(1);

      expect(await token.balanceOf(holder1.address)).to.equal(0);
      expect(await token.balanceOf(holder2.address)).to.equal(balance);
    });

    it("Should maintain regulation details after full balance transfer", async function () {
      const balance = await token.balanceOf(holder1.address);

      const transferData = token.interface.encodeFunctionData("transferFrom", [
        holder1.address,
        holder2.address,
        balance
      ]);
      await rtaProxy.connect(rta1).submitOperation(tokenAddress, transferData, 0);
      await rtaProxy.connect(rta2).confirmOperation(1);

      // holder2 should now have the regulation details
      const holder2Details = await token.getHolderRegulations(holder2.address);
      expect(holder2Details.regulationTypes.length).to.be.gt(0);
      expect(holder2Details.amounts[0]).to.equal(balance);
    });
  });

  describe("Burn Regulation Type Specific", function () {
    beforeEach(async function () {
      // Mint multiple regulation types
      const mintData1 = token.interface.encodeFunctionData("mint", [
        holder1.address,
        ethers.parseEther("1000"),
        REG_US_A,
        issuanceDate1
      ]);
      await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData1, 0);
      await rtaProxy.connect(rta2).confirmOperation(0);

      const mintData2 = token.interface.encodeFunctionData("mint", [
        holder1.address,
        ethers.parseEther("500"),
        REG_US_CF,
        issuanceDate2
      ]);
      await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData2, 0);
      await rtaProxy.connect(rta2).confirmOperation(1);
    });

    it("Should burn specific regulation type correctly", async function () {
      const burnData = token.interface.encodeFunctionData("burnFromRegulation", [
        holder1.address,
        ethers.parseEther("300"),
        REG_US_A
      ]);
      await rtaProxy.connect(rta1).submitOperation(tokenAddress, burnData, 0);
      await rtaProxy.connect(rta2).confirmOperation(2);

      const supplyA = await token.getRegulationSupply(REG_US_A);
      const supplyCF = await token.getRegulationSupply(REG_US_CF);

      expect(supplyA).to.equal(ethers.parseEther("700"));
      expect(supplyCF).to.equal(ethers.parseEther("500")); // Unchanged
    });

    it("Should handle burning more than available for specific regulation type", async function () {
      const burnData = token.interface.encodeFunctionData("burnFromRegulation", [
        holder1.address,
        ethers.parseEther("1500"), // More than available for any single type
        REG_US_A
      ]);

      const tx = await rtaProxy.connect(rta1).submitOperation(tokenAddress, burnData, 0);
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

      let reverted = false;
      try {
        await rtaProxy.connect(rta2).confirmOperation(operationId);
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });
});
