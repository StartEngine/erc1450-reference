const { ethers } = require("hardhat");

async function main() {
    console.log("\n=== DEMO: Minting Tokens ===\n");

    const [deployer, rta1, rta2, rta3, issuer] = await ethers.getSigners();

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

    console.log("Token deployed to:", token.target);
    console.log("RTAProxy deployed to:", rtaProxy.target);

    // Mint tokens
    const mintAmount = ethers.parseEther("1000000");
    const recipient = issuer.address;

    console.log(`\nMinting ${ethers.formatEther(mintAmount)} SEST tokens to ${recipient}`);

    // Prepare mint data
    const mintData = token.interface.encodeFunctionData("mint", [recipient, mintAmount]);

    // Submit operation (first signature)
    console.log("\n1. Submitting mint operation...");
    const submitTx = await rtaProxy.connect(rta1).submitOperation(
        token.target,
        mintData,
        0
    );
    const receipt = await submitTx.wait();
    console.log("   ✓ Operation #0 submitted by", rta1.address);

    // Get operation details
    const op = await rtaProxy.getOperation(0);
    console.log("   Confirmations: 1 of 2");
    console.log("   Status: Pending execution");

    // Confirm operation (second signature - auto-executes)
    console.log("\n2. Adding second signature...");
    await rtaProxy.connect(rta2).confirmOperation(0);
    console.log("   ✓ Operation confirmed by", rta2.address);
    console.log("   ✓ Operation executed automatically!");

    // Check results
    console.log("\n=== Results ===");
    console.log("Total Supply:", ethers.formatEther(await token.totalSupply()), "SEST");
    console.log("Recipient Balance:", ethers.formatEther(await token.balanceOf(recipient)), "SEST");

    // Verify operation is executed
    const finalOp = await rtaProxy.getOperation(0);
    console.log("Operation Status: Executed =", finalOp[4]);

    console.log("\n✅ Minting successful!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });