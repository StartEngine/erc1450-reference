"""
StartEngine ERC1450 Reference Implementation Package

Provides access to compiled smart contract artifacts and deployment utilities
for the ERC1450 token standard and RTAProxy multi-signature contracts.
"""

__version__ = "1.0.2"
__author__ = "StartEngine"

from .artifacts.loader import (
    get_abi,
    get_bytecode,
    load_artifact,
    get_contract_metadata
)

from .contracts.rta_proxy import RTAProxyContract
from .contracts.erc1450 import ERC1450Contract

__all__ = [
    'get_abi',
    'get_bytecode',
    'load_artifact',
    'get_contract_metadata',
    'RTAProxyContract',
    'ERC1450Contract',
]