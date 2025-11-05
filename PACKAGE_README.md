# StartEngine ERC1450 Python Package

## Overview
This Python package provides access to the compiled smart contract artifacts (ABI and bytecode) for the ERC1450 token standard and RTAProxy multi-signature contracts.

## Installation

### From GitHub (Recommended)
```bash
# Install specific version
pip install git+https://github.com/StartEngine/erc1450-reference.git@v1.0.0

# Install latest from main branch
pip install git+https://github.com/StartEngine/erc1450-reference.git
```

### For Development
```bash
# Clone the repository
git clone https://github.com/StartEngine/erc1450-reference.git
cd erc1450-reference

# Install in editable mode
pip install -e .
```

## Usage

### Basic Usage
```python
from startengine_erc1450 import get_abi, get_bytecode

# Get contract artifacts
rta_abi = get_abi("RTAProxy")
rta_bytecode = get_bytecode("RTAProxy")

erc1450_abi = get_abi("ERC1450")
erc1450_bytecode = get_bytecode("ERC1450")
```

### Using Contract Wrappers
```python
from startengine_erc1450 import RTAProxyContract, ERC1450Contract

# RTAProxy deployment
rta = RTAProxyContract()
deployment_data = rta.get_deployment_data(
    signers=["0x123...", "0x456...", "0x789..."],
    required_signatures=2
)

# ERC1450 token deployment
token = ERC1450Contract()
token_data = token.get_deployment_data(
    name="StartEngine Token",
    symbol="SET",
    decimals=18,
    total_supply=1000000 * 10**18,
    rta_address="0xRTAProxyAddress..."
)
```

## 🚨 IMPORTANT: Release Process

**Whenever you update the reference implementation (smart contracts), you MUST create a new package version:**

### Step 1: Update Smart Contracts
```bash
# Make your changes to contracts
vim contracts/RTAProxy.sol
vim contracts/ERC1450.sol

# Compile contracts
npm run compile

# Test changes
npm test
```

### Step 2: Release New Package Version
```bash
# Run the release script
./release.sh

# This script will:
# 1. Show current version (e.g., 1.0.0)
# 2. Ask what type of release (patch/minor/major)
# 3. Update version in startengine_erc1450/__init__.py
# 4. Commit the version change
# 5. Create a git tag (e.g., v1.0.1)
# 6. Show commands to push the release
```

### Step 3: Push the Release
```bash
# Push commits and tags
git push origin main
git push origin v1.0.1  # Use the version created by release.sh
```

### Step 4: Update Dependent Projects
In projects using this package (like se-token-manager), update requirements.txt:
```txt
# Update to new version
startengine-erc1450 @ git+https://github.com/StartEngine/erc1450-reference.git@v1.0.1
```

Then reinstall:
```bash
pip install --upgrade -r requirements.txt
```

## Version Guidelines

### When to Release New Versions

#### Patch Version (1.0.0 → 1.0.1)
- Bug fixes in wrapper classes
- Documentation updates
- Small improvements that don't change behavior

#### Minor Version (1.0.0 → 1.1.0)
- New contract functions added
- New helper utilities
- New features that are backward compatible
- Contract optimizations (gas improvements)

#### Major Version (1.0.0 → 2.0.0)
- Breaking changes to smart contracts
- Changed function signatures
- Removed functions
- Major architectural changes

## Package Structure

```
startengine_erc1450/
├── __init__.py              # Package version and exports
├── artifacts/
│   ├── __init__.py
│   └── loader.py           # Load ABIs and bytecode
├── contracts/
│   ├── __init__.py
│   ├── rta_proxy.py        # RTAProxy wrapper
│   └── erc1450.py          # ERC1450 wrapper
└── data/                   # Compiled artifacts (created during build)
    └── artifacts/
        ├── RTAProxy.sol/
        │   └── RTAProxy.json
        └── ERC1450.sol/
            └── ERC1450.json
```

## Development Workflow

### 1. Make Contract Changes
```bash
# Edit contracts
vim contracts/RTAProxy.sol

# Compile
npm run compile

# Run tests
npm test

# Run security audits
npm run audit
```

### 2. Test Package Locally
```bash
# Copy artifacts to package
./build_package.sh

# Install locally for testing
pip install -e .

# Test imports
python -c "from startengine_erc1450 import get_abi; print(get_abi('RTAProxy')[0])"
```

### 3. Create Release
```bash
# Use release script
./release.sh

# Or manually:
# 1. Update version in startengine_erc1450/__init__.py
# 2. Commit: git commit -m "Bump version to 1.0.1"
# 3. Tag: git tag v1.0.1
# 4. Push: git push origin main --tags
```

## Available Contracts

| Contract | Description |
|----------|-------------|
| RTAProxy | Multi-signature proxy for RTA operations |
| ERC1450 | RTA-controlled security token |
| IERC1450 | Interface definition |
| RestrictionMessages | Library for restriction code messages |

## API Reference

### Functions

#### `get_abi(contract_name: str) -> list`
Get the ABI for a specific contract.

#### `get_bytecode(contract_name: str) -> str`
Get the deployment bytecode for a specific contract.

#### `load_artifact(contract_name: str) -> dict`
Load the complete artifact JSON for a contract.

### Classes

#### `RTAProxyContract`
Wrapper for RTAProxy deployment and interaction.

#### `ERC1450Contract`
Wrapper for ERC1450 token deployment and interaction.

## Troubleshooting

### Package Not Found
```bash
# Ensure you're using the correct tag
pip install git+https://github.com/StartEngine/erc1450-reference.git@v1.0.0
```

### Import Errors
```bash
# Reinstall with latest version
pip uninstall startengine-erc1450
pip install git+https://github.com/StartEngine/erc1450-reference.git@main
```

### Missing Artifacts
```bash
# Rebuild package with artifacts
cd erc1450-reference
./build_package.sh
pip install -e .
```

## Version History

- **v1.0.0** - Initial release with RTAProxy and ERC1450 support
- **v1.0.1** - (Future) Bug fixes
- **v1.1.0** - (Future) New features
- **v2.0.0** - (Future) Breaking changes

## License

MIT License - See LICENSE file for details.