"""
RTAProxy contract wrapper for deployment and interaction.

This module provides a high-level interface for deploying and interacting
with the RTAProxy multi-signature contract.
"""

from typing import List, Optional, Dict, Any
from ..artifacts.loader import get_abi, get_bytecode


class RTAProxyContract:
    """
    Wrapper for RTAProxy smart contract deployment and interaction.

    The RTAProxy is a multi-signature contract that acts as the Registered
    Transfer Agent (RTA) for ERC1450 tokens.
    """

    CONTRACT_NAME = "RTAProxy"

    def __init__(self):
        """Initialize RTAProxy contract wrapper."""
        self.abi = get_abi(self.CONTRACT_NAME)
        self.bytecode = get_bytecode(self.CONTRACT_NAME)

    def encode_constructor_params(
        self,
        signers: List[str],
        required_signatures: int
    ) -> bytes:
        """
        Encode constructor parameters for deployment.

        Args:
            signers: List of signer addresses (e.g., vault addresses)
            required_signatures: Number of required signatures (threshold)

        Returns:
            Encoded constructor parameters

        Raises:
            ValueError: If validation fails
        """
        # Validate inputs
        if not signers:
            raise ValueError("At least one signer is required")

        if required_signatures <= 0:
            raise ValueError("Required signatures must be greater than 0")

        if required_signatures > len(signers):
            raise ValueError(
                f"Required signatures ({required_signatures}) cannot exceed "
                f"number of signers ({len(signers)})"
            )

        # Check for duplicates
        if len(signers) != len(set(signers)):
            raise ValueError("Duplicate signers not allowed")

        # In production, you would use web3.eth.contract.encodeABI
        # This is a simplified example
        # The actual encoding would be done by web3.py
        return {
            "_signers": signers,
            "_requiredSignatures": required_signatures
        }

    def get_deployment_data(
        self,
        signers: List[str],
        required_signatures: int
    ) -> Dict[str, Any]:
        """
        Get complete deployment data for the RTAProxy contract.

        Args:
            signers: List of signer addresses
            required_signatures: Number of required signatures

        Returns:
            Dictionary with bytecode and encoded constructor args
        """
        constructor_args = self.encode_constructor_params(
            signers, required_signatures
        )

        return {
            "bytecode": self.bytecode,
            "abi": self.abi,
            "constructor_args": constructor_args,
            "contract_name": self.CONTRACT_NAME,
        }

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

    def decode_event(self, event_name: str, log_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Decode an event from transaction logs.

        Args:
            event_name: Name of the event
            log_data: Raw log data

        Returns:
            Decoded event data
        """
        # Find event in ABI
        event_abi = None
        for item in self.abi:
            if item.get('type') == 'event' and item.get('name') == event_name:
                event_abi = item
                break

        if not event_abi:
            raise ValueError(f"Event {event_name} not found in ABI")

        # In production, you would use web3.eth.contract.events
        # This is a placeholder
        return {
            "event": event_name,
            "data": log_data,
            "abi": event_abi,
        }

    @staticmethod
    def validate_signer_configuration(
        signers: List[str],
        threshold: int
    ) -> bool:
        """
        Validate multi-sig configuration.

        Args:
            signers: List of signer addresses
            threshold: Required number of signatures

        Returns:
            True if configuration is valid
        """
        # Basic validation rules
        if not signers:
            return False

        if threshold <= 0 or threshold > len(signers):
            return False

        # Check for duplicates
        if len(signers) != len(set(signers)):
            return False

        # Check valid addresses (simplified check)
        for signer in signers:
            if not signer.startswith('0x') or len(signer) != 42:
                return False

        return True

    def estimate_deployment_gas(
        self,
        signers: List[str],
        required_signatures: int
    ) -> int:
        """
        Estimate gas for deployment.

        Args:
            signers: List of signer addresses
            required_signatures: Number of required signatures

        Returns:
            Estimated gas amount
        """
        # Base gas for contract deployment
        base_gas = 500000

        # Additional gas per signer (storage costs)
        per_signer_gas = 50000

        # Total estimate
        return base_gas + (len(signers) * per_signer_gas)