# ERC-1450: RTA-Controlled Security Token Standard

## Reference Implementation

This repository contains the official reference implementation of ERC-1450, a standard for compliant security tokens controlled by a Registered Transfer Agent (RTA).

### Project Structure

This reference implementation is part of a two-repository system:

1. **Specification Repository**: [StartEngine/ERCs](https://github.com/StartEngine/ERCs)
   - Fork of [ethereum/ERCs](https://github.com/ethereum/ERCs)
   - Contains the formal ERC-1450 specification
   - Location: `/Users/devendergollapally/StartEngineRepositories/ERCs`
   - Spec file: `ERCS/erc-1450.md`
   - Our pull request [PR](https://github.com/ethereum/ERCs/pull/1335)

2. **Reference Implementation** (this repository): [StartEngine/erc1450-reference](https://github.com/StartEngine/erc1450-reference)
   - Solidity smart contracts implementing the spec
   - Comprehensive test suite
   - Location: `/Users/devendergollapally/StartEngineRepositories/erc1450-reference`
   - Contracts: `contracts/ERC1450.sol`, `contracts/RTAProxy.sol`

**Important**: Any changes to the contracts in this repository should be validated against the formal specification in the ERCs repository to ensure compliance.

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
- KYC/AML verification requirements
- Extended reason codes (0-14, 999) for detailed rejection tracking

## Upgradeability (New!)

This implementation now includes **upgradeable versions** of the contracts using OpenZeppelin's UUPS proxy pattern, allowing critical bug fixes without requiring token holder action.

### Upgradeable Contracts Available
- `ERC1450Upgradeable.sol` - Upgradeable token implementation
- `RTAProxyUpgradeable.sol` - Upgradeable multi-sig RTA

### Benefits
- **Bug Fixes**: Deploy patches without changing contract addresses
- **No Migration**: Token holders keep the same addresses and balances
- **Secure**: Upgrades require multi-sig RTA approval
- **Gas Efficient**: UUPS pattern minimizes overhead

### Deployment Options
```bash
# Deploy standard (immutable) contracts
npx hardhat run scripts/deploy.js --network polygon

# Deploy upgradeable contracts (recommended for production)
npx hardhat run scripts/deploy-upgradeable.js --network polygon
```

### Upgrade Process
```bash
# Upgrade contracts (requires multi-sig approval)
npx hardhat run scripts/upgrade.js --network polygon
```

For detailed upgradeability documentation, see [UPGRADEABILITY.md](./UPGRADEABILITY.md).

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

# Install dependencies (also installs git hooks via Husky)
npm install

# Compile contracts
npx hardhat compile

# Run tests
npm test

# Check test coverage
npx hardhat coverage

# Run security analysis (requires Python + Slither)
slither . --print human-summary
```

**Note**: The `npm install` command automatically sets up git hooks via Husky. These hooks will run `hardhat compile` and `npm test` before each commit to ensure code quality.

## Developer Workflow

For contributors and developers working on this project:

1. **Clone & Setup**
   ```bash
   git clone https://github.com/StartEngine/erc1450-reference.git
   cd erc1450-reference
   npm install  # Auto-installs Husky pre-commit hooks
   ```

2. **Compile Contracts**
   ```bash
   npx hardhat compile
   ```

3. **Run Tests**
   ```bash
   npm test  # Runs all 341 tests
   ```

4. **Check Coverage**
   ```bash
   npx hardhat coverage  # Current: 86.2% branch coverage
   ```

5. **Security Analysis** (optional, requires [Slither](https://github.com/crytic/slither))
   ```bash
   pip install slither-analyzer
   slither .
   ```

6. **Pre-Commit Hooks** (automatic)
   - Husky automatically runs before each commit:
     - ✅ Compiles all Solidity contracts
     - ✅ Runs full test suite (341 tests)
   - To bypass (not recommended): `git commit --no-verify`

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

## Extended Capabilities (Non-Normative)

The ERC-1450 specification includes comprehensive documentation for real-world securities operations:

### Corporate Actions
- **Stock Splits & Reverse Splits**: Proportional mint/burn operations
- **Dividends**: Stablecoin distributions with off-chain calculations
- **Mandatory Redemptions**: Forced buybacks and bond calls
- **Tender Offers**: Voluntary redemption patterns
- **Mergers & Acquisitions**: Token swap mechanisms

### Shareholder Governance
- **Record Dates**: Off-chain snapshots or external snapshot contracts
- **Proxy Voting**: Vote recording with on-chain attestation
- **Meeting Quorums**: Threshold calculations and verification
- **Document Management**: Via ERC-1643 for proxy rules and notices

### Tax Compliance
- **W-9/W-8 Collection**: Off-chain during KYC process
- **Withholding Calculations**: Per-jurisdiction off-chain processing
- **1099/1042-S Reporting**: Annual tax form generation
- **Document References**: Encrypted storage via ERC-1643

### Secondary Market Integration
- **ATS Adapter Pattern**: Integration with regulated trading venues
- **Order Book Visibility**: Via TransferRequested events
- **Pre-Matched Trades**: Through registered broker submissions
- **Reason Code Analytics**: Optimization using rejection reasons

### BrokerProxy Pattern (Recommended)
- Similar to RTAProxy but optional for brokers
- Enables secure key rotation and multi-sig controls
- Provides business continuity for broker operations

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

## Transfer Rejection Reason Codes

The implementation includes standardized reason codes for transfer rejections:

| Code | Constant | Description |
|------|----------|-------------|
| 0 | REASON_INSUFFICIENT_BALANCE | Sender has fewer tokens than transfer amount |
| 1 | REASON_INVALID_SENDER | Sender address is invalid or blacklisted |
| 2 | REASON_INVALID_RECEIVER | Receiver address is invalid or zero |
| 3 | REASON_COMPLIANCE_FAILURE | Generic compliance check failure |
| 4 | REASON_TRANSFER_RESTRICTED | Transfer temporarily restricted |
| 5 | REASON_HOLDER_LIMIT_EXCEEDED | Would exceed maximum holder count |
| 6 | REASON_TRADING_HALT | Trading is currently halted |
| 7 | REASON_COURT_ORDER | Transfer blocked by court order |
| 8 | REASON_REGULATORY_FREEZE | Account frozen by regulator |
| 9 | REASON_LOCK_PERIOD | Tokens are in lock-up period |
| 10 | REASON_RECIPIENT_NOT_VERIFIED | Recipient hasn't completed KYC/AML |
| 11 | REASON_ADDRESS_NOT_LINKED | Address not linked to verified identity |
| 12 | REASON_SENDER_VERIFICATION_EXPIRED | Sender's KYC has expired |
| 13 | REASON_JURISDICTION_BLOCKED | Recipient in restricted jurisdiction |
| 14 | REASON_ACCREDITATION_REQUIRED | Recipient not accredited (Reg D) |
| 999 | REASON_OTHER | Other unspecified reason |

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

## Python Package 📦

This repository includes a Python package (`startengine-erc1450`) for easy integration with Python-based applications.

### Installation
```bash
# Install from GitHub with specific version
pip install git+https://github.com/StartEngine/erc1450-reference.git@v1.0.0
```

### Usage
```python
from startengine_erc1450 import get_abi, get_bytecode, RTAProxyContract

# Get contract artifacts
abi = get_abi("RTAProxy")
bytecode = get_bytecode("RTAProxy")

# Use contract wrappers
rta = RTAProxyContract()
deployment_data = rta.get_deployment_data(signers=[...], required_signatures=2)
```

### ⚠️ IMPORTANT: Release Process

**Whenever you update the smart contracts in this reference implementation, you MUST release a new version of the Python package:**

1. **Make contract changes** and compile: `npm run compile`
2. **Run release script**: `./release.sh`
   - This will prompt for version type (patch/minor/major)
   - Updates version in `startengine_erc1450/__init__.py`
   - Creates a git tag (e.g., `v1.0.1`)
3. **Push the release**:
   ```bash
   git push origin main
   git push origin v1.0.1  # Use your new version
   ```
4. **Update dependent projects** to use the new version

See [PACKAGE_README.md](PACKAGE_README.md) for detailed package documentation.

## Security & Audit Status

### Initial Security Analysis ✅
- **Slither Analysis**: Completed (November 2024) - No critical vulnerabilities found
- **Static Analysis**: All high-priority issues resolved in [commit 9805925](https://github.com/StartEngine/erc1450-reference/commit/9805925)
- **Test Coverage**: 63 comprehensive tests passing
- **Security Score**: 9.5/10 based on automated analysis

### Professional Audit Status ⚠️
**This implementation has undergone initial security analysis but has NOT received a professional third-party audit. Production deployment should only proceed after:**
- Formal security audit by a reputable firm (OpenZeppelin, Trail of Bits, ConsenSys, etc.)
- Thorough legal review for your jurisdiction
- Comprehensive integration testing

---

Built with ❤️ by [StartEngine](https://www.startengine.com) for the Ethereum community
