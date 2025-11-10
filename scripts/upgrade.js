const { ethers, upgrades } = require("hardhat");
const fs = require('fs');
const path = require('path');

/**
 * Upgrade Script for ERC-1450 Upgradeable Contracts
 *
 * This script handles upgrading either the RTAProxyUpgradeable or ERC1450Upgradeable contracts.
 *
 * Usage:
 *   npx hardhat run scripts/upgrade.js --network [network]
 *
 * The script will prompt you to select which contract to upgrade.
 *
 * IMPORTANT SECURITY NOTES:
 * 1. RTAProxyUpgradeable upgrades require multi-sig approval
 * 2. ERC1450Upgradeable upgrades can only be authorized by the RTA
 * 3. Always test upgrades on testnet first
 * 4. Ensure the new implementation is thoroughly audited
 */

async function main() {
    console.log("ERC-1450 Contract Upgrade Script\n");
    console.log("⚠️  WARNING: This script will upgrade deployed contracts!");
    console.log("⚠️  Ensure you have tested the upgrade on a testnet first!\n");

    // Load deployment information
    const deploymentFile = `deployment-upgradeable-${network.name}.json`;

    if (!fs.existsSync(deploymentFile)) {
        console.error(`❌ Deployment file ${deploymentFile} not found!`);
        console.error("Please run the deployment script first.");
        process.exit(1);
    }

    const deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
    console.log(`📄 Loaded deployment from ${deploymentFile}`);
    console.log(`🌐 Network: ${deployment.network}`);
    console.log(`📅 Deployed at: ${deployment.deployedAt}\n`);

    // Get signers
    const [deployer, rta1, rta2, rta3] = await ethers.getSigners();
    console.log("Upgrading with account:", deployer.address);
    console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

    // Select contract to upgrade
    console.log("\nWhich contract would you like to upgrade?");
    console.log("1. RTAProxyUpgradeable");
    console.log("2. ERC1450Upgradeable");
    console.log("3. Exit");

    // For automation, you can set CONTRACT_TO_UPGRADE environment variable
    const selection = process.env.CONTRACT_TO_UPGRADE || "3";

    if (selection === "1") {
        await upgradeRTAProxy(deployment, rta1);
    } else if (selection === "2") {
        await upgradeERC1450(deployment, rta1);
    } else {
        console.log("Exiting without upgrade.");
        process.exit(0);
    }
}

async function upgradeRTAProxy(deployment, rtaSigner) {
    console.log("\n=== Upgrading RTAProxyUpgradeable ===\n");

    const proxyAddress = deployment.contracts.RTAProxyUpgradeable.proxy;
    const currentImpl = deployment.contracts.RTAProxyUpgradeable.implementation;

    console.log("Current proxy address:", proxyAddress);
    console.log("Current implementation:", currentImpl);

    // Get the existing contract instance
    const RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
    const rtaProxy = RTAProxyUpgradeable.attach(proxyAddress);

    // For RTAProxy upgrades, we need multi-sig approval
    console.log("\n📝 Creating upgrade operation for multi-sig approval...");

    // Prepare the new implementation (you would have a new version of the contract)
    // For this example, we'll validate the upgrade without actually deploying
    console.log("Validating upgrade compatibility...");

    try {
        await upgrades.validateUpgrade(
            proxyAddress,
            RTAProxyUpgradeable,
            { kind: 'uups' }
        );
        console.log("✅ Upgrade validation passed!");
    } catch (error) {
        console.error("❌ Upgrade validation failed:", error.message);
        process.exit(1);
    }

    // Prepare the new implementation
    console.log("\nPreparing new implementation...");
    const newImplementation = await upgrades.prepareUpgrade(
        proxyAddress,
        RTAProxyUpgradeable,
        { kind: 'uups' }
    );

    console.log("New implementation prepared at:", newImplementation);

    // Submit upgrade operation through multi-sig
    console.log("\n🔐 Submitting upgrade operation to multi-sig...");

    const tx = await rtaProxy.connect(rtaSigner).submitUpgradeOperation(newImplementation);
    const receipt = await tx.wait();

    // Find the OperationSubmitted event
    const event = receipt.logs.find(log => {
        try {
            const parsed = rtaProxy.interface.parseLog(log);
            return parsed.name === 'OperationSubmitted';
        } catch {
            return false;
        }
    });

    if (event) {
        const parsedEvent = rtaProxy.interface.parseLog(event);
        const operationId = parsedEvent.args[0];
        console.log(`✅ Upgrade operation submitted! Operation ID: ${operationId}`);
        console.log("\n⚠️  NEXT STEPS:");
        console.log("1. Have other RTA signers confirm the operation");
        console.log(`2. Once enough signatures are collected, the upgrade will execute`);
        console.log(`3. Monitor operation ID ${operationId} for completion`);
    }

    // Save upgrade information
    const upgradeInfo = {
        contract: "RTAProxyUpgradeable",
        proxyAddress,
        oldImplementation: currentImpl,
        newImplementation,
        operationId: event ? rtaProxy.interface.parseLog(event).args[0].toString() : "unknown",
        initiatedBy: rtaSigner.address,
        timestamp: new Date().toISOString(),
        network: network.name,
        status: "pending_multisig"
    };

    const upgradeFile = `upgrade-${network.name}-${Date.now()}.json`;
    fs.writeFileSync(upgradeFile, JSON.stringify(upgradeInfo, null, 2));
    console.log(`\n📄 Upgrade information saved to ${upgradeFile}`);
}

async function upgradeERC1450(deployment, rtaSigner) {
    console.log("\n=== Upgrading ERC1450Upgradeable ===\n");

    const proxyAddress = deployment.contracts.ERC1450Upgradeable.proxy;
    const rtaProxyAddress = deployment.contracts.RTAProxyUpgradeable.proxy;
    const currentImpl = deployment.contracts.ERC1450Upgradeable.implementation;

    console.log("Current proxy address:", proxyAddress);
    console.log("Current implementation:", currentImpl);
    console.log("RTA Proxy address:", rtaProxyAddress);

    // Get contract instances
    const ERC1450Upgradeable = await ethers.getContractFactory("ERC1450Upgradeable");
    const RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");

    const token = ERC1450Upgradeable.attach(proxyAddress);
    const rtaProxy = RTAProxyUpgradeable.attach(rtaProxyAddress);

    // Validate the upgrade
    console.log("\nValidating upgrade compatibility...");

    try {
        await upgrades.validateUpgrade(
            proxyAddress,
            ERC1450Upgradeable,
            { kind: 'uups' }
        );
        console.log("✅ Upgrade validation passed!");
    } catch (error) {
        console.error("❌ Upgrade validation failed:", error.message);
        process.exit(1);
    }

    // Prepare the new implementation
    console.log("\nPreparing new implementation...");
    const newImplementation = await upgrades.prepareUpgrade(
        proxyAddress,
        ERC1450Upgradeable,
        { kind: 'uups' }
    );

    console.log("New implementation prepared at:", newImplementation);

    // For ERC1450, the upgrade must go through the RTA (multi-sig)
    console.log("\n🔐 Creating upgrade operation through RTA multi-sig...");

    // Encode the upgrade call
    const upgradeData = token.interface.encodeFunctionData(
        "upgradeToAndCall",
        [newImplementation, "0x"] // Empty bytes for no initialization
    );

    // Submit through RTAProxy multi-sig
    const tx = await rtaProxy.connect(rtaSigner).submitOperation(
        proxyAddress,
        upgradeData,
        0
    );
    const receipt = await tx.wait();

    // Find the OperationSubmitted event
    const event = receipt.logs.find(log => {
        try {
            const parsed = rtaProxy.interface.parseLog(log);
            return parsed.name === 'OperationSubmitted';
        } catch {
            return false;
        }
    });

    if (event) {
        const parsedEvent = rtaProxy.interface.parseLog(event);
        const operationId = parsedEvent.args[0];
        console.log(`✅ Upgrade operation submitted! Operation ID: ${operationId}`);
        console.log("\n⚠️  NEXT STEPS:");
        console.log("1. Have other RTA signers confirm the operation");
        console.log(`2. Once enough signatures are collected, the upgrade will execute`);
        console.log(`3. The ERC1450 token will be upgraded to the new implementation`);
        console.log(`4. Monitor operation ID ${operationId} for completion`);
    }

    // Save upgrade information
    const upgradeInfo = {
        contract: "ERC1450Upgradeable",
        proxyAddress,
        oldImplementation: currentImpl,
        newImplementation,
        rtaProxyAddress,
        operationId: event ? rtaProxy.interface.parseLog(event).args[0].toString() : "unknown",
        initiatedBy: rtaSigner.address,
        timestamp: new Date().toISOString(),
        network: network.name,
        status: "pending_multisig"
    };

    const upgradeFile = `upgrade-${network.name}-${Date.now()}.json`;
    fs.writeFileSync(upgradeFile, JSON.stringify(upgradeInfo, null, 2));
    console.log(`\n📄 Upgrade information saved to ${upgradeFile}`);
}

// Helper function to check upgrade status
async function checkUpgradeStatus(upgradeFile) {
    if (!fs.existsSync(upgradeFile)) {
        console.error("Upgrade file not found!");
        return;
    }

    const upgradeInfo = JSON.parse(fs.readFileSync(upgradeFile, 'utf8'));

    console.log("\n=== Upgrade Status ===");
    console.log("Contract:", upgradeInfo.contract);
    console.log("Operation ID:", upgradeInfo.operationId);
    console.log("Status:", upgradeInfo.status);

    // Connect to RTAProxy to check operation status
    const deploymentFile = `deployment-upgradeable-${network.name}.json`;
    const deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));

    const RTAProxyUpgradeable = await ethers.getContractFactory("RTAProxyUpgradeable");
    const rtaProxy = RTAProxyUpgradeable.attach(deployment.contracts.RTAProxyUpgradeable.proxy);

    const operation = await rtaProxy.getOperation(upgradeInfo.operationId);
    console.log("Confirmations:", operation.confirmations.toString());
    console.log("Executed:", operation.executed);

    if (operation.executed) {
        console.log("✅ Upgrade completed successfully!");

        // Update the deployment file with new implementation
        if (upgradeInfo.contract === "RTAProxyUpgradeable") {
            deployment.contracts.RTAProxyUpgradeable.implementation = upgradeInfo.newImplementation;
        } else {
            deployment.contracts.ERC1450Upgradeable.implementation = upgradeInfo.newImplementation;
        }

        fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
        console.log("📄 Deployment file updated with new implementation");
    }
}

// Export for use in other scripts
module.exports = {
    upgradeRTAProxy,
    upgradeERC1450,
    checkUpgradeStatus
};

// Run the main function if called directly
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}