const { ethers } = require("hardhat");

async function main() {
    console.log("\n=== DEMO: Transfer Request Workflow ===\n");

    const [deployer, rta1, rta2, rta3, issuer, alice, bob] = await ethers.getSigners();

    // Deploy contracts
    const RTAProxy = await ethers.getContractFactory("RTAProxy");
    const rtaProxy = await RTAProxy.deploy([rta1.address, rta2.address, rta3.address], 2);
    await rtaProxy.waitForDeployment();

    const ERC1450 = await ethers.getContractFactory("ERC1450");
    const token = await ERC1450.deploy(
        "StartEngine Security Token",
        "SEST",
        18,
        issuer.address,
        rtaProxy.target
    );
    await token.waitForDeployment();

    // Deploy MockERC20 for fee token (simulating USDC)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const feeToken = await MockERC20.deploy("USD Coin", "USDC", 6);
    await feeToken.waitForDeployment();

    console.log("Token deployed to:", token.target);
    console.log("RTAProxy deployed to:", rtaProxy.target);
    console.log("Fee Token (USDC) deployed to:", feeToken.target);

    // First mint tokens to alice
    console.log("\n1. Minting initial tokens to Alice...");
    const mintData = token.interface.encodeFunctionData("mint", [
        alice.address,
        ethers.parseEther("10000")
    ]);

    await rtaProxy.connect(rta1).submitOperation(token.target, mintData, 0);
    await rtaProxy.connect(rta2).confirmOperation(0);
    console.log("   ✓ Minted 10,000 SEST to Alice");

    // Set up fee token (single fee token design)
    console.log("\n2. Setting up fee token...");
    const setFeeTokenData = token.interface.encodeFunctionData("setFeeToken", [feeToken.target]);
    await rtaProxy.connect(rta1).submitOperation(token.target, setFeeTokenData, 0);
    await rtaProxy.connect(rta2).confirmOperation(1);
    console.log("   ✓ Fee token set to USDC");

    // Set fee parameters (type, value)
    console.log("\n3. Setting up fee parameters...");
    const feeData = token.interface.encodeFunctionData("setFeeParameters", [
        1,   // percentage fee type
        50   // 0.5% (50 basis points)
    ]);

    await rtaProxy.connect(rta1).submitOperation(token.target, feeData, 0);
    await rtaProxy.connect(rta2).confirmOperation(2);
    console.log("   ✓ Fee set to 0.5% of transfer amount");

    // Alice requests a transfer to Bob
    console.log("\n4. Alice requests transfer to Bob...");
    const transferAmount = ethers.parseEther("1000");
    const feeAmount = await token.getTransferFee(alice.address, bob.address, transferAmount);

    console.log("   Transfer amount:", ethers.formatEther(transferAmount), "SEST");
    console.log("   Required fee:", ethers.formatUnits(feeAmount, 6), "USDC");

    // Mint fee tokens to Alice and approve
    await feeToken.mint(alice.address, feeAmount);
    await feeToken.connect(alice).approve(token.target, feeAmount);
    console.log("   ✓ Alice approved fee token spend");

    // Request transfer with fee (4 params: from, to, amount, feeAmount)
    const requestTx = await token.connect(alice).requestTransferWithFee(
        alice.address,
        bob.address,
        transferAmount,
        feeAmount
    );
    await requestTx.wait();

    console.log("   ✓ Transfer request #1 created");

    // Check request status
    const request = await token.transferRequests(1);
    console.log("\n5. Request Details:");
    console.log("   From:", request.from);
    console.log("   To:", request.to);
    console.log("   Amount:", ethers.formatEther(request.amount), "SEST");
    console.log("   Fee Paid:", ethers.formatUnits(request.feePaid, 6), "USDC");
    console.log("   Status:", ["Requested", "UnderReview", "Approved", "Rejected", "Executed"][request.status]);

    // RTA processes the request
    console.log("\n6. RTA reviews and approves transfer...");

    // Update status to UnderReview (optional)
    const reviewData = token.interface.encodeFunctionData("updateRequestStatus", [1, 1]); // UnderReview
    await rtaProxy.connect(rta1).submitOperation(token.target, reviewData, 0);
    await rtaProxy.connect(rta2).confirmOperation(3);
    console.log("   ✓ Status updated to: Under Review");

    // Process the transfer
    const processData = token.interface.encodeFunctionData("processTransferRequest", [1]);
    await rtaProxy.connect(rta1).submitOperation(token.target, processData, 0);
    await rtaProxy.connect(rta2).confirmOperation(4);
    console.log("   ✓ Transfer executed successfully!");

    // Check final balances
    console.log("\n7. Final Results:");
    console.log("   Alice balance:", ethers.formatEther(await token.balanceOf(alice.address)), "SEST");
    console.log("   Bob balance:", ethers.formatEther(await token.balanceOf(bob.address)), "SEST");
    console.log("   Fees collected:", ethers.formatUnits(await token.collectedFeesTotal(), 6), "USDC");

    // Final request status
    const finalRequest = await token.transferRequests(1);
    console.log("   Request status:", ["Requested", "UnderReview", "Approved", "Rejected", "Executed"][finalRequest.status]);

    // Demonstrate fee withdrawal (2 params: amount, recipient)
    console.log("\n8. RTA withdraws collected fees...");
    const withdrawData = token.interface.encodeFunctionData("withdrawFees", [
        feeAmount,
        rta1.address
    ]);

    await rtaProxy.connect(rta1).submitOperation(token.target, withdrawData, 0);
    await rtaProxy.connect(rta2).confirmOperation(5);
    console.log("   ✓ Fees withdrawn to RTA1");
    console.log("   RTA1 USDC balance:", ethers.formatUnits(await feeToken.balanceOf(rta1.address), 6), "USDC");

    console.log("\n✅ Transfer request workflow complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
