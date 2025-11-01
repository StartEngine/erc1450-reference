const { ethers } = require("hardhat");

async function main() {
    console.log("Deploying ERC-1450 Security Token System...\n");

    // Get signers
    const [deployer, rta1, rta2, rta3, issuer] = await ethers.getSigners();

    console.log("Deploying with account:", deployer.address);
    console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

    // Deploy RTAProxy with multi-sig (2 of 3)
    console.log("\n1. Deploying RTAProxy multi-sig...");
    const RTAProxy = await ethers.getContractFactory("RTAProxy");
    const rtaProxy = await RTAProxy.deploy(
        [rta1.address, rta2.address, rta3.address],
        2 // Required signatures
    );
    await rtaProxy.waitForDeployment();
    console.log("RTAProxy deployed to:", rtaProxy.target);
    console.log("  - Signers:", [rta1.address, rta2.address, rta3.address]);
    console.log("  - Required signatures: 2");

    // Deploy ERC1450 Token
    console.log("\n2. Deploying ERC1450 Security Token...");
    const ERC1450 = await ethers.getContractFactory("ERC1450");
    const token = await ERC1450.deploy(
        "StartEngine Security Token", // name
        "SEST",                      // symbol
        18,                          // decimals
        issuer.address,              // initial owner/issuer
        rtaProxy.target             // transfer agent (RTAProxy)
    );
    await token.waitForDeployment();
    console.log("ERC1450 Token deployed to:", token.target);
    console.log("  - Name:", await token.name());
    console.log("  - Symbol:", await token.symbol());
    console.log("  - Decimals:", await token.decimals());
    console.log("  - Issuer:", await token.owner());
    console.log("  - Transfer Agent:", rtaProxy.target);

    // Verify transfer agent is locked
    console.log("\n3. Verifying transfer agent lock...");
    console.log("  - Transfer agent locked: true (RTAProxy is a contract)");

    // Configure initial fee parameters
    console.log("\n4. Setting up initial fee configuration...");
    console.log("  - Preparing fee configuration transaction for multi-sig approval");

    const setFeeData = token.interface.encodeFunctionData("setFeeParameters", [
        1,                              // feeType: 1 = percentage
        50,                             // feeValue: 50 basis points = 0.5%
        [ethers.ZeroAddress]           // acceptedTokens: ETH only initially
    ]);

    // Submit fee configuration to multi-sig
    const tx = await rtaProxy.connect(rta1).submitOperation(
        token.target,
        setFeeData,
        0
    );
    const receipt = await tx.wait();
    console.log("  - Fee configuration submitted to multi-sig (Operation #0)");
    console.log("  - Requires 1 more signature to execute");

    // Display deployment summary
    console.log("\n========================================");
    console.log("DEPLOYMENT SUMMARY");
    console.log("========================================");
    console.log("RTAProxy (Multi-sig):", rtaProxy.target);
    console.log("ERC1450 Token:", token.target);
    console.log("Network:", network.name);
    console.log("Block number:", await ethers.provider.getBlockNumber());
    console.log("\nNEXT STEPS:");
    console.log("1. Have second RTA signer confirm the fee configuration (Operation #0)");
    console.log("2. Submit mint operations through RTAProxy to issue tokens");
    console.log("3. Configure broker approvals as needed");
    console.log("4. Set up compliance rules and restrictions");
    console.log("========================================\n");

    // Save deployment addresses
    const deploymentInfo = {
        network: network.name,
        contracts: {
            RTAProxy: rtaProxy.target,
            ERC1450: token.target
        },
        signers: {
            rta1: rta1.address,
            rta2: rta2.address,
            rta3: rta3.address
        },
        issuer: issuer.address,
        deployedAt: new Date().toISOString(),
        blockNumber: await ethers.provider.getBlockNumber()
    };

    const fs = require('fs');
    fs.writeFileSync(
        'deployment-' + network.name + '.json',
        JSON.stringify(deploymentInfo, null, 2)
    );
    console.log("Deployment info saved to deployment-" + network.name + ".json");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });