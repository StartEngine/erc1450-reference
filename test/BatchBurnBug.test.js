const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("batchBurnFrom Bug Test", function () {
    let token, rtaProxy;
    let owner, rta1, rta2, alice;
    const REG_A_TIER_2 = 5;

    beforeEach(async function () {
        [owner, rta1, rta2, alice] = await ethers.getSigners();

        // Deploy RTAProxy with 2-of-3 multisig
        const RTAProxy = await ethers.getContractFactory("RTAProxy");
        rtaProxy = await RTAProxy.deploy(
            [rta1.address, rta2.address, owner.address],
            2 // threshold
        );
        await rtaProxy.waitForDeployment();

        // Deploy ERC1450 token with RTAProxy as transfer agent
        const ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy(
            "Test Token",
            "TEST",
            10, // decimals
            owner.address,
            await rtaProxy.getAddress()
        );
        await token.waitForDeployment();

        const tokenAddress = await token.getAddress();
        const issuanceDate = Math.floor(Date.now() / 1000) - 86400; // yesterday

        // First, mint some tokens through RTAProxy
        const mintData = token.interface.encodeFunctionData("batchMint", [
            [alice.address],
            [ethers.parseUnits("1000", 10)],
            [REG_A_TIER_2],
            [issuanceDate]
        ]);

        // Submit and confirm mint operation
        const mintTx = await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
        const mintReceipt = await mintTx.wait();
        const mintEvent = mintReceipt.logs.find(log => {
            try {
                const parsed = rtaProxy.interface.parseLog(log);
                return parsed && parsed.name === "OperationSubmitted";
            } catch {
                return false;
            }
        });
        const mintOpId = rtaProxy.interface.parseLog(mintEvent).args.operationId;
        await rtaProxy.connect(rta2).confirmOperation(mintOpId);

        // Verify mint worked
        expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("1000", 10));
    });

    it("Should succeed: batchBurnFrom through RTAProxy works after fix", async function () {
        const tokenAddress = await token.getAddress();
        const issuanceDate = Math.floor(Date.now() / 1000) - 86400;

        // Burn tokens through RTAProxy
        const burnData = token.interface.encodeFunctionData("batchBurnFrom", [
            [alice.address],
            [ethers.parseUnits("100", 10)],
            [REG_A_TIER_2],
            [issuanceDate]
        ]);

        // Submit burn operation
        const burnTx = await rtaProxy.connect(rta1).submitOperation(tokenAddress, burnData, 0);
        const burnReceipt = await burnTx.wait();
        const burnEvent = burnReceipt.logs.find(log => {
            try {
                const parsed = rtaProxy.interface.parseLog(log);
                return parsed && parsed.name === "OperationSubmitted";
            } catch {
                return false;
            }
        });
        const burnOpId = rtaProxy.interface.parseLog(burnEvent).args.operationId;

        // With the fix, this should succeed - _burnFromRegulated preserves msg.sender
        await rtaProxy.connect(rta2).confirmOperation(burnOpId);

        // Verify: alice should now have 1000 - 100 = 900 tokens
        expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("900", 10));
    });

    it("Should succeed: batchMint through RTAProxy works correctly", async function () {
        // This test proves batchMint works (no external this. call)
        const tokenAddress = await token.getAddress();
        const issuanceDate = Math.floor(Date.now() / 1000) - 86400;

        // Mint more tokens through RTAProxy - should work
        const mintData = token.interface.encodeFunctionData("batchMint", [
            [alice.address],
            [ethers.parseUnits("500", 10)],
            [REG_A_TIER_2],
            [issuanceDate]
        ]);

        // Submit and confirm mint operation
        const mintTx = await rtaProxy.connect(rta1).submitOperation(tokenAddress, mintData, 0);
        const mintReceipt = await mintTx.wait();
        const mintEvent = mintReceipt.logs.find(log => {
            try {
                const parsed = rtaProxy.interface.parseLog(log);
                return parsed && parsed.name === "OperationSubmitted";
            } catch {
                return false;
            }
        });
        const mintOpId = rtaProxy.interface.parseLog(mintEvent).args.operationId;

        // This should succeed - batchMint doesn't have the external call bug
        await rtaProxy.connect(rta2).confirmOperation(mintOpId);

        // Verify: alice should now have 1000 + 500 = 1500 tokens
        expect(await token.balanceOf(alice.address)).to.equal(ethers.parseUnits("1500", 10));
    });
});
