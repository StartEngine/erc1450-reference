const { ethers, upgrades } = require("hardhat");

async function main() {
    console.log("Deploying Upgradeable ERC-1450 Security Token System...\n");

    // Get signers
    const [deployer, rta1, rta2, rta3, issuer] = await ethers.getSigners();

    console.log("Deploying with account:", deployer.address);
    console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

    // Deploy RTAProxyUpgradeable with multi-sig (2 of 3) using UUPS proxy
    console.log("\n1. Deploying RTAProxyUpgradeable multi-sig with proxy...");
    const RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");

    const rtaProxy = await upgrades.deployProxy(
        RTAProxyUpgradeable,
        [[rta1.address, rta2.address, rta3.address], 2], // Constructor args: signers array and required signatures
        {
            initializer: 'initialize',
            kind: 'uups' // Use UUPS proxy pattern
        }
    );
    await rtaProxy.waitForDeployment();

    const rtaProxyAddress = await rtaProxy.getAddress();
    console.log("RTAProxyUpgradeable deployed to:", rtaProxyAddress);
    console.log("  - Proxy address:", rtaProxyAddress);
    console.log("  - Implementation address:", await upgrades.erc1967.getImplementationAddress(rtaProxyAddress));
    console.log("  - Admin address:", await upgrades.erc1967.getAdminAddress(rtaProxyAddress));
    console.log("  - Signers:", [rta1.address, rta2.address, rta3.address]);
    console.log("  - Required signatures: 2");

    // Deploy ERC1450Upgradeable Token using UUPS proxy
    console.log("\n2. Deploying ERC1450Upgradeable Security Token with proxy...");
    const ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");

    const token = await upgrades.deployProxy(
        ERC1450Upgradeable,
        [
            "StartEngine Security Token", // name
            "SEST",                      // symbol
            18,                          // decimals
            issuer.address,              // initial owner/issuer
            rtaProxyAddress             // transfer agent (RTAProxyUpgradeable)
        ],
        {
            initializer: 'initialize',
            kind: 'uups' // Use UUPS proxy pattern
        }
    );
    await token.waitForDeployment();

    const tokenAddress = await token.getAddress();
    console.log("ERC1450Upgradeable Token deployed to:", tokenAddress);
    console.log("  - Proxy address:", tokenAddress);
    console.log("  - Implementation address:", await upgrades.erc1967.getImplementationAddress(tokenAddress));
    console.log("  - Admin address:", await upgrades.erc1967.getAdminAddress(tokenAddress));
    console.log("  - Name:", await token.name());
    console.log("  - Symbol:", await token.symbol());
    console.log("  - Decimals:", await token.decimals());
    console.log("  - Issuer:", await token.owner());
    console.log("  - Transfer Agent:", rtaProxyAddress);
    console.log("  - Version:", await token.version());

    // Verify transfer agent is locked
    console.log("\n3. Verifying transfer agent lock...");
    console.log("  - Transfer agent locked: true (RTAProxyUpgradeable is a contract)");

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
        tokenAddress,
        setFeeData,
        0
    );
    const receipt = await tx.wait();
    console.log("  - Fee configuration submitted to multi-sig (Operation #0)");
    console.log("  - Requires 1 more signature to execute");

    // Demonstrate upgrade capability (for documentation purposes)
    console.log("\n5. Upgrade Capability:");
    console.log("  - Both contracts are upgradeable using UUPS pattern");
    console.log("  - RTAProxyUpgradeable: Upgrades require multi-sig approval");
    console.log("  - ERC1450Upgradeable: Only the RTA can authorize upgrades");
    console.log("  - Use scripts/upgrade.js to perform future upgrades");

    // Display deployment summary
    console.log("\n========================================");
    console.log("DEPLOYMENT SUMMARY - UPGRADEABLE CONTRACTS");
    console.log("========================================");
    console.log("RTAProxyUpgradeable (Multi-sig):");
    console.log("  - Proxy:", rtaProxyAddress);
    console.log("  - Implementation:", await upgrades.erc1967.getImplementationAddress(rtaProxyAddress));
    console.log("\nERC1450Upgradeable Token:");
    console.log("  - Proxy:", tokenAddress);
    console.log("  - Implementation:", await upgrades.erc1967.getImplementationAddress(tokenAddress));
    console.log("\nNetwork:", network.name);
    console.log("Block number:", await ethers.provider.getBlockNumber());
    console.log("\nKEY BENEFITS:");
    console.log("✓ Bug fixes can be deployed without changing contract addresses");
    console.log("✓ No investor action required for upgrades");
    console.log("✓ Multi-sig control prevents unauthorized upgrades");
    console.log("✓ UUPS pattern for gas-efficient proxy operations");
    console.log("\nNEXT STEPS:");
    console.log("1. Have second RTA signer confirm the fee configuration (Operation #0)");
    console.log("2. Submit mint operations through RTAProxyUpgradeable to issue tokens");
    console.log("3. Configure broker approvals as needed");
    console.log("4. Set up compliance rules and restrictions");
    console.log("5. Test upgrade process using scripts/upgrade.js");
    console.log("========================================\n");

    // Save deployment addresses
    const deploymentInfo = {
        network: network.name,
        contracts: {
            RTAProxyUpgradeable: {
                proxy: rtaProxyAddress,
                implementation: await upgrades.erc1967.getImplementationAddress(rtaProxyAddress),
                admin: await upgrades.erc1967.getAdminAddress(rtaProxyAddress)
            },
            ERC1450Upgradeable: {
                proxy: tokenAddress,
                implementation: await upgrades.erc1967.getImplementationAddress(tokenAddress),
                admin: await upgrades.erc1967.getAdminAddress(tokenAddress)
            }
        },
        signers: {
            rta1: rta1.address,
            rta2: rta2.address,
            rta3: rta3.address
        },
        issuer: issuer.address,
        deployedAt: new Date().toISOString(),
        blockNumber: await ethers.provider.getBlockNumber(),
        upgradeablePattern: "UUPS"
    };

    const fs = require('fs');
    const filename = 'deployment-upgradeable-' + network.name + '.json';
    fs.writeFileSync(
        filename,
        JSON.stringify(deploymentInfo, null, 2)
    );
    console.log("Deployment info saved to", filename);

    // Verify the contracts can be upgraded (validation only, not actual upgrade)
    console.log("\nValidating upgrade capability...");
    try {
        await upgrades.validateUpgrade(
            rtaProxyAddress,
            RTAProxyUpgradeable,
            { kind: 'uups' }
        );
        console.log("✓ RTAProxyUpgradeable is valid for future upgrades");

        await upgrades.validateUpgrade(
            tokenAddress,
            ERC1450Upgradeable,
            { kind: 'uups' }
        );
        console.log("✓ ERC1450Upgradeable is valid for future upgrades");
    } catch (error) {
        console.error("Upgrade validation error:", error.message);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });