const fs = require('fs');
const path = require('path');

// Regulation constants to add to each test file
const regulationConstants = `
    // Common regulation constants for testing
    const REG_US_A = 0x0001; // Reg A
    const issuanceDate = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago`;

// Files to process
const testFiles = [
    'test/BranchCoverage.test.js',
    'test/DeepBranchCoverage.test.js',
    'test/ERC1450.EdgeCases.test.js',
    'test/ERC1450Upgradeable.comprehensive.test.js',
    'test/FinalBranchCoverage.test.js',
    'test/Invariants.test.js',
    'test/ReplayAttack.test.js',
    'test/Upgradeable.EdgeCases.test.js',
    'test/UpgradeableCriticalPaths.test.js',
    'test/CourtOrder.test.js'
];

function fixMintCalls(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');

    // Check if constants are already added
    if (!content.includes('const REG_US_A')) {
        // Add constants after the describe line
        content = content.replace(/^describe\((.*?)\{\s*$/m, (match) => {
            return match + regulationConstants + '\n';
        });
    }

    // Fix various mint patterns (excluding mockERC20.mint and feeToken.mint)

    // Pattern 1: token.connect(rta).mint(address, amount)
    content = content.replace(
        /token\.connect\(rta\)\.mint\(([^,]+),\s*([^)]+)\)(?!\s*,)/g,
        'token.connect(rta).mint($1, $2, REG_US_A, issuanceDate)'
    );

    // Pattern 2: token.connect(other).mint(address, amount) for non-RTA signers
    content = content.replace(
        /token\.connect\((?!rta)([^)]+)\)\.mint\(([^,]+),\s*([^)]+)\)(?!\s*,)/g,
        'token.connect($1).mint($2, $3, REG_US_A, issuanceDate)'
    );

    // Pattern 3: await token.mint patterns (without connect)
    content = content.replace(
        /await token\.mint\(([^,]+),\s*([^)]+)\)(?!\s*,)/g,
        'await token.mint($1, $2, REG_US_A, issuanceDate)'
    );

    // Don't touch lines that already have 4 parameters (already fixed)
    // Don't touch mockERC20.mint or feeToken.mint calls

    fs.writeFileSync(filePath, content);
    console.log(`Fixed: ${filePath}`);
}

console.log('Fixing mint calls in test files...\n');

testFiles.forEach(file => {
    const fullPath = path.join(__dirname, '..', file);
    if (fs.existsSync(fullPath)) {
        try {
            fixMintCalls(fullPath);
        } catch (err) {
            console.error(`Error processing ${file}: ${err.message}`);
        }
    } else {
        console.log(`Skipped (not found): ${file}`);
    }
});

console.log('\nDone! All test files have been updated.');