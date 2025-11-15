# Python to npm Migration Plan

**Status:** Planning
**Branch:** `feature/remove-python-add-npm-releases`
**Repository:** erc1450-reference

---

## Overview

Migrate erc1450-reference from Python package distribution to npm git-based releases. This will simplify the release process and better align with JavaScript/TypeScript projects like se-fireblocks-hardhat.

---

## Phase 1: Clean Up Python Infrastructure ❌

### Delete Python Package Files

- [ ] Remove Python package directory: `startengine_erc1450/` (entire tree)
  - `startengine_erc1450/__init__.py`
  - `startengine_erc1450/artifacts/__init__.py`
  - `startengine_erc1450/artifacts/loader.py`
  - `startengine_erc1450/contracts/__init__.py`
  - `startengine_erc1450/contracts/rta_proxy.py`
  - `startengine_erc1450/contracts/erc1450.py`
  - `startengine_erc1450/__pycache__/`

- [ ] Remove build artifacts directories:
  - `dist/`
  - `startengine_erc1450.egg-info/`

- [ ] Remove Python utility scripts:
  - `scripts/update_loader.py`
  - `scripts/validate_package.py`

- [ ] Remove Python package configuration files:
  - `setup.py`
  - `MANIFEST.in`
  - `PACKAGE_README.md`

- [ ] Remove build/release scripts:
  - `build_package.sh`
  - `release.sh`

### Update .gitignore

- [ ] Review .gitignore Python section (lines 34-44)
  - ✅ Keep Python section - still useful for development tools
  - ✅ No changes needed (already properly configured)

---

## Phase 2: Set Up npm Git-Based Releases ❌

### Update package.json

- [ ] Verify `"name": "erc1450-reference"` (already correct)

- [ ] Bump version to `"1.4.0"` (from uncommitted changes)

- [ ] Add `"files"` field to specify what gets published via git dependency:
  ```json
  "files": [
    "contracts/**/*.sol",
    "artifacts/contracts/**/*.json",
    "hardhat.config.js"
  ]
  ```

- [ ] Ensure both basic and upgradeable contracts are included:
  - ✅ Basic contracts: `contracts/ERC1450.sol`, `contracts/RTAProxy.sol`
  - ✅ Upgradeable contracts: `contracts/ERC1450Upgradeable.sol`, `contracts/RTAProxyUpgradeable.sol`
  - ✅ OpenZeppelin imports: `contracts/ERC1967Proxy.sol`
  - ✅ All artifacts in `artifacts/contracts/`

- [ ] Add `"main"` field for proper npm module resolution:
  ```json
  "main": "index.js"
  ```

- [ ] Create `index.js` at root to export contract artifacts:
  ```javascript
  module.exports = {
    // Basic contracts
    ERC1450: require('./artifacts/contracts/ERC1450.sol/ERC1450.json'),
    RTAProxy: require('./artifacts/contracts/RTAProxy.sol/RTAProxy.json'),

    // Upgradeable contracts
    ERC1450Upgradeable: require('./artifacts/contracts/ERC1450Upgradeable.sol/ERC1450Upgradeable.json'),
    RTAProxyUpgradeable: require('./artifacts/contracts/RTAProxyUpgradeable.sol/RTAProxyUpgradeable.json'),

    // Proxy contract
    ERC1967Proxy: require('./artifacts/contracts/ERC1967Proxy.sol/ERC1967Proxy.json'),
  };
  ```

- [ ] **REMOVE** `@fireblocks/hardhat-fireblocks` from dependencies:
  - Revert uncommitted change in package.json
  - Keep erc1450-reference deployment-agnostic
  - se-fireblocks-hardhat will install Fireblocks plugin independently

### Clean Up Fireblocks References

- [ ] Update `.env.example` to remove Fireblocks-specific comments:
  - Remove lines 11-14: "For Fireblocks integration" and env var examples
  - Remove lines 22 and 26: Fireblocks wallet address comments
  - Keep generic deployment wallet examples

---

## Phase 3: Update README.md ❌

### Remove Python Package Section

- [ ] Delete lines 442-481:
  - "Python Package 📦" heading
  - Installation instructions (pip install git+https...)
  - Usage examples with Python imports
  - "⚠️ IMPORTANT: Release Process" warning
  - Reference to PACKAGE_README.md

### Add New npm Package Section

- [ ] Add new section after line 441 (after "Contact the StartEngine team"):

```markdown
## npm Package Integration 📦

This repository can be used as an npm package via git dependencies for JavaScript/TypeScript projects.

### Installation

Add to your `package.json`:
```json
{
  "dependencies": {
    "erc1450-reference": "git+https://github.com/StartEngine/erc1450-reference.git#v1.4.0"
  }
}
```

Or install directly:
```bash
npm install git+https://github.com/StartEngine/erc1450-reference.git#v1.4.0
```

### Usage

Import contract artifacts in your JavaScript/TypeScript project:

```javascript
// Method 1: Import via main index.js
const { ERC1450, RTAProxy, ERC1450Upgradeable, RTAProxyUpgradeable } = require('erc1450-reference');

// Method 2: Import specific artifacts directly
const RTAProxyUpgradeable = require('erc1450-reference/artifacts/contracts/RTAProxyUpgradeable.sol/RTAProxyUpgradeable.json');
const ERC1450Upgradeable = require('erc1450-reference/artifacts/contracts/ERC1450Upgradeable.sol/ERC1450Upgradeable.json');

// Use with ethers.js or web3.js
const abi = RTAProxyUpgradeable.abi;
const bytecode = RTAProxyUpgradeable.bytecode;

// Example: Deploy with ethers.js
const factory = new ethers.ContractFactory(abi, bytecode, signer);
const contract = await factory.deploy(...args);
```

### Available Contracts

This package includes both basic and upgradeable versions:

**Basic Contracts (Immutable)**
- `ERC1450.sol` - Standard ERC1450 token implementation
- `RTAProxy.sol` - Multi-sig RTA proxy

**Upgradeable Contracts (UUPS Pattern)**
- `ERC1450Upgradeable.sol` - Upgradeable ERC1450 token
- `RTAProxyUpgradeable.sol` - Upgradeable multi-sig RTA
- `ERC1967Proxy.sol` - OpenZeppelin proxy for deployment

### Release Process

When updating contracts:

1. **Make contract changes** and compile: `npm run compile`
2. **Update version** in `package.json` (follow semantic versioning)
3. **Commit changes**: `git commit -am "Release v1.4.0"`
4. **Create git tag**: `git tag v1.4.0`
5. **Push to GitHub**:
   ```bash
   git push origin main
   git push origin v1.4.0
   ```
6. **Update dependent projects** to use the new version tag in their `package.json`

**Note:** No build scripts needed - git tags are the release mechanism.
```

---

## Phase 4: Test & Validate ❌

### Create Test Project

- [ ] Create temporary test directory: `/tmp/test-erc1450-npm`

- [ ] Initialize npm project:
  ```bash
  cd /tmp/test-erc1450-npm
  npm init -y
  ```

- [ ] Install from local git repository:
  ```bash
  npm install git+file:///Users/devendergollapally/StartEngineRepositories/erc1450-reference
  ```

- [ ] Create test script `test.js`:
  ```javascript
  const { ERC1450, RTAProxy, ERC1450Upgradeable, RTAProxyUpgradeable, ERC1967Proxy } = require('erc1450-reference');

  console.log('Testing erc1450-reference npm package...\n');

  // Test basic contracts
  console.log('✓ ERC1450 (basic):', ERC1450.contractName);
  console.log('  - ABI entries:', ERC1450.abi.length);
  console.log('  - Bytecode length:', ERC1450.bytecode.length);

  console.log('\n✓ RTAProxy (basic):', RTAProxy.contractName);
  console.log('  - ABI entries:', RTAProxy.abi.length);
  console.log('  - Bytecode length:', RTAProxy.bytecode.length);

  // Test upgradeable contracts
  console.log('\n✓ ERC1450Upgradeable:', ERC1450Upgradeable.contractName);
  console.log('  - ABI entries:', ERC1450Upgradeable.abi.length);
  console.log('  - Bytecode length:', ERC1450Upgradeable.bytecode.length);

  console.log('\n✓ RTAProxyUpgradeable:', RTAProxyUpgradeable.contractName);
  console.log('  - ABI entries:', RTAProxyUpgradeable.abi.length);
  console.log('  - Bytecode length:', RTAProxyUpgradeable.bytecode.length);

  console.log('\n✓ ERC1967Proxy:', ERC1967Proxy.contractName);
  console.log('  - ABI entries:', ERC1967Proxy.abi.length);
  console.log('  - Bytecode length:', ERC1967Proxy.bytecode.length);

  console.log('\n✅ All contracts loaded successfully!');
  ```

- [ ] Run test: `node test.js`

- [ ] Verify all contracts load without errors

- [ ] Test direct artifact import:
  ```javascript
  const RTA = require('erc1450-reference/artifacts/contracts/RTAProxyUpgradeable.sol/RTAProxyUpgradeable.json');
  console.log('Direct import:', RTA.contractName);
  ```

---

## Phase 5: Final Commit & Tag ❌

### Create Release Commit

- [ ] Stage all changes:
  ```bash
  git add .
  git status  # Verify changes
  ```

- [ ] Create commit:
  ```bash
  git commit -m "Migrate from Python to npm git-based releases

  - Remove Python package infrastructure (startengine_erc1450/)
  - Remove build scripts (build_package.sh, release.sh)
  - Update package.json with files field for npm
  - Add index.js for easy artifact imports
  - Update README with npm installation instructions
  - Include both basic and upgradeable contract artifacts

  BREAKING CHANGE: Python package no longer supported.
  Use npm git dependency instead:
  npm install git+https://github.com/StartEngine/erc1450-reference.git#v1.4.0"
  ```

- [ ] Create and push tag:
  ```bash
  git tag v1.4.0
  git push origin feature/remove-python-add-npm-releases
  git push origin v1.4.0
  ```

- [ ] Open pull request to `main`

- [ ] After merge, delete this migration plan document

---

## Summary of Changes

### Deletions (13 items)
- ✗ Python package directory: `startengine_erc1450/` (7 files)
- ✗ Build artifacts: `dist/`, `startengine_erc1450.egg-info/`
- ✗ Build scripts: `build_package.sh`, `release.sh`
- ✗ Python scripts: `scripts/update_loader.py`, `scripts/validate_package.py`
- ✗ Python config: `setup.py`, `MANIFEST.in`, `PACKAGE_README.md`
- ✗ README Python section: lines 442-481 (~40 lines)

### Additions (3 items)
- ✓ `package.json`: Add `files` field
- ✓ `index.js`: New file for easy imports
- ✓ README npm section: ~60 lines with comprehensive examples

### Key Benefits
- ✅ Simpler release process (git tags only, no build scripts)
- ✅ Better alignment with JavaScript/TypeScript ecosystem
- ✅ Both basic and upgradeable contracts included
- ✅ Multiple import methods (index.js or direct paths)
- ✅ Works seamlessly with se-fireblocks-hardhat
- ✅ Reduces maintenance burden
- ✅ No breaking changes for existing contract functionality

---

## Contract Artifacts Included

### Basic Contracts
- `contracts/ERC1450.sol` → `artifacts/contracts/ERC1450.sol/ERC1450.json`
- `contracts/RTAProxy.sol` → `artifacts/contracts/RTAProxy.sol/RTAProxy.json`

### Upgradeable Contracts
- `contracts/ERC1450Upgradeable.sol` → `artifacts/contracts/ERC1450Upgradeable.sol/ERC1450Upgradeable.json`
- `contracts/RTAProxyUpgradeable.sol` → `artifacts/contracts/RTAProxyUpgradeable.sol/RTAProxyUpgradeable.json`

### Proxy Contract
- `contracts/ERC1967Proxy.sol` → `artifacts/contracts/ERC1967Proxy.sol/ERC1967Proxy.json`

### OpenZeppelin Dependencies
All OpenZeppelin imports are compiled and included in artifacts.

---

## Next Steps After Migration

1. **Update se-token-manager** - Remove Python git dependency if it exists
2. **Update se-fireblocks-hardhat** - Use git dependency in implementation plan
3. **Notify team** - Announce Python package deprecation
4. **Archive Python docs** - Keep PACKAGE_README.md in git history for reference
5. **Delete this plan** - Once migration is complete and verified

---

**Last Updated:** 2025-11-15
**Created By:** Claude Code
**Delete This File:** After successful migration to main branch
