# ERC-1450 Upgradeability Guide

## Overview

The ERC-1450 reference implementation now includes **upgradeable versions** of both the main contracts using OpenZeppelin's UUPS (Universal Upgradeable Proxy Standard) pattern. This ensures that critical bugs can be fixed post-deployment without requiring any action from token holders.

## Why Upgradeability Matters for Security Tokens

1. **Bug Fixes**: Critical vulnerabilities can be patched without token migration
2. **Regulatory Compliance**: New compliance requirements can be implemented
3. **Feature Additions**: New functionality can be added as the standard evolves
4. **Gas Optimizations**: Performance improvements can be deployed
5. **No Investor Action Required**: Upgrades are transparent to token holders

## Contract Architecture

### Standard Contracts (Immutable)
- `contracts/ERC1450.sol` - Original immutable implementation
- `contracts/RTAProxy.sol` - Original immutable multi-sig

### Upgradeable Contracts (Recommended for Production)
- `contracts/upgradeable/ERC1450Upgradeable.sol` - UUPS upgradeable token
- `contracts/upgradeable/RTAProxyUpgradeable.sol` - UUPS upgradeable multi-sig

## Security Model

### RTAProxyUpgradeable
- **Upgrade Authority**: Multi-signature approval required
- **Process**: Requires M-of-N RTA signers to approve upgrade
- **Protection**: Prevents single point of failure

### ERC1450Upgradeable
- **Upgrade Authority**: Only the RTA (RTAProxyUpgradeable)
- **Process**: RTA multi-sig must approve through RTAProxy
- **Protection**: Even if issuer keys are compromised, they cannot upgrade

## Deployment

### Initial Deployment

```bash
# Deploy upgradeable contracts with proxy pattern
npx hardhat run scripts/deploy-upgradeable.js --network polygon
```

This deploys:
1. RTAProxyUpgradeable (UUPS proxy + implementation)
2. ERC1450Upgradeable (UUPS proxy + implementation)

The proxy addresses remain constant even after upgrades.

### Deployment Output

```
RTAProxyUpgradeable (Multi-sig):
  - Proxy: 0x... (permanent address)
  - Implementation: 0x... (can be upgraded)

ERC1450Upgradeable Token:
  - Proxy: 0x... (permanent address)
  - Implementation: 0x... (can be upgraded)
```

## Upgrade Process

### Step 1: Prepare New Implementation

```solidity
// Example: ERC1450UpgradeableV2.sol
contract ERC1450UpgradeableV2 is ERC1450Upgradeable {
    // New features or bug fixes
    function version() external pure override returns (string memory) {
        return "2.0.0";
    }
}
```

### Step 2: Test Thoroughly

```bash
# Run comprehensive tests
npx hardhat test

# Test upgrade locally
npx hardhat run scripts/test-upgrade.js --network hardhat
```

### Step 3: Execute Upgrade

```bash
# Run upgrade script
npx hardhat run scripts/upgrade.js --network polygon

# Select which contract to upgrade
# Follow multi-sig approval process
```

### Step 4: Multi-Sig Approval

For RTAProxyUpgradeable upgrades:
1. First signer submits upgrade operation
2. Additional signers confirm operation
3. Upgrade executes automatically when threshold reached

For ERC1450Upgradeable upgrades:
1. RTA submits upgrade through RTAProxy multi-sig
2. Additional RTA signers confirm
3. Token upgrades when threshold reached

## Upgrade Script Usage

### Basic Upgrade

```bash
# Set environment variable for automation
export CONTRACT_TO_UPGRADE=2  # 1=RTAProxy, 2=ERC1450

npx hardhat run scripts/upgrade.js --network polygon
```

### Check Upgrade Status

```javascript
// In scripts/check-upgrade-status.js
const { checkUpgradeStatus } = require('./upgrade');

async function main() {
    await checkUpgradeStatus('upgrade-polygon-1234567890.json');
}
```

## Best Practices

### Before Upgrading

1. **Audit**: Have new implementation audited
2. **Test**: Thoroughly test on testnets
3. **Simulate**: Use hardhat fork to simulate upgrade
4. **Communicate**: Notify stakeholders of planned upgrade
5. **Document**: Record reason for upgrade

### During Upgrade

1. **Monitor**: Watch for multi-sig confirmations
2. **Verify**: Check upgrade executed correctly
3. **Test**: Verify functionality post-upgrade

### After Upgrade

1. **Verify**: Confirm new version is active
2. **Update**: Update documentation
3. **Monitor**: Watch for any issues
4. **Archive**: Keep old implementation code

## Storage Layout Considerations

The upgradeable contracts include storage gaps to allow for future storage variables:

```solidity
// Reserve storage slots for future use
uint256[45] private __gap;
```

This prevents storage collisions when adding new state variables in upgrades.

## Emergency Procedures

### Pause Upgrade

If an issue is detected during multi-sig approval:
1. Signers can revoke confirmations
2. Operation can be abandoned
3. New upgrade can be prepared

### Rollback

While not directly supported, a "rollback" can be achieved by:
1. Deploying previous implementation as new version
2. Following standard upgrade process
3. Effectively "upgrading" to previous version

## Gas Considerations

- UUPS pattern is more gas-efficient than transparent proxy
- Upgrade operations require one-time gas for multi-sig execution
- Day-to-day operations have minimal proxy overhead

## Comparison: Immutable vs Upgradeable

| Aspect | Immutable | Upgradeable |
|--------|-----------|-------------|
| Bug Fixes | Requires migration | In-place update |
| Gas Cost | Slightly lower | Minimal overhead |
| Complexity | Simple | More complex |
| Security | No upgrade risk | Multi-sig controlled |
| Production Ready | Yes, but risky | Recommended |

## FAQ

### Q: Can the issuer upgrade the contracts?
**A:** No. Only the RTA (through multi-sig) can authorize upgrades. This protects against compromised issuer keys.

### Q: What happens to token balances during upgrade?
**A:** Nothing. All storage (balances, ownership, etc.) remains intact. Only the logic implementation changes.

### Q: Can upgrades be forced on users?
**A:** The upgrade is transparent to users. Their tokens and addresses remain the same. However, the RTA multi-sig requirement ensures upgrades are legitimate.

### Q: How long does an upgrade take?
**A:** Once sufficient signatures are collected (typically 2-of-3), the upgrade executes immediately in the same transaction.

### Q: Can we add new functions in an upgrade?
**A:** Yes. New functions can be added. Existing function signatures should be preserved for compatibility.

### Q: What if we need to upgrade the storage layout?
**A:** Use the storage gaps (`__gap`). Never reorder existing storage variables. Only append new ones or use gap slots.

## Technical Requirements

- Node.js 16+
- Hardhat 2.22+
- OpenZeppelin Contracts Upgradeable 5.1.0+
- OpenZeppelin Hardhat Upgrades plugin

## Support

For questions about upgradeability:
1. Review OpenZeppelin's [Upgrades Documentation](https://docs.openzeppelin.com/upgrades-plugins/1.x/)
2. Check the [UUPS Pattern Guide](https://docs.openzeppelin.com/contracts/5.x/api/proxy#UUPSUpgradeable)
3. Contact the StartEngine engineering team

## License

MIT - See LICENSE file for details