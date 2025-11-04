const { ethers } = require("hardhat");

async function main() {
    console.log("\n=== ERC-1450 TOKEN INFORMATION ===\n");

    // Deploy fresh contracts for demo
    const [deployer, rta1, rta2, rta3, issuer] = await ethers.getSigners();

    // Deploy RTAProxy
    const RTAProxy = await ethers.getContractFactory("RTAProxy");
    const rtaProxy = await RTAProxy.deploy(
        [rta1.address, rta2.address, rta3.address],
        2
    );
    await rtaProxy.waitForDeployment();

    // Deploy ERC1450 Token
    const ERC1450 = await ethers.getContractFactory("ERC1450");
    const token = await ERC1450.deploy(
        "StartEngine Security Token",
        "SEST",
        18,
        issuer.address,
        rtaProxy.target
    );
    await token.waitForDeployment();

    console.log("Token Details:");
    console.log("  Name:", await token.name());
    console.log("  Symbol:", await token.symbol());
    console.log("  Decimals:", await token.decimals());
    console.log("  Total Supply:", ethers.formatEther(await token.totalSupply()));
    console.log("  Contract Address:", token.target);
    console.log("  Issuer:", await token.owner());
    console.log("  Transfer Agent:", rtaProxy.target);
    console.log("  Is Security Token:", await token.isSecurityToken());

    // Fee information
    const acceptedTokens = await token.getAcceptedFeeTokens();
    const feeAmount = await token.getTransferFee(
        ethers.ZeroAddress,
        ethers.ZeroAddress,
        ethers.parseEther("1000"),
        ethers.ZeroAddress  // Check fee for native token
    );

    console.log("\nFee Configuration:");
    console.log("  Fee Type:", await token.feeType(), "(0=flat, 1=percentage, 2=tiered)");
    console.log("  Fee Value:", await token.feeValue());
    console.log("  Sample fee for 1000 tokens:", ethers.formatEther(feeAmount));
    console.log("  Accepted fee tokens:", acceptedTokens.map(t => t === ethers.ZeroAddress ? "ETH" : t).join(', '));

    // Interface support
    console.log("\nSupported Interfaces (ERC-165):");
    console.log("  IERC1450 (0xaf175dee):", await token.supportsInterface("0xaf175dee"));
    console.log("  IERC20 (0x36372b07):", await token.supportsInterface("0x36372b07"));
    console.log("  IERC20Metadata (0xa219a025):", await token.supportsInterface("0xa219a025"));
    console.log("  IERC165 (0x01ffc9a7):", await token.supportsInterface("0x01ffc9a7"));

    // RTAProxy info
    console.log("\nRTAProxy Multi-Sig:");
    console.log("  Contract Address:", rtaProxy.target);
    console.log("  Required Signatures:", await rtaProxy.requiredSignatures());
    const signers = await rtaProxy.getSigners();
    console.log("  Signers:", signers.length);
    signers.forEach((signer, i) => {
        console.log(`    ${i + 1}. ${signer}`);
    });

    console.log("\n=== DEMO: Minting Tokens ===\n");

    // Demo mint operation through multi-sig
    const mintAmount = ethers.parseEther("1000000");
    const mintData = token.interface.encodeFunctionData("mint", [
        issuer.address,
        mintAmount
    ]);

    console.log("Submitting mint operation for 1,000,000 SEST tokens...");

    // First signer submits
    const submitTx = await rtaProxy.connect(rta1).submitOperation(
        token.target,
        mintData,
        0
    );
    await submitTx.wait();
    console.log("  ✓ Operation submitted by signer 1");

    // Second signer confirms (auto-executes)
    await rtaProxy.connect(rta2).confirmOperation(0);
    console.log("  ✓ Operation confirmed by signer 2 (executed)");

    console.log("\nUpdated Token Supply:", ethers.formatEther(await token.totalSupply()), "SEST");
    console.log("Issuer Balance:", ethers.formatEther(await token.balanceOf(issuer.address)), "SEST");

    console.log("\n=== DEMO: Transfer Request ===\n");

    // Demo transfer request
    const transferAmount = ethers.parseEther("100");
    console.log("Creating transfer request from issuer to", rta3.address);

    const requestTx = await token.connect(issuer).requestTransferWithFee(
        issuer.address,
        rta3.address,
        transferAmount,
        ethers.ZeroAddress,
        0
    );
    await requestTx.wait();
    console.log("  ✓ Transfer request #1 created");

    // Get request details
    const request = await token.transferRequests(1);
    console.log("\nRequest Details:");
    console.log("  From:", request.from);
    console.log("  To:", request.to);
    console.log("  Amount:", ethers.formatEther(request.amount), "SEST");
    console.log("  Status:", ["Requested", "UnderReview", "Approved", "Rejected", "Executed", "Expired"][request.status]);

    // Process the request through multi-sig
    const processData = token.interface.encodeFunctionData("processTransferRequest", [1]);

    await rtaProxy.connect(rta1).submitOperation(token.target, processData, 0);
    console.log("\n  ✓ Process operation submitted");

    await rtaProxy.connect(rta2).confirmOperation(1);
    console.log("  ✓ Transfer executed");

    console.log("\nFinal Balances:");
    console.log("  Issuer:", ethers.formatEther(await token.balanceOf(issuer.address)), "SEST");
    console.log("  Recipient:", ethers.formatEther(await token.balanceOf(rta3.address)), "SEST");

    console.log("\n========================================");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });