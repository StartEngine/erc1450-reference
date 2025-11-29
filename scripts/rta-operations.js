const { ethers } = require("hardhat");
const fs = require('fs');

// Load deployment addresses
function loadDeployment() {
    const network = hre.network.name;
    const deploymentFile = `deployment-${network}.json`;

    if (!fs.existsSync(deploymentFile)) {
        throw new Error(`No deployment found for network ${network}. Run 'npx hardhat run scripts/deploy.js' first.`);
    }

    return JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
}

async function mintTokens(to, amount) {
    console.log("\n=== MINTING TOKENS ===");
    const deployment = loadDeployment();
    const [, rta1, rta2] = await ethers.getSigners();

    const rtaProxy = await ethers.getContractAt("RTAProxy", deployment.contracts.RTAProxy);
    const token = await ethers.getContractAt("ERC1450", deployment.contracts.ERC1450);

    // Prepare mint data
    const mintData = token.interface.encodeFunctionData("mint", [to, amount]);

    // Submit operation
    console.log(`Minting ${ethers.formatEther(amount)} tokens to ${to}`);
    const submitTx = await rtaProxy.connect(rta1).submitOperation(
        token.target,
        mintData,
        0
    );
    const submitReceipt = await submitTx.wait();

    // Get operation ID from events
    const event = submitReceipt.logs.find(log =>
        log.topics[0] === ethers.id("OperationSubmitted(uint256,address)")
    );
    const operationId = ethers.toBigInt(event.topics[1]);

    console.log(`Operation #${operationId} submitted by ${rta1.address}`);

    // Second signature to execute
    console.log("Adding second signature to execute...");
    await rtaProxy.connect(rta2).confirmOperation(operationId);

    console.log(`✓ Minted ${ethers.formatEther(amount)} tokens to ${to}`);
    console.log(`  New balance: ${ethers.formatEther(await token.balanceOf(to))}`);
    console.log(`  Total supply: ${ethers.formatEther(await token.totalSupply())}`);
}

async function processTransferRequest(requestId) {
    console.log("\n=== PROCESSING TRANSFER REQUEST ===");
    const deployment = loadDeployment();
    const [, rta1, rta2] = await ethers.getSigners();

    const rtaProxy = await ethers.getContractAt("RTAProxy", deployment.contracts.RTAProxy);
    const token = await ethers.getContractAt("ERC1450", deployment.contracts.ERC1450);

    // Get request details
    const request = await token.transferRequests(requestId);
    console.log(`Processing request #${requestId}:`);
    console.log(`  From: ${request.from}`);
    console.log(`  To: ${request.to}`);
    console.log(`  Amount: ${ethers.formatEther(request.amount)}`);

    // Prepare process data
    const processData = token.interface.encodeFunctionData("processTransferRequest", [requestId]);

    // Submit operation
    const submitTx = await rtaProxy.connect(rta1).submitOperation(
        token.target,
        processData,
        0
    );
    const submitReceipt = await submitTx.wait();

    const event = submitReceipt.logs.find(log =>
        log.topics[0] === ethers.id("OperationSubmitted(uint256,address)")
    );
    const operationId = ethers.toBigInt(event.topics[1]);

    console.log(`Operation #${operationId} submitted`);

    // Second signature to execute
    await rtaProxy.connect(rta2).confirmOperation(operationId);

    console.log(`✓ Transfer request #${requestId} processed successfully`);
}

async function setBrokerStatus(brokerAddress, approved) {
    console.log("\n=== UPDATING BROKER STATUS ===");
    const deployment = loadDeployment();
    const [, rta1, rta2] = await ethers.getSigners();

    const rtaProxy = await ethers.getContractAt("RTAProxy", deployment.contracts.RTAProxy);
    const token = await ethers.getContractAt("ERC1450", deployment.contracts.ERC1450);

    // Prepare broker status data
    const brokerData = token.interface.encodeFunctionData("setBrokerStatus", [brokerAddress, approved]);

    console.log(`${approved ? 'Approving' : 'Revoking'} broker: ${brokerAddress}`);

    // Submit operation
    const submitTx = await rtaProxy.connect(rta1).submitOperation(
        token.target,
        brokerData,
        0
    );
    const submitReceipt = await submitTx.wait();

    const event = submitReceipt.logs.find(log =>
        log.topics[0] === ethers.id("OperationSubmitted(uint256,address)")
    );
    const operationId = ethers.toBigInt(event.topics[1]);

    // Second signature to execute
    await rtaProxy.connect(rta2).confirmOperation(operationId);

    console.log(`✓ Broker status updated`);
    console.log(`  ${brokerAddress} is ${approved ? 'now approved' : 'no longer approved'}`);
}

async function freezeAccount(account, frozen) {
    console.log("\n=== UPDATING ACCOUNT FREEZE STATUS ===");
    const deployment = loadDeployment();
    const [, rta1, rta2] = await ethers.getSigners();

    const rtaProxy = await ethers.getContractAt("RTAProxy", deployment.contracts.RTAProxy);
    const token = await ethers.getContractAt("ERC1450", deployment.contracts.ERC1450);

    // Prepare freeze data
    const freezeData = token.interface.encodeFunctionData("setAccountFrozen", [account, frozen]);

    console.log(`${frozen ? 'Freezing' : 'Unfreezing'} account: ${account}`);

    // Submit operation
    const submitTx = await rtaProxy.connect(rta1).submitOperation(
        token.target,
        freezeData,
        0
    );
    const submitReceipt = await submitTx.wait();

    const event = submitReceipt.logs.find(log =>
        log.topics[0] === ethers.id("OperationSubmitted(uint256,address)")
    );
    const operationId = ethers.toBigInt(event.topics[1]);

    // Second signature to execute
    await rtaProxy.connect(rta2).confirmOperation(operationId);

    console.log(`✓ Account ${account} is now ${frozen ? 'frozen' : 'unfrozen'}`);
}

