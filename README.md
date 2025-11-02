# ERC-1450: RTA-Controlled Security Token Standard

## Reference Implementation

This repository contains the official reference implementation of ERC-1450, a standard for compliant security tokens controlled by a Registered Transfer Agent (RTA).

## Overview

ERC-1450 enables compliant securities offerings under SEC regulations by providing:

- **Exclusive RTA Control**: Only the designated transfer agent can execute token operations
- **Multi-Signature Security**: RTAProxy pattern prevents single key compromise
- **Transfer Request System**: Compliant transfer workflow with fees and approvals
- **Regulatory Compliance**: Built for SEC Rule 17Ad requirements
- **Court Order Support**: Forced transfers for legal compliance
- **Account Restrictions**: Freeze/unfreeze capabilities

## Key Features

### 1. RTA-Exclusive Operations
- All transfers must go through the Registered Transfer Agent
- Direct ERC-20 `transfer()` and `approve()` functions are disabled
- Minting and burning controlled by RTA only

### 2. Transfer Request System
- Token holders or authorized brokers request transfers
- Fees collected at request time
- RTA reviews and approves/rejects requests
- Full audit trail of all transfer activities

### 3. Multi-Sig Security (RTAProxy)
- 2-of-3 multi-signature requirement for critical operations
- Time-locks for high-value transfers
- Protection against single point of failure
- Immutable transfer agent once set to RTAProxy

### 4. Compliance Features
- Account freezing for regulatory compliance
- Court order execution capabilities
- Broker registration and management
- Configurable fee structures

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Token Holder  │────▶│   ERC1450    │◀────│    RTAProxy     │
└─────────────────┘     └──────────────┘     └─────────────────┘
                               ▲                      ▲
                               │                      │
                        ┌──────┴──────┐       ┌──────┴──────┐
                        │   Brokers   │       │  RTA Signers │
                        └─────────────┘       └─────────────┘
```

## Prerequisites

- Node.js v16+ (tested with v22.14.0)
- npm v7+ (tested with v10.9.2)

## Installation

```bash
# Clone the repository
git clone https://github.com/StartEngine/erc1450-reference.git
cd erc1450-reference

# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test
```

## Deployment

### Deploy to Local Network

```bash
# Start local Hardhat node
npx hardhat node

# Deploy contracts (in new terminal)
npx hardhat run scripts/deploy.js --network localhost
```

### Deploy to Testnet

```bash
# Set up environment variables
export PRIVATE_KEY="your_private_key"
export RPC_URL="your_rpc_url"

# Deploy
npx hardhat run scripts/deploy.js --network sepolia
```

## Usage

### Quick Demos

Run these scripts to see the ERC-1450 system in action:

```bash
# Display token information and run basic demo
npx hardhat run scripts/info.js

# Demo minting tokens through multi-sig
npx hardhat run scripts/demo-mint.js

# Demo complete transfer request workflow
npx hardhat run scripts/demo-transfer.js
```

### RTA Operations

For production deployments, use the deployment and operations scripts:

```bash
# Deploy contracts
npx hardhat run scripts/deploy.js --network localhost

# After deployment, manage operations using the deployment file
# (Requires deployment-{network}.json file from deploy.js)
```

### Token Holder Operations

```javascript
// Request a transfer
await token.requestTransferWithFee(
    fromAddress,
    toAddress,
    amount,
    ethers.ZeroAddress,  // ETH for fee
    feeAmount,
    { value: feeAmount }
);

// Check transfer request status
const request = await token.transferRequests(requestId);
console.log("Status:", request.status);
```

### Multi-Sig Operations

```javascript
// Submit operation (first signer)
const operationId = await rtaProxy.submitOperation(
    targetContract,
    encodedFunctionData,
    ethValue
);

// Confirm operation (second signer)
await rtaProxy.confirmOperation(operationId);
// Auto-executes when threshold reached

// Check operation status
const op = await rtaProxy.getOperation(operationId);
console.log("Executed:", op.executed);
```

## Contract Interfaces

### IERC1450

The main security token interface extending ERC-20:

```solidity
interface IERC1450 is IERC20, IERC165 {
    // RTA Functions
    function changeIssuer(address newIssuer) external;
    function setTransferAgent(address newTransferAgent) external;
    function mint(address to, uint256 amount) external returns (bool);
    function burnFrom(address from, uint256 amount) external returns (bool);

    // Transfer Request System
    function requestTransferWithFee(
        address from,
        address to,
        uint256 amount,
        address feeToken,
        uint256 feeAmount
    ) external payable returns (uint256 requestId);

    function processTransferRequest(uint256 requestId) external;
    function rejectTransferRequest(uint256 requestId, uint16 reasonCode, bool refundFee) external;

    // Compliance
    function setAccountFrozen(address account, bool frozen) external;
    function executeCourtOrder(address from, address to, uint256 amount, bytes32 documentHash) external;
}
```

### RTAProxy

Multi-signature contract for RTA operations:

```solidity
contract RTAProxy {
    function submitOperation(address target, bytes memory data, uint256 value) external returns (uint256);
    function confirmOperation(uint256 operationId) external;
    function revokeConfirmation(uint256 operationId) external;
    function executeOperation(uint256 operationId) external;
}
```

## Testing

The test suite covers all major functionality:

```bash
# Run all tests
npx hardhat test

# Run specific test file
npx hardhat test test/ERC1450.test.js

# Run with coverage
npx hardhat coverage

# Run with gas reporting
REPORT_GAS=true npx hardhat test
```

Test coverage includes:
- ✅ Token deployment and initialization
- ✅ RTA-exclusive operations (mint, burn, transfer)
- ✅ Transfer request lifecycle
- ✅ Fee management
- ✅ Broker registration
- ✅ Account freezing
- ✅ Court order execution
- ✅ Multi-sig operations
- ✅ Interface detection (ERC-165)

## Security Considerations

1. **Private Key Management**: RTA signers must secure their private keys
2. **Multi-Sig Threshold**: Choose appropriate signature requirements
3. **Transfer Agent Lock**: Once set to RTAProxy, cannot be changed
4. **Fee Collection**: Ensure proper fee token validation
5. **Reentrancy Protection**: All state-changing functions protected
6. **Access Control**: Strict RTA-only modifier on critical functions

## Gas Optimization

- Uses custom errors (ERC-6093) for gas efficiency
- Unchecked blocks where overflow impossible
- Efficient storage packing
- Minimal external calls

## Regulatory Compliance

This implementation is designed to comply with:
- SEC Rule 17Ad (Transfer Agent regulations)
- Regulation S-T (Electronic filing requirements)
- Regulation A+ (Qualified offerings)
- Regulation D (Private placements)
- Regulation CF (Crowdfunding)

## Documentation

- [ERC-1450 Specification](https://github.com/StartEngine/ERCs/blob/update-erc-1450-revival/ERCS/erc-1450.md)
- [SEC Rule 17Ad](https://www.sec.gov/rules/final/34-47978.htm)
- [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts)

## Contributing

This is a reference implementation maintained by StartEngine. For questions or issues, please open a GitHub issue.

## License

MIT License

## Support

For questions and support:
- Open an issue in this repository
- Join the discussion on [Ethereum Magicians](https://ethereum-magicians.org/)
- Contact the StartEngine team

## Audit Status

⚠️ **This is a reference implementation and has not been audited. Do not use in production without proper security review.**

---

Built with ❤️ by [StartEngine](https://www.startengine.com) for the Ethereum community