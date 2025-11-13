#!/usr/bin/env python3
"""Validate that all artifacts are accessible via loader"""

import sys
from pathlib import Path

# Add parent directory to path so we can import the package
sys.path.insert(0, str(Path(__file__).parent.parent))

from startengine_erc1450.artifacts.loader import (
    load_artifact,
    list_available_contracts,
)


def validate():
    """Validate that all exposed contracts are loadable"""
    print("Validating package...")

    contracts = list_available_contracts()
    print(f"\nFound {len(contracts)} exposed contracts:")

    all_valid = True
    for name in contracts:
        try:
            artifact = load_artifact(name)
            abi = artifact.get("abi", [])
            bytecode = artifact.get("bytecode", "")

            # Check if this is an interface (has no bytecode)
            is_interface = name.startswith("I") or "Interface" in name

            if not abi:
                print(f"  ⚠️  {name}: No ABI found")
                all_valid = False
            elif not bytecode or bytecode == "0x":
                if is_interface:
                    # Interfaces don't have bytecode - this is expected
                    abi_len = len(abi)
                    print(f"  ✅ {name}: {abi_len} ABI items (interface)")
                else:
                    print(f"  ⚠️  {name}: No bytecode found")
                    all_valid = False
            else:
                abi_len = len(abi)
                bytecode_len = len(bytecode)
                print(
                    f"  ✅ {name}: {abi_len} ABI items, {bytecode_len} bytecode chars"
                )
        except Exception as e:
            print(f"  ❌ {name}: {e}")
            all_valid = False

    print()
    if all_valid:
        print("✅ All contracts valid!")
        return 0
    else:
        print("❌ Some contracts failed validation")
        return 1


if __name__ == "__main__":
    sys.exit(validate())
