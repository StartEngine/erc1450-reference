"""
ERC1450 contract wrapper for deployment and interaction.

This module provides a high-level interface for deploying and interacting
with the ERC1450 token contract.
"""

from typing import Optional, Dict, Any
from ..artifacts.loader import get_abi, get_bytecode


class ERC1450Contract:
    """
    Wrapper for ERC1450 token contract deployment and interaction.

    The ERC1450 is an RTA-controlled security token standard where only
    the designated RTA (Registered Transfer Agent) can execute transfers.
    """

    CONTRACT_NAME = "ERC1450"

    def __init__(self):
        """Initialize ERC1450 contract wrapper."""
        self.abi = get_abi(self.CONTRACT_NAME)
        self.bytecode = get_bytecode(self.CONTRACT_NAME)

    def encode_constructor_params(
        self,
        name: str,
        symbol: str,
        decimals: int,
        total_supply: int,
        rta_address: str
    ) -> Dict[str, Any]:
        """
        Encode constructor parameters for deployment.

        Args:
            name: Token name (e.g., "StartEngine Token")
            symbol: Token symbol (e.g., "SET")
            decimals: Number of decimals (typically 18)
            total_supply: Initial total supply (in smallest units)
            rta_address: Address of the RTAProxy contract

        Returns:
            Dictionary of constructor parameters

        Raises:
            ValueError: If validation fails
        """
        # Validate inputs
        if not name:
            raise ValueError("Token name is required")

        if not symbol:
            raise ValueError("Token symbol is required")

        if decimals < 0 or decimals > 18:
            raise ValueError("Decimals must be between 0 and 18")

        if total_supply <= 0:
            raise ValueError("Total supply must be greater than 0")

        if not rta_address or not rta_address.startswith('0x'):
            raise ValueError("Invalid RTA address")

        if len(rta_address) != 42:
            raise ValueError("RTA address must be 42 characters")

        return {
            "_name": name,
            "_symbol": symbol,
            "_decimals": decimals,
            "_totalSupply": total_supply,
            "_rta": rta_address
        }

    def get_deployment_data(
        self,
        name: str,
        symbol: str,
        decimals: int,
        total_supply: int,
        rta_address: str
    ) -> Dict[str, Any]:
        """
        Get complete deployment data for the ERC1450 contract.

        Args:
            name: Token name
            symbol: Token symbol
            decimals: Number of decimals
            total_supply: Initial total supply
            rta_address: Address of the RTAProxy contract

        Returns:
            Dictionary with bytecode and encoded constructor args
        """
        constructor_args = self.encode_constructor_params(
            name, symbol, decimals, total_supply, rta_address
        )

        return {
            "bytecode": self.bytecode,
            "abi": self.abi,
            "constructor_args": constructor_args,
            "contract_name": self.CONTRACT_NAME,
        }

    def prepare_transfer_function(
        self,
        from_address: str,
        to_address: str,
        amount: int
    ) -> Dict[str, Any]:
        """
        Prepare a transfer function call.

        Note: Only the RTA can call this function.

        Args:
            from_address: Source address
            to_address: Destination address
            amount: Amount to transfer (in smallest units)

        Returns:
            Prepared function call data
        """
        return self.prepare_transaction(
            "transfer",
            from_address,
            to_address,
            amount
        )

    def prepare_mint_function(
        self,
        to_address: str,
        amount: int
    ) -> Dict[str, Any]:
        """
        Prepare a mint function call.

        Note: Only the RTA can mint new tokens.

        Args:
            to_address: Address to mint tokens to
            amount: Amount to mint (in smallest units)

        Returns:
            Prepared function call data
        """
        return self.prepare_transaction(
            "mint",
            to_address,
            amount
        )

    def prepare_burn_function(
        self,
        from_address: str,
        amount: int
    ) -> Dict[str, Any]:
        """
        Prepare a burn function call.

        Note: Only the RTA can burn tokens.

        Args:
            from_address: Address to burn tokens from
            amount: Amount to burn (in smallest units)

        Returns:
            Prepared function call data
        """
        return self.prepare_transaction(
            "burn",
            from_address,
            amount
        )

    def prepare_transaction(
        self,
        function_name: str,
        *args,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Prepare a transaction for a specific function.

        Args:
            function_name: Name of the contract function
            *args: Function arguments
            **kwargs: Additional transaction parameters

        Returns:
            Prepared transaction dictionary
        """
        # Find function in ABI
        function_abi = None
        for item in self.abi:
            if item.get('type') == 'function' and item.get('name') == function_name:
                function_abi = item
                break

        if not function_abi:
            raise ValueError(f"Function {function_name} not found in ABI")

        return {
            "function": function_name,
            "args": args,
            "abi": function_abi,
        }

    @staticmethod
    def calculate_token_amount(
        human_amount: float,
        decimals: int
    ) -> int:
        """
        Convert human-readable amount to contract amount.

        Args:
            human_amount: Amount in human-readable form (e.g., 100.5)
            decimals: Number of decimals for the token

        Returns:
            Amount in smallest units (e.g., wei)
        """
        return int(human_amount * (10 ** decimals))

    @staticmethod
    def format_token_amount(
        contract_amount: int,
        decimals: int
    ) -> float:
        """
        Convert contract amount to human-readable amount.

        Args:
            contract_amount: Amount in smallest units
            decimals: Number of decimals for the token

        Returns:
            Amount in human-readable form
        """
        return contract_amount / (10 ** decimals)

    def estimate_deployment_gas(
        self,
        name: str,
        symbol: str
    ) -> int:
        """
        Estimate gas for ERC1450 deployment.

        Args:
            name: Token name
            symbol: Token symbol

        Returns:
            Estimated gas amount
        """
        # Base gas for ERC1450 deployment
        base_gas = 2000000

        # Additional gas for string storage
        string_gas = (len(name) + len(symbol)) * 1000

        return base_gas + string_gas