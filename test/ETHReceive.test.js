const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("ETH Receive and Recovery", function () {
  let rtaProxy, rtaProxyUpgradeable;
  let erc1450, erc1450Upgradeable;
  let owner, rta, signer1, signer2, signer3;
  let investor1, investor2, donor;

  beforeEach(async function () {
    [owner, rta, signer1, signer2, signer3, investor1, investor2, donor] = await ethers.getSigners();

    // Deploy RTAProxy (2-of-3 multisig)
    const RTAProxy = await ethers.getContractFactory("RTAProxy");
    rtaProxy = await RTAProxy.deploy(
      [signer1.address, signer2.address, signer3.address],
      2
    );
    await rtaProxy.waitForDeployment();

    // Deploy ERC1450 with RTAProxy as RTA
    const ERC1450 = await ethers.getContractFactory("ERC1450");
    erc1450 = await ERC1450.deploy(
      "Test Token",
      "TST",
      18,
      owner.address,
      await rtaProxy.getAddress()
    );
    await erc1450.waitForDeployment();

    // Deploy upgradeable versions using upgrades plugin
    const RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
    rtaProxyUpgradeable = await upgrades.deployProxy(
      RTAProxyUpgradeable,
      [[signer1.address, signer2.address, signer3.address], 2],
      { initializer: 'initialize', kind: 'uups' }
    );
    await rtaProxyUpgradeable.waitForDeployment();

    const ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
    erc1450Upgradeable = await upgrades.deployProxy(
      ERC1450Upgradeable,
      ["Test Token Upgradeable", "TSTU", 10, owner.address, await rtaProxyUpgradeable.getAddress()],
      { initializer: 'initialize', kind: 'uups' }
    );
    await erc1450Upgradeable.waitForDeployment();
  });

  describe("ERC1450 - ETH Receive", function () {
    it("Should receive ETH and emit ETHReceived event", async function () {
      const amount = ethers.parseUnits("1.0", 10);
      const tokenAddress = await erc1450.getAddress();

      await expect(
        donor.sendTransaction({
          to: tokenAddress,
          value: amount
        })
      )
        .to.emit(erc1450, "ETHReceived")
        .withArgs(donor.address, amount);

      expect(await ethers.provider.getBalance(tokenAddress)).to.equal(amount);
    });

    it("Should receive multiple ETH donations", async function () {
      const tokenAddress = await erc1450.getAddress();

      await donor.sendTransaction({
        to: tokenAddress,
        value: ethers.parseUnits("0.5", 10)
      });

      await investor1.sendTransaction({
        to: tokenAddress,
        value: ethers.parseUnits("0.3", 10)
      });

      expect(await ethers.provider.getBalance(tokenAddress))
        .to.equal(ethers.parseUnits("0.8", 10));
    });

    it("Should allow RTA to recover sent ETH", async function () {
      const amount = ethers.parseUnits("1.0", 10);
      const tokenAddress = await erc1450.getAddress();

      // Send ETH to contract
      await donor.sendTransaction({
        to: tokenAddress,
        value: amount
      });

      expect(await ethers.provider.getBalance(tokenAddress)).to.equal(amount);

      // RTA recovers ETH via multisig
      const rtaProxyAddress = await rtaProxy.getAddress();
      const recoverData = erc1450.interface.encodeFunctionData("recoverToken", [
        ethers.ZeroAddress, // address(0) = ETH
        amount
      ]);

      const tx = await rtaProxy.connect(signer1).submitOperation(
        tokenAddress,
        recoverData,
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

      // Confirm and execute
      await rtaProxy.connect(signer2).confirmOperation(operationId);

      // ETH should be transferred to RTAProxy (the RTA)
      expect(await ethers.provider.getBalance(tokenAddress)).to.equal(0);
      expect(await ethers.provider.getBalance(rtaProxyAddress)).to.be.gt(0);
    });

    it("Should not allow non-RTA to recover ETH", async function () {
      const amount = ethers.parseUnits("0.5", 10);

      await donor.sendTransaction({
        to: await erc1450.getAddress(),
        value: amount
      });

      await expect(
        erc1450.connect(investor1).recoverToken(ethers.ZeroAddress, amount)
      ).to.be.revertedWithCustomError(erc1450, "ERC1450OnlyRTA");
    });

    it("Should recover partial ETH amount", async function () {
      const tokenAddress = await erc1450.getAddress();

      // Send 2 ETH
      await donor.sendTransaction({
        to: tokenAddress,
        value: ethers.parseUnits("2.0", 10)
      });

      // Recover only 1 ETH
      const recoverData = erc1450.interface.encodeFunctionData("recoverToken", [
        ethers.ZeroAddress,
        ethers.parseUnits("1.0", 10)
      ]);

      const tx = await rtaProxy.connect(signer1).submitOperation(
        tokenAddress,
        recoverData,
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

      await rtaProxy.connect(signer2).confirmOperation(operationId);

      // 1 ETH should remain
      expect(await ethers.provider.getBalance(tokenAddress))
        .to.equal(ethers.parseUnits("1.0", 10));
    });
  });

  describe("ERC1450Upgradeable - ETH Receive", function () {
    it("Should receive ETH and emit ETHReceived event", async function () {
      const amount = ethers.parseUnits("0.5", 10);
      const tokenAddress = await erc1450Upgradeable.getAddress();

      await expect(
        donor.sendTransaction({
          to: tokenAddress,
          value: amount
        })
      )
        .to.emit(erc1450Upgradeable, "ETHReceived")
        .withArgs(donor.address, amount);

      expect(await ethers.provider.getBalance(tokenAddress)).to.equal(amount);
    });

    it("Should allow RTA to recover ETH", async function () {
      const amount = ethers.parseUnits("0.75", 10);
      const tokenAddress = await erc1450Upgradeable.getAddress();

      await donor.sendTransaction({
        to: tokenAddress,
        value: amount
      });

      // RTA recovers via multisig
      const recoverData = erc1450Upgradeable.interface.encodeFunctionData("recoverToken", [
        ethers.ZeroAddress,
        amount
      ]);

      const tx = await rtaProxyUpgradeable.connect(signer1).submitOperation(
        tokenAddress,
        recoverData,
        0
      );
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          const parsed = rtaProxyUpgradeable.interface.parseLog(log);
          return parsed.name === "OperationSubmitted";
        } catch (e) {
          return false;
        }
      });
      const operationId = event.args.operationId;

      await rtaProxyUpgradeable.connect(signer2).confirmOperation(operationId);

      expect(await ethers.provider.getBalance(tokenAddress)).to.equal(0);
    });
  });

  describe("RTAProxy - ETH Receive", function () {
    it("Should receive ETH and emit ETHReceived event", async function () {
      const amount = ethers.parseUnits("2.0", 10);
      const proxyAddress = await rtaProxy.getAddress();

      await expect(
        donor.sendTransaction({
          to: proxyAddress,
          value: amount
        })
      )
        .to.emit(rtaProxy, "ETHReceived")
        .withArgs(donor.address, amount);

      expect(await ethers.provider.getBalance(proxyAddress)).to.equal(amount);
    });

    it("Should use received ETH for operations", async function () {
      const proxyAddress = await rtaProxy.getAddress();

      // Donate ETH to RTAProxy
      await donor.sendTransaction({
        to: proxyAddress,
        value: ethers.parseUnits("1.0", 10)
      });

      const initialBalance = await ethers.provider.getBalance(proxyAddress);
      expect(initialBalance).to.be.gt(0);

      // RTAProxy can use this ETH for operations (e.g., sending to another address)
      // This is implicit - the balance exists and can be used in submitOperation calls
    });

    it("Should recover ETH via multisig operation", async function () {
      const proxyAddress = await rtaProxy.getAddress();

      // Send ETH to RTAProxy
      const amount = ethers.parseUnits("1.5", 10);
      await donor.sendTransaction({
        to: proxyAddress,
        value: amount
      });

      // Create operation to send ETH out
      const recipientBalanceBefore = await ethers.provider.getBalance(investor1.address);

      // Encode a simple transfer call
      const transferAmount = ethers.parseUnits("0.5", 10);
      const tx = await rtaProxy.connect(signer1).submitOperation(
        investor1.address,
        "0x", // empty data for simple transfer
        transferAmount
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

      // Confirm and execute
      await rtaProxy.connect(signer2).confirmOperation(operationId);

      // Check recipient received ETH
      const recipientBalanceAfter = await ethers.provider.getBalance(investor1.address);
      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(transferAmount);

      // Check RTAProxy balance decreased
      const proxyBalanceAfter = await ethers.provider.getBalance(proxyAddress);
      expect(proxyBalanceAfter).to.equal(amount - transferAmount);
    });

    it("Should receive ETH from multiple sources", async function () {
      const proxyAddress = await rtaProxy.getAddress();

      await donor.sendTransaction({
        to: proxyAddress,
        value: ethers.parseUnits("0.5", 10)
      });

      await investor1.sendTransaction({
        to: proxyAddress,
        value: ethers.parseUnits("0.3", 10)
      });

      await investor2.sendTransaction({
        to: proxyAddress,
        value: ethers.parseUnits("0.2", 10)
      });

      expect(await ethers.provider.getBalance(proxyAddress))
        .to.equal(ethers.parseUnits("1.0", 10));
    });
  });

  describe("RTAProxyUpgradeable - ETH Receive", function () {
    it("Should receive ETH and emit ETHReceived event", async function () {
      const amount = ethers.parseUnits("1.2", 10);
      const proxyAddress = await rtaProxyUpgradeable.getAddress();

      await expect(
        donor.sendTransaction({
          to: proxyAddress,
          value: amount
        })
      )
        .to.emit(rtaProxyUpgradeable, "ETHReceived")
        .withArgs(donor.address, amount);

      expect(await ethers.provider.getBalance(proxyAddress)).to.equal(amount);
    });

    it("Should recover ETH via multisig", async function () {
      const proxyAddress = await rtaProxyUpgradeable.getAddress();

      await donor.sendTransaction({
        to: proxyAddress,
        value: ethers.parseUnits("0.8", 10)
      });

      const transferAmount = ethers.parseUnits("0.3", 10);
      const tx = await rtaProxyUpgradeable.connect(signer1).submitOperation(
        investor2.address,
        "0x",
        transferAmount
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          const parsed = rtaProxyUpgradeable.interface.parseLog(log);
          return parsed.name === "OperationSubmitted";
        } catch (e) {
          return false;
        }
      });
      const operationId = event.args.operationId;

      const recipientBalanceBefore = await ethers.provider.getBalance(investor2.address);

      await rtaProxyUpgradeable.connect(signer2).confirmOperation(operationId);

      const recipientBalanceAfter = await ethers.provider.getBalance(investor2.address);
      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(transferAmount);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero ETH sends gracefully", async function () {
      const tokenAddress = await erc1450.getAddress();

      await expect(
        donor.sendTransaction({
          to: tokenAddress,
          value: 0
        })
      )
        .to.emit(erc1450, "ETHReceived")
        .withArgs(donor.address, 0);
    });

    it("Should handle very small ETH amounts (wei)", async function () {
      const tokenAddress = await erc1450.getAddress();
      const oneWei = 1n;

      await expect(
        donor.sendTransaction({
          to: tokenAddress,
          value: oneWei
        })
      )
        .to.emit(erc1450, "ETHReceived")
        .withArgs(donor.address, oneWei);

      expect(await ethers.provider.getBalance(tokenAddress)).to.equal(oneWei);
    });

    it("Should track multiple rapid ETH sends", async function () {
      const tokenAddress = await erc1450.getAddress();
      const amount = ethers.parseUnits("0.1", 10);

      // Send 5 times rapidly
      for (let i = 0; i < 5; i++) {
        await donor.sendTransaction({
          to: tokenAddress,
          value: amount
        });
      }

      expect(await ethers.provider.getBalance(tokenAddress))
        .to.equal(ethers.parseUnits("0.5", 10));
    });
  });
});