async function controllerTransfer(from, to, amount, documentHash, operationType = "COURT_ORDER") {
    console.log("\n=== EXECUTING CONTROLLER TRANSFER (ERC-1644) ===");
    const deployment = loadDeployment();
    const [, rta1, rta2] = await ethers.getSigners();

    const rtaProxy = await ethers.getContractAt("RTAProxy", deployment.contracts.RTAProxy);
    const token = await ethers.getContractAt("ERC1450", deployment.contracts.ERC1450);

    // Prepare controller transfer data (ERC-1644 compatible)
    const data = documentHash; // Document hash as bytes
    const operatorData = ethers.toUtf8Bytes(operationType);

    const controllerData = token.interface.encodeFunctionData("controllerTransfer", [
        from,
        to,
        amount,
        data,
        operatorData
    ]);

    console.log("Executing controller transfer:");
    console.log(`  From: ${from}`);
    console.log(`  To: ${to}`);
    console.log(`  Amount: ${ethers.formatEther(amount)}`);
    console.log(`  Data (document hash): ${documentHash}`);
    console.log(`  Operation type: ${operationType}`);

    // Submit operation
    const submitTx = await rtaProxy.connect(rta1).submitOperation(
        token.target,
        controllerData,
        0
    );
    const submitReceipt = await submitTx.wait();

    const event = submitReceipt.logs.find(log =>
        log.topics[0] === ethers.id("OperationSubmitted(uint256,address)")
    );
    const operationId = ethers.toBigInt(event.topics[1]);

    // Second signature to execute
    await rtaProxy.connect(rta2).confirmOperation(operationId);

    console.log(`✓ Controller transfer executed successfully`);
}

async function getTokenInfo() {
    console.log("\n=== TOKEN INFORMATION ===");
    const deployment = loadDeployment();
    const token = await ethers.getContractAt("ERC1450", deployment.contracts.ERC1450);

    console.log("Token Details:");
    console.log(`  Name: ${await token.name()}`);
    console.log(`  Symbol: ${await token.symbol()}`);
    console.log(`  Decimals: ${await token.decimals()}`);
    console.log(`  Total Supply: ${ethers.formatEther(await token.totalSupply())}`);
    console.log(`  Transfer Agent: ${await token.isTransferAgent(deployment.contracts.RTAProxy) ? deployment.contracts.RTAProxy : 'Unknown'}`);
    console.log(`  Contract Address: ${token.target}`);

    // Get fee information
    const [feeAmount, acceptedTokens] = await token.getTransferFee(
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.parseEther("1000")
    );

    console.log("\nFee Configuration:");
    console.log(`  Fee Type: ${await token.feeType()} (0=flat, 1=percentage, 2=tiered)`);
    console.log(`  Fee Value: ${await token.feeValue()}`);
    console.log(`  Sample fee for 1000 tokens: ${ethers.formatEther(feeAmount)}`);
    console.log(`  Accepted tokens: ${acceptedTokens.join(', ')}`);
}

// Command-line interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    try {
        switch (command) {
            case 'mint':
                if (args.length < 3) {
                    console.log("Usage: npx hardhat run scripts/rta-operations.js mint <to> <amount>");
                    process.exit(1);
                }
                await mintTokens(args[1], ethers.parseEther(args[2]));
                break;

            case 'process-transfer':
                if (args.length < 2) {
                    console.log("Usage: npx hardhat run scripts/rta-operations.js process-transfer <requestId>");
                    process.exit(1);
                }
                await processTransferRequest(args[1]);
                break;

            case 'set-broker':
                if (args.length < 3) {
                    console.log("Usage: npx hardhat run scripts/rta-operations.js set-broker <address> <true/false>");
                    process.exit(1);
                }
                await setBrokerStatus(args[1], args[2] === 'true');
                break;

            case 'freeze':
                if (args.length < 3) {
                    console.log("Usage: npx hardhat run scripts/rta-operations.js freeze <account> <true/false>");
                    process.exit(1);
                }
                await freezeAccount(args[1], args[2] === 'true');
                break;

            case 'court-order':
            case 'controller-transfer':
                if (args.length < 5) {
                    console.log("Usage: npx hardhat run scripts/rta-operations.js controller-transfer <from> <to> <amount> <documentHash> [operationType]");
                    process.exit(1);
                }
                await controllerTransfer(args[1], args[2], ethers.parseEther(args[3]), args[4], args[5] || "COURT_ORDER");
                break;

            case 'info':
                await getTokenInfo();
                break;

            default:
                console.log("ERC-1450 RTA Operations");
                console.log("=======================");
                console.log("\nCommands:");
                console.log("  info                                    - Display token information");
                console.log("  mint <to> <amount>                     - Mint tokens to address");
                console.log("  process-transfer <requestId>            - Process a transfer request");
                console.log("  set-broker <address> <true/false>      - Approve/revoke broker");
                console.log("  freeze <account> <true/false>          - Freeze/unfreeze account");
                console.log("  controller-transfer <from> <to> <amount> <hash> [type] - Execute controller transfer (ERC-1644)");
                console.log("\nExample:");
                console.log("  npx hardhat run scripts/rta-operations.js mint 0x123... 1000");
        }
    } catch (error) {
        console.error("Error:", error.message);
        process.exit(1);
    }
}

// Only run main if this is the script being executed
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

// Export functions for use in other scripts
module.exports = {
    mintTokens,
    processTransferRequest,
    setBrokerStatus,
    freezeAccount,
    controllerTransfer,
    getTokenInfo
};