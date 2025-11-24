const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ERC1450 Regulation Tracking", function () {
  let erc1450;
  let rtaProxy;
  let owner;
  let transferAgent;
  let signer2;
  let signer3;
  let holder1;
  let holder2;

  // Regulation constants
  const REG_US_A_TIER_2 = 0x0005;
  const REG_US_CF = 0x0006;
  const REG_US_D_506C = 0x0008;

  beforeEach(async function () {
    [owner, transferAgent, signer2, signer3, holder1, holder2] = await ethers.getSigners();

    // Deploy RTAProxy with multi-sig
    const RTAProxy = await ethers.getContractFactory("RTAProxy");
    rtaProxy = await RTAProxy.deploy(
      [transferAgent.address, signer2.address, signer3.address],
      2
    );
    await rtaProxy.waitForDeployment();

    // Deploy ERC1450 token
    const ERC1450 = await ethers.getContractFactory("ERC1450");
    const rtaProxyAddress = await rtaProxy.getAddress();
    erc1450 = await ERC1450.deploy(
      "StartEngine Token",
      "STGC",
      0, // No decimals for shares
      owner.address,
      rtaProxyAddress
    );
    await erc1450.waitForDeployment();

    // Lock the transfer agent
    const erc1450Address = await erc1450.getAddress();
    const setTransferAgentData = erc1450.interface.encodeFunctionData("setTransferAgent", [rtaProxyAddress]);
    const operationId = await rtaProxy.connect(transferAgent).submitOperation.staticCall(
      erc1450Address,
      setTransferAgentData,
      0
    );
    await rtaProxy.connect(transferAgent).submitOperation(erc1450Address, setTransferAgentData, 0);
    await rtaProxy.connect(signer2).confirmOperation(operationId);
  });

  describe("Minting with Regulation Tracking", function () {
    it("Should mint tokens with regulation type and issuance date", async function () {
      const amount = ethers.parseEther("1000");
      const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago

      // Prepare mint transaction
      const mintData = erc1450.interface.encodeFunctionData("mint", [
        holder1.address,
        amount,
        REG_US_CF,
        issuanceDate
      ]);

      // Submit via RTAProxy
      const tokenAddress = await erc1450.getAddress();
      const operationId = await rtaProxy.connect(transferAgent).submitOperation.staticCall(
        tokenAddress,
        mintData,
        0
      );
      await rtaProxy.connect(transferAgent).submitOperation(tokenAddress, mintData, 0);

      // Confirm and execute
      const tx = await rtaProxy.connect(signer2).confirmOperation(operationId);

      // Check for TokensMinted event
      const receipt = await tx.wait();
      const erc1450Interface = erc1450.interface;
      const tokensMintedEvent = receipt.logs.find(
        log => log.address === tokenAddress &&
               log.topics[0] === erc1450Interface.getEvent("TokensMinted").topicHash
      );
      expect(tokensMintedEvent).to.not.be.undefined;

      // Verify balance
      expect(await erc1450.balanceOf(holder1.address)).to.equal(amount);
    });

    it("Should track multiple regulation types for same holder", async function () {
      const amount1 = ethers.parseEther("100");
      const amount2 = ethers.parseEther("200");
      const issuanceDate1 = Math.floor(Date.now() / 1000) - 86400 * 60; // 60 days ago
      const issuanceDate2 = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago

      // Mint Reg CF tokens
      const mintData1 = erc1450.interface.encodeFunctionData("mint", [
        holder1.address,
        amount1,
        REG_US_CF,
        issuanceDate1
      ]);
      const tokenAddress = await erc1450.getAddress();
      const opId1 = await rtaProxy.connect(transferAgent).submitOperation.staticCall(
        tokenAddress,
        mintData1,
        0
      );
      await rtaProxy.connect(transferAgent).submitOperation(tokenAddress, mintData1, 0);
      await rtaProxy.connect(signer2).confirmOperation(opId1);

      // Mint Reg D tokens
      const mintData2 = erc1450.interface.encodeFunctionData("mint", [
        holder1.address,
        amount2,
        REG_US_D_506C,
        issuanceDate2
      ]);
      const opId2 = await rtaProxy.connect(transferAgent).submitOperation.staticCall(
        await erc1450.getAddress(),
        mintData2,
        0
      );
      await rtaProxy.connect(transferAgent).submitOperation(await erc1450.getAddress(), mintData2, 0);
      await rtaProxy.connect(signer2).confirmOperation(opId2);

      // Query holder regulations
      const regulations = await erc1450.getHolderRegulations(holder1.address);
      expect(regulations.regulationTypes.length).to.equal(2);
      expect(regulations.amounts.length).to.equal(2);
      expect(regulations.issuanceDates.length).to.equal(2);

      // Verify total balance
      const totalBalance = amount1 + amount2;
      expect(await erc1450.balanceOf(holder1.address)).to.equal(totalBalance);
    });

    it("Should track regulation supply correctly", async function () {
      const amount = ethers.parseEther("500");
      const issuanceDate = Math.floor(Date.now() / 1000);

      // Mint tokens
      const mintData = erc1450.interface.encodeFunctionData("mint", [
        holder1.address,
        amount,
        REG_US_A_TIER_2,
        issuanceDate
      ]);
      const opId = await rtaProxy.connect(transferAgent).submitOperation.staticCall(
        await erc1450.getAddress(),
        mintData,
        0
      );
      await rtaProxy.connect(transferAgent).submitOperation(await erc1450.getAddress(), mintData, 0);
      await rtaProxy.connect(signer2).confirmOperation(opId);

      // Check regulation supply
      const supplyRegA = await erc1450.getRegulationSupply(REG_US_A_TIER_2);
      expect(supplyRegA).to.equal(amount);
    });
  });

  describe("Burning with Regulation Tracking", function () {
    beforeEach(async function () {
      // Mint some tokens first
      const amount = ethers.parseEther("300");
      const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30;

      const mintData = erc1450.interface.encodeFunctionData("mint", [
        holder1.address,
        amount,
        REG_US_CF,
        issuanceDate
      ]);
      const opId = await rtaProxy.connect(transferAgent).submitOperation.staticCall(
        await erc1450.getAddress(),
        mintData,
        0
      );
      await rtaProxy.connect(transferAgent).submitOperation(await erc1450.getAddress(), mintData, 0);
      await rtaProxy.connect(signer2).confirmOperation(opId);
    });

    it("Should burn tokens using FIFO and emit TokensBurned events", async function () {
      const burnAmount = ethers.parseEther("100");

      // Burn tokens
      const burnData = erc1450.interface.encodeFunctionData("burnFrom", [
        holder1.address,
        burnAmount
      ]);
      const opId = await rtaProxy.connect(transferAgent).submitOperation.staticCall(
        await erc1450.getAddress(),
        burnData,
        0
      );
      await rtaProxy.connect(transferAgent).submitOperation(await erc1450.getAddress(), burnData, 0);
      const tx = await rtaProxy.connect(signer2).confirmOperation(opId);

      // Check for TokensBurned event
      const receipt = await tx.wait();
      const tokenAddress = await erc1450.getAddress();
      const erc1450Interface = erc1450.interface;
      const tokensBurnedEvent = receipt.logs.find(
        log => log.address === tokenAddress &&
               log.topics[0] === erc1450Interface.getEvent("TokensBurned").topicHash
      );
      expect(tokensBurnedEvent).to.not.be.undefined;

      // Verify new balance
      const expectedBalance = ethers.parseEther("200");
      expect(await erc1450.balanceOf(holder1.address)).to.equal(expectedBalance);
    });

    it("Should burn specific regulation tokens", async function () {
      // First mint some more Reg A tokens
      const amountRegA = ethers.parseEther("100");
      const issuanceDate = Math.floor(Date.now() / 1000);

      const mintData = erc1450.interface.encodeFunctionData("mint", [
        holder1.address,
        amountRegA,
        REG_US_A_TIER_2,
        issuanceDate
      ]);
      const mintOpId = await rtaProxy.connect(transferAgent).submitOperation.staticCall(
        await erc1450.getAddress(),
        mintData,
        0
      );
      await rtaProxy.connect(transferAgent).submitOperation(await erc1450.getAddress(), mintData, 0);
      await rtaProxy.connect(signer2).confirmOperation(mintOpId);

      // Now burn only Reg A tokens
      const burnAmount = ethers.parseEther("50");
      const burnData = erc1450.interface.encodeFunctionData("burnFromRegulation", [
        holder1.address,
        burnAmount,
        REG_US_A_TIER_2
      ]);
      const burnOpId = await rtaProxy.connect(transferAgent).submitOperation.staticCall(
        await erc1450.getAddress(),
        burnData,
        0
      );
      await rtaProxy.connect(transferAgent).submitOperation(await erc1450.getAddress(), burnData, 0);
      await rtaProxy.connect(signer2).confirmOperation(burnOpId);

      // Check regulation supply
      const supplyRegA = await erc1450.getRegulationSupply(REG_US_A_TIER_2);
      const expectedRegA = ethers.parseEther("50"); // 100 - 50
      expect(supplyRegA).to.equal(expectedRegA);

      // Check that Reg CF tokens were not touched
      const supplyRegCF = await erc1450.getRegulationSupply(REG_US_CF);
      expect(supplyRegCF).to.equal(ethers.parseEther("300"));
    });
  });

  describe("Regulated Transfer Tracking", function () {
    it("Should transfer tokens using RTA-chosen strategy with transferFromRegulated", async function () {
      // Mint tokens with different regulations and dates
      const amount1 = ethers.parseEther("100");
      const amount2 = ethers.parseEther("200");
      const issuanceDate1 = Math.floor(Date.now() / 1000) - 86400 * 60; // Older
      const issuanceDate2 = Math.floor(Date.now() / 1000) - 86400 * 30; // Newer

      // Mint older Reg CF tokens
      const mintData1 = erc1450.interface.encodeFunctionData("mint", [
        holder1.address,
        amount1,
        REG_US_CF,
        issuanceDate1
      ]);
      const tokenAddress = await erc1450.getAddress();
      const opId1 = await rtaProxy.connect(transferAgent).submitOperation.staticCall(
        tokenAddress,
        mintData1,
        0
      );
      await rtaProxy.connect(transferAgent).submitOperation(tokenAddress, mintData1, 0);
      await rtaProxy.connect(signer2).confirmOperation(opId1);

      // Mint newer Reg D tokens
      const mintData2 = erc1450.interface.encodeFunctionData("mint", [
        holder1.address,
        amount2,
        REG_US_D_506C,
        issuanceDate2
      ]);
      const opId2 = await rtaProxy.connect(transferAgent).submitOperation.staticCall(
        await erc1450.getAddress(),
        mintData2,
        0
      );
      await rtaProxy.connect(transferAgent).submitOperation(await erc1450.getAddress(), mintData2, 0);
      await rtaProxy.connect(signer2).confirmOperation(opId2);

      // RTA chooses to transfer specific batches (demonstrating control over strategy)
      // First transfer 100 RegCF tokens
      const transferAmount = ethers.parseEther("100");
      const transferData = erc1450.interface.encodeFunctionData("transferFromRegulated", [
        holder1.address,
        holder2.address,
        transferAmount,
        REG_US_CF,
        issuanceDate1
      ]);
      const transferOpId = await rtaProxy.connect(transferAgent).submitOperation.staticCall(
        await erc1450.getAddress(),
        transferData,
        0
      );
      await rtaProxy.connect(transferAgent).submitOperation(await erc1450.getAddress(), transferData, 0);
      await rtaProxy.connect(signer2).confirmOperation(transferOpId);

      // Check holder2's regulations (should have 1 regulation type now)
      const holder2Regs = await erc1450.getHolderRegulations(holder2.address);
      expect(holder2Regs.regulationTypes.length).to.equal(1);
      expect(holder2Regs.regulationTypes[0]).to.equal(REG_US_CF);

      // Verify holder1's remaining balance
      const holder1Balance = await erc1450.balanceOf(holder1.address);
      expect(holder1Balance).to.equal(ethers.parseEther("200")); // 300 - 100

      // Verify holder2's received balance
      const holder2Balance = await erc1450.balanceOf(holder2.address);
      expect(holder2Balance).to.equal(transferAmount);
    });
  });

  describe("Edge Cases and Validation", function () {
    it("Should reject mint with invalid regulation type", async function () {
      const mintData = erc1450.interface.encodeFunctionData("mint", [
        holder1.address,
        ethers.parseEther("100"),
        0, // Invalid regulation type
        Math.floor(Date.now() / 1000)
      ]);

      const opId = await rtaProxy.connect(transferAgent).submitOperation.staticCall(
        await erc1450.getAddress(),
        mintData,
        0
      );
      await rtaProxy.connect(transferAgent).submitOperation(await erc1450.getAddress(), mintData, 0);

      // This should fail when executed
      let reverted = false;
      try {
        await rtaProxy.connect(signer2).confirmOperation(opId);
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });

    it("Should reject mint with future issuance date", async function () {
      // Get current block timestamp
      const blockNumber = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNumber);
      const futureDate = block.timestamp + 86400; // 24 hours in the future

      const mintData = erc1450.interface.encodeFunctionData("mint", [
        holder1.address,
        ethers.parseEther("100"),
        REG_US_CF,
        futureDate
      ]);

      const opId = await rtaProxy.connect(transferAgent).submitOperation.staticCall(
        await erc1450.getAddress(),
        mintData,
        0
      );
      await rtaProxy.connect(transferAgent).submitOperation(await erc1450.getAddress(), mintData, 0);

      // This should fail when trying to execute
      let reverted = false;
      try {
        await rtaProxy.connect(signer2).confirmOperation(opId);
      } catch (error) {
        reverted = true;
      }
      expect(reverted).to.be.true;
    });
  });
});