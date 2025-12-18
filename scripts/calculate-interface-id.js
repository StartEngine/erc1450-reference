const { ethers } = require("hardhat");

async function main() {
    // Get signers
    const [owner] = await ethers.getSigners();

    // Get the IERC1450 interface
    const IERC1450 = await ethers.getContractFactory("ERC1450");
    const token = await IERC1450.deploy(
        "Test",
        "TEST",
        18,
        owner.address,
        owner.address
    );
    await token.waitForDeployment();

    // List of functions that are part of IERC1450 interface
    // (excluding functions inherited from IERC20, IERC165)
    // Updated for single fee token design (December 2024)
    const ierc1450Functions = [
        "changeIssuer(address)",
        "setTransferAgent(address)",
        "isTransferAgent(address)",
        "mint(address,uint256)",
        "burnFrom(address,uint256)",
        "decimals()",
        "isSecurityToken()",
        "requestTransferWithFee(address,address,uint256,uint256)",  // 4 params (no feeToken)
        "getTransferFee(address,address,uint256)",  // 3 params (no feeToken)
        "setFeeToken(address)",  // Single fee token setter
        "getFeeToken()",  // Single fee token getter
        "setFeeParameters(uint8,uint256)",  // 2 params (type, value)
        "withdrawFees(uint256,address)",  // 2 params (amount, recipient)
        "setBrokerStatus(address,bool)",
        "isBroker(address)",
        "processTransferRequest(uint256)",
        "rejectTransferRequest(uint256,uint16,bool)",
        "updateRequestStatus(uint256,uint8)",
        "controllerTransfer(address,address,uint256,bytes,bytes)",
        "setAccountFrozen(address,bool)",
        "isAccountFrozen(address)"
    ];

    // Calculate interface ID
    let interfaceId = ethers.ZeroHash;
    for (const func of ierc1450Functions) {
        const funcId = ethers.id(func).substring(0, 10);
        console.log(`${func}: ${funcId}`);
        interfaceId = ethers.toBeHex(
            BigInt(interfaceId) ^ BigInt(funcId)
        );
    }

    console.log("\nIERC1450 Interface ID:", interfaceId);

    // Also calculate other interface IDs for reference
    const ierc20Functions = [
        "totalSupply()",
        "balanceOf(address)",
        "transfer(address,uint256)",
        "allowance(address,address)",
        "approve(address,uint256)",
        "transferFrom(address,address,uint256)"
    ];

    let ierc20Id = ethers.ZeroHash;
    for (const func of ierc20Functions) {
        const funcId = ethers.id(func).substring(0, 10);
        ierc20Id = ethers.toBeHex(
            BigInt(ierc20Id) ^ BigInt(funcId)
        );
    }
    console.log("IERC20 Interface ID:", ierc20Id);

    const ierc20MetadataFunctions = [
        "name()",
        "symbol()",
        "decimals()"
    ];

    let ierc20MetadataId = ethers.ZeroHash;
    for (const func of ierc20MetadataFunctions) {
        const funcId = ethers.id(func).substring(0, 10);
        ierc20MetadataId = ethers.toBeHex(
            BigInt(ierc20MetadataId) ^ BigInt(funcId)
        );
    }
    console.log("IERC20Metadata Interface ID:", ierc20MetadataId);

    const ierc165Functions = [
        "supportsInterface(bytes4)"
    ];

    let ierc165Id = ethers.ZeroHash;
    for (const func of ierc165Functions) {
        const funcId = ethers.id(func).substring(0, 10);
        ierc165Id = ethers.toBeHex(
            BigInt(ierc165Id) ^ BigInt(funcId)
        );
    }
    console.log("IERC165 Interface ID:", ierc165Id);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});