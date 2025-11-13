"""
Artifact loader for compiled smart contracts.

This module provides functions to load ABI, bytecode, and other metadata
from the Hardhat-compiled contract artifacts.
"""

import json
import os
from pathlib import Path
from typing import Dict, Any, Optional

# Get the package root directory
PACKAGE_DIR = Path(__file__).parent.parent
# Artifacts are copied during package build to this location
ARTIFACTS_DIR = PACKAGE_DIR / "data" / "artifacts"

# Fallback to development path if artifacts not in package
if not ARTIFACTS_DIR.exists():
    # Development mode: use the original artifacts directory
    PROJECT_ROOT = PACKAGE_DIR.parent
    ARTIFACTS_DIR = PROJECT_ROOT / "artifacts" / "contracts"

# Contract name mappings
CONTRACT_PATHS = {
    "RTAProxy": "RTAProxy.sol/RTAProxy.json",
    "ERC1450": "ERC1450.sol/ERC1450.json",
    "RTAProxyUpgradeable": "upgradeable/RTAProxyUpgradeable.sol/RTAProxyUpgradeable.json",
    "ERC1450Upgradeable": "upgradeable/ERC1450Upgradeable.sol/ERC1450Upgradeable.json",
    "IERC1450": "interfaces/IERC1450.sol/IERC1450.json",
}


def load_artifact(contract_name: str) -> Dict[str, Any]:
    """
    Load the complete artifact JSON for a contract.

    Args:
        contract_name: Name of the contract (e.g., 'RTAProxy', 'ERC1450')

    Returns:
        Complete artifact dictionary including ABI, bytecode, and metadata

    Raises:
        FileNotFoundError: If the artifact file doesn't exist
        ValueError: If the contract name is not recognized
    """
    if contract_name not in CONTRACT_PATHS:
        available = ", ".join(CONTRACT_PATHS.keys())
        raise ValueError(
            f"Unknown contract: {contract_name}. "
            f"Available contracts: {available}"
        )

    artifact_path = ARTIFACTS_DIR / CONTRACT_PATHS[contract_name]

    if not artifact_path.exists():
        raise FileNotFoundError(
            f"Artifact file not found: {artifact_path}\n"
            f"Make sure the contracts have been compiled with 'npm run compile'"
        )

    with open(artifact_path, 'r') as f:
        return json.load(f)


def get_abi(contract_name: str) -> list:
    """
    Get the ABI for a specific contract.

    Args:
        contract_name: Name of the contract

    Returns:
        Contract ABI as a list
    """
    artifact = load_artifact(contract_name)
    return artifact.get('abi', [])


def get_bytecode(contract_name: str) -> str:
    """
    Get the deployment bytecode for a specific contract.

    Args:
        contract_name: Name of the contract

    Returns:
        Bytecode as a hex string (with '0x' prefix)
    """
    artifact = load_artifact(contract_name)
    return artifact.get('bytecode', '0x')


def get_deployed_bytecode(contract_name: str) -> str:
    """
    Get the deployed bytecode for a specific contract.

    Args:
        contract_name: Name of the contract

    Returns:
        Deployed bytecode as a hex string (with '0x' prefix)
    """
    artifact = load_artifact(contract_name)
    return artifact.get('deployedBytecode', '0x')


def get_contract_metadata(contract_name: str) -> Dict[str, Any]:
    """
    Get metadata about the contract compilation.

    Args:
        contract_name: Name of the contract

    Returns:
        Dictionary containing compiler version, optimization settings, etc.
    """
    artifact = load_artifact(contract_name)

    return {
        'contractName': artifact.get('contractName'),
        'sourceName': artifact.get('sourceName'),
        'compiler': artifact.get('compiler'),
        'networks': artifact.get('networks', {}),
        'schemaVersion': artifact.get('schemaVersion'),
    }


def get_function_selector(contract_name: str, function_name: str) -> Optional[str]:
    """
    Get the function selector (4-byte signature) for a specific function.

    Args:
        contract_name: Name of the contract
        function_name: Name of the function

    Returns:
        Function selector as a hex string, or None if not found
    """
    abi = get_abi(contract_name)

    for item in abi:
        if item.get('type') == 'function' and item.get('name') == function_name:
            # Calculate selector from signature
            # Note: In production, you'd use web3.keccak to calculate this
            # This is a placeholder for demonstration
            from web3 import Web3

            # Build function signature
            inputs = ','.join([inp['type'] for inp in item.get('inputs', [])])
            signature = f"{function_name}({inputs})"

            # Calculate keccak hash and take first 4 bytes
            selector = Web3.keccak(text=signature)[:4].hex()
            return selector

    return None


def list_available_contracts() -> list:
    """
    List all available contracts in the package.

    Returns:
        List of contract names
    """
    return list(CONTRACT_PATHS.keys())


def validate_artifacts() -> Dict[str, bool]:
    """
    Validate that all expected artifacts are present.

    Returns:
        Dictionary mapping contract names to availability status
    """
    status = {}
    for contract_name in CONTRACT_PATHS:
        try:
            load_artifact(contract_name)
            status[contract_name] = True
        except (FileNotFoundError, ValueError):
            status[contract_name] = False

    return status