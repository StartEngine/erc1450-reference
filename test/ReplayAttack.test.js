const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Transfer Request Replay Attack Test", function () {
    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago
    let ERC1450, token, owner, rta, alice, bob;

    beforeEach(async function () {
        [owner, rta, alice, bob] = await ethers.getSigners();

        ERC1450 = await ethers.getContractFactory("ERC1450");
        token = await ERC1450.deploy("Test", "TST", 10, owner.address, rta.address);
        await token.waitForDeployment();

        await token.connect(rta).mint(alice.address, ethers.parseUnits("1000", 10), REG_US_A, issuanceDate);
        await token.connect(rta).setFeeParameters(0, 0, [ethers.ZeroAddress]);
    });

    it("Should prevent re-processing of executed transfer requests", async function () {
        // Create transfer request
        const tx = await token.connect(alice).requestTransferWithFee(
            alice.address,
            bob.address,
            ethers.parseUnits("100", 10),
            ethers.ZeroAddress,
            0
        );

        const receipt = await tx.wait();
        const event = receipt.logs.find(log => {
            try {
                const parsed = token.interface.parseLog(log);
                return parsed && parsed.name === "TransferRequested";
            } catch { return false; }
        });
        const requestId = token.interface.parseLog(event).args.requestId;

        // Process once
        await token.connect(rta).processTransferRequest(requestId, true);
        const bobBalance1 = await token.balanceOf(bob.address);
        expect(bobBalance1).to.equal(ethers.parseUnits("100", 10));

        console.log("        Bob balance after first process:", ethers.formatEther(bobBalance1));

        // Try to process again - THIS SHOULD FAIL WITH REVERT
        await expect(
            token.connect(rta).processTransferRequest(requestId, true)
        ).to.be.revertedWith("ERC1450: Request already finalized");

        const bobBalance2 = await token.balanceOf(bob.address);
        console.log("        Bob balance after failed replay attempt:", ethers.formatEther(bobBalance2));

        // Verify balance didn't change
        expect(bobBalance2).to.equal(bobBalance1);
        console.log("        ✅ Replay attack prevented - balance unchanged");
    });
});
