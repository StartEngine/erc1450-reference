#!/usr/bin/env node

/**
 * Sync Version Script
 *
 * This script reads the version from package.json and updates the version()
 * function in all Solidity contracts to match.
 *
 * Run automatically via:
 * - Pre-commit hook (ensures version is synced before commits)
 * - npm run compile (via precompile script)
 *
 * Usage: node scripts/sync-version.js
 */

const fs = require('fs');
const path = require('path');

// Read version from package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const version = packageJson.version;

console.log(`📦 Syncing contract versions to: ${version}`);

// Contracts that need version() function
const contractsToUpdate = [
  // Upgradeable contracts (already have version())
  'contracts/upgradeable/RTAProxyUpgradeable.sol',
  'contracts/upgradeable/ERC1450Upgradeable.sol',
  // Non-upgradeable contracts (need version() added)
  'contracts/RTAProxy.sol',
  'contracts/ERC1450.sol',
];

// Regex to match existing version() function
// Matches: function version() external pure returns (string memory) { return "x.y.z"; }
// Also handles virtual/override keywords
const versionFunctionRegex =
  /function\s+version\(\)\s+external\s+(?:pure\s+)?(?:virtual\s+)?(?:override\s+)?returns\s*\(\s*string\s+memory\s*\)\s*\{\s*return\s*"[^"]*";\s*\}/g;

// New version function (for upgradeable - with override if needed)
const newVersionFunctionUpgradeable = `function version() external pure returns (string memory) {
        return "${version}";
    }`;

// New version function (for non-upgradeable - simple)
const newVersionFunctionSimple = `function version() external pure returns (string memory) {
        return "${version}";
    }`;

let filesUpdated = 0;
let filesAdded = 0;

contractsToUpdate.forEach((contractPath) => {
  const fullPath = path.join(__dirname, '..', contractPath);

  if (!fs.existsSync(fullPath)) {
    console.log(`  ⚠️  File not found: ${contractPath}`);
    return;
  }

  let content = fs.readFileSync(fullPath, 'utf8');
  const isUpgradeable = contractPath.includes('Upgradeable');

  // Check if version() function exists
  if (versionFunctionRegex.test(content)) {
    // Reset regex state (lastIndex)
    versionFunctionRegex.lastIndex = 0;

    // Replace existing version function
    const newContent = content.replace(
      versionFunctionRegex,
      isUpgradeable ? newVersionFunctionUpgradeable : newVersionFunctionSimple
    );

    if (newContent !== content) {
      fs.writeFileSync(fullPath, newContent, 'utf8');
      console.log(`  ✅ Updated: ${contractPath}`);
      filesUpdated++;
    } else {
      console.log(`  ℹ️  Already up to date: ${contractPath}`);
    }
  } else {
    // version() function doesn't exist - need to add it
    console.log(`  📝 Adding version() to: ${contractPath}`);

    // Find a good place to insert the version function
    // For RTAProxy.sol: before the closing brace, after receive()
    // For ERC1450.sol: in the Introspection section

    if (contractPath.includes('RTAProxy.sol') && !isUpgradeable) {
      // Add before the final closing brace, create a new section
      const versionSection = `
    // ============ Version ============

    /**
     * @notice Returns the contract version
     * @dev Version is synced from package.json via scripts/sync-version.js
     * @return string Version identifier (e.g., "1.10.1")
     */
    ${newVersionFunctionSimple}
`;
      // Find the last closing brace and insert before it
      const lastBraceIndex = content.lastIndexOf('}');
      if (lastBraceIndex > 0) {
        content = content.slice(0, lastBraceIndex) + versionSection + '\n' + content.slice(lastBraceIndex);
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`  ✅ Added version() to: ${contractPath}`);
        filesAdded++;
      }
    } else if (contractPath.includes('ERC1450.sol') && !isUpgradeable) {
      // Add in the Introspection section, after supportsInterface
      const introspectionMarker = '// ============ Introspection ============';
      const insertAfterPattern = /function supportsInterface\([^}]+\}\s*\}/;

      const match = content.match(insertAfterPattern);
      if (match) {
        const insertIndex = match.index + match[0].length;
        const versionCode = `

    /**
     * @notice Returns the contract version
     * @dev Version is synced from package.json via scripts/sync-version.js
     * @return string Version identifier (e.g., "1.10.1")
     */
    ${newVersionFunctionSimple}`;

        content = content.slice(0, insertIndex) + versionCode + content.slice(insertIndex);
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`  ✅ Added version() to: ${contractPath}`);
        filesAdded++;
      } else {
        console.log(`  ⚠️  Could not find insertion point in: ${contractPath}`);
      }
    }
  }
});

console.log('');
console.log(`📊 Summary: ${filesUpdated} updated, ${filesAdded} added`);

// If any files were modified, stage them for commit
if (filesUpdated > 0 || filesAdded > 0) {
  console.log('');
  console.log('💡 Contract versions synced. Files have been modified.');
}
