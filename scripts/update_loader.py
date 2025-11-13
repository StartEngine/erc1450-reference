#!/usr/bin/env python3
"""
Auto-update loader.py CONTRACT_PATHS based on compiled artifacts
"""
import re
from pathlib import Path


# Contracts to expose (organized by category)
EXPOSED_CONTRACTS = {
    # Core contracts
    "RTAProxy": "RTAProxy.sol/RTAProxy.json",
    "ERC1450": "ERC1450.sol/ERC1450.json",

    # Upgradeable contracts
    "RTAProxyUpgradeable": "upgradeable/RTAProxyUpgradeable.sol/RTAProxyUpgradeable.json",
    "ERC1450Upgradeable": "upgradeable/ERC1450Upgradeable.sol/ERC1450Upgradeable.json",

    # Interfaces
    "IERC1450": "interfaces/IERC1450.sol/IERC1450.json",
}


def update_loader():
    """Update loader.py with current CONTRACT_PATHS"""
    loader_file = Path("startengine_erc1450/artifacts/loader.py")

    if not loader_file.exists():
        print(f"❌ Error: {loader_file} not found")
        return False

    # Read current loader.py
    content = loader_file.read_text()

    # Generate new CONTRACT_PATHS
    paths_lines = ["CONTRACT_PATHS = {"]
    for name, path in EXPOSED_CONTRACTS.items():
        paths_lines.append(f'    "{name}": "{path}",')
    paths_lines.append("}")

    new_paths = "\n".join(paths_lines)

    # Replace CONTRACT_PATHS section
    pattern = r"CONTRACT_PATHS = \{[^}]*\}"
    updated_content = re.sub(pattern, new_paths, content, flags=re.DOTALL)

    # Write back
    loader_file.write_text(updated_content)

    print(f"✅ Updated loader.py with {len(EXPOSED_CONTRACTS)} contracts:")
    for name in EXPOSED_CONTRACTS:
        print(f"   - {name}")

    return True


if __name__ == "__main__":
    import sys
    success = update_loader()
    sys.exit(0 if success else 1)
