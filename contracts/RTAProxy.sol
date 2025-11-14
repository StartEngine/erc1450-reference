// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./interfaces/IERC1450.sol";

/**
 * @title RTAProxy
 * @dev Proxy contract for RTA operations with multi-signature and time-lock features
 * @notice This contract acts as the immutable transfer agent for ERC-1450 tokens
 *
 * The RTAProxy pattern provides:
 * - Protection against single key compromise
 * - Multi-signature requirements for critical operations
 * - Time-locks for high-value transfers
 * - Audit trail of all RTA actions
 */
contract RTAProxy {
    // ============ State Variables ============

    // Multi-sig configuration
    address[] public signers;
    mapping(address => bool) public isSigner;
    uint256 public requiredSignatures;

    // Operation tracking
    struct Operation {
        address target;
        bytes data;
        uint256 value;
        uint256 confirmations;
        bool executed;
        uint256 timestamp;
        mapping(address => bool) hasConfirmed;
    }

    mapping(uint256 => Operation) public operations;
    uint256 public operationCount;

    // Time-lock for high-value transfers
    uint256 public constant HIGH_VALUE_THRESHOLD = 1000000 * 10**18; // Example: 1M tokens
    uint256 public constant TIME_LOCK_DURATION = 24 hours;

    // Internal wallet registry for optimized operations
    mapping(address => bool) private internalWallets;
    uint256 public internalWalletCount;

    // Events
    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);
    event RequiredSignaturesUpdated(uint256 oldRequired, uint256 newRequired);
    event OperationSubmitted(uint256 indexed operationId, address indexed submitter);
    event OperationConfirmed(uint256 indexed operationId, address indexed signer);
    event OperationExecuted(uint256 indexed operationId);
    event OperationRevoked(uint256 indexed operationId, address indexed signer);

    // Internal wallet registry events
    event InternalWalletAdded(address indexed wallet, uint256 timestamp);
    event InternalWalletRemoved(address indexed wallet, uint256 timestamp);

    // Errors
    error NotASigner();
    error AlreadyASigner();
    error AlreadyConfirmed();
    error NotConfirmed();
    error InsufficientConfirmations();
    error OperationAlreadyExecuted();
    error TimeLockNotExpired();
    error InvalidSignerCount();

    // ============ Modifiers ============

    modifier onlySigner() {
        if (!isSigner[msg.sender]) {
            revert NotASigner();
        }
        _;
    }

    modifier operationExists(uint256 operationId) {
        require(operationId < operationCount, "Operation does not exist");
        _;
    }

    modifier notExecuted(uint256 operationId) {
        if (operations[operationId].executed) {
            revert OperationAlreadyExecuted();
        }
        _;
    }

    // ============ Constructor ============

    constructor(address[] memory _signers, uint256 _requiredSignatures) {
        if (_signers.length < _requiredSignatures || _requiredSignatures == 0) {
            revert InvalidSignerCount();
        }

        for (uint256 i = 0; i < _signers.length; i++) {
            address signer = _signers[i];
            require(signer != address(0), "Invalid signer address");
            require(!isSigner[signer], "Duplicate signer");

            isSigner[signer] = true;
            signers.push(signer);

            emit SignerAdded(signer);
        }

        requiredSignatures = _requiredSignatures;
    }

    // ============ Multi-Sig Operations ============

    /**
     * @notice Submit a new operation for multi-sig approval
     * @param target The contract to call
     * @param data The encoded function call
     * @param value ETH value to send (usually 0)
     * @return operationId The ID of the submitted operation
     */
    function submitOperation(
        address target,
        bytes memory data,
        uint256 value
    ) external onlySigner returns (uint256 operationId) {
        operationId = operationCount++;

        Operation storage op = operations[operationId];
        op.target = target;
        op.data = data;
        op.value = value;
        op.timestamp = block.timestamp;

        emit OperationSubmitted(operationId, msg.sender);

        // Auto-confirm from submitter
        confirmOperation(operationId);

        return operationId;
    }

    /**
     * @notice Confirm an operation
     * @param operationId The operation to confirm
     */
    function confirmOperation(uint256 operationId)
        public
        onlySigner
        operationExists(operationId)
        notExecuted(operationId)
    {
        Operation storage op = operations[operationId];

        if (op.hasConfirmed[msg.sender]) {
            revert AlreadyConfirmed();
        }

        op.hasConfirmed[msg.sender] = true;
        op.confirmations++;

        emit OperationConfirmed(operationId, msg.sender);

        // Auto-execute if we have enough confirmations
        if (op.confirmations >= requiredSignatures) {
            _checkAndExecute(operationId);
        }
    }

    /**
     * @notice Revoke a confirmation
     * @param operationId The operation to revoke confirmation from
     */
    function revokeConfirmation(uint256 operationId)
        external
        onlySigner
        operationExists(operationId)
        notExecuted(operationId)
    {
        Operation storage op = operations[operationId];

        if (!op.hasConfirmed[msg.sender]) {
            revert NotConfirmed();
        }

        op.hasConfirmed[msg.sender] = false;
        op.confirmations--;

        emit OperationRevoked(operationId, msg.sender);
    }

    /**
     * @notice Execute an operation that has enough confirmations
     * @param operationId The operation to execute
     */
    function executeOperation(uint256 operationId)
        external
        onlySigner
        operationExists(operationId)
        notExecuted(operationId)
    {
        _checkAndExecute(operationId);
    }

    // ============ High-Value Transfer Time-Lock ============

    /**
     * @notice Check if an operation requires time-lock
     * @param data The encoded function call to check
     * @return bool True if time-lock is required
     */
    function requiresTimeLock(bytes memory data) public view returns (bool) {
        // Decode the function selector
        if (data.length < 4) return false;

        bytes4 selector;
        assembly {
            selector := mload(add(data, 32))
        }

        // Check if this is a high-value transfer
        if (selector == IERC1450.transferFrom.selector ||
            selector == IERC1450.executeCourtOrder.selector) {

            // Both transferFrom and executeCourtOrder have amount at position 3
            // transferFrom(address from, address to, uint256 amount)
            // executeCourtOrder(address from, address to, uint256 amount, bytes32 documentHash)

            // Calldata layout:
            // bytes 0-3: selector (4 bytes)
            // bytes 4-35: param 1 (address from)
            // bytes 36-67: param 2 (address to)
            // bytes 68-99: param 3 (uint256 amount) <- we want this

            if (data.length < 100) return false; // Not enough data

            address toAddress;
            uint256 amount;
            assembly {
                // Load 'to' address from bytes 36-67 (offset by 32 for length prefix + 36 for position)
                toAddress := mload(add(data, 68))
                // Load amount from bytes 68-99 (offset by 32 for length prefix + 68 for position)
                amount := mload(add(data, 100))
            }

            // No time-lock needed for internal transfers regardless of amount
            if (internalWallets[toAddress]) {
                return false;
            }

            // Time-lock required for high-value external transfers
            return amount >= HIGH_VALUE_THRESHOLD;
        }

        return false;
    }

    // ============ Internal Functions ============

    function _checkAndExecute(uint256 operationId) internal {
        Operation storage op = operations[operationId];

        // Recompute confirmations from active signers only
        // This prevents removed signers' confirmations from counting
        uint256 activeConfirmations = 0;
        for (uint256 i = 0; i < signers.length; i++) {
            if (op.hasConfirmed[signers[i]]) {
                activeConfirmations++;
            }
        }

        if (activeConfirmations < requiredSignatures) {
            revert InsufficientConfirmations();
        }

        // Check time-lock for high-value transfers
        if (requiresTimeLock(op.data)) {
            if (block.timestamp < op.timestamp + TIME_LOCK_DURATION) {
                revert TimeLockNotExpired();
            }
        }

        op.executed = true;

        // Execute the operation
        (bool success, bytes memory returnData) = op.target.call{value: op.value}(op.data);
        require(success, string(returnData));

        emit OperationExecuted(operationId);
    }

    // ============ View Functions ============

    /**
     * @notice Get the list of signers
     * @return Array of signer addresses
     */
    function getSigners() external view returns (address[] memory) {
        return signers;
    }

    /**
     * @notice Check if an address has confirmed an operation
     * @param operationId The operation ID
     * @param signer The signer address
     * @return bool True if the signer has confirmed
     */
    function hasConfirmed(uint256 operationId, address signer)
        external
        view
        operationExists(operationId)
        returns (bool)
    {
        return operations[operationId].hasConfirmed[signer];
    }

    /**
     * @notice Get operation details
     * @param operationId The operation ID
     * @return target The target contract
     * @return data The encoded function call
     * @return value The ETH value
     * @return confirmations Number of confirmations
     * @return executed Whether the operation has been executed
     * @return timestamp When the operation was submitted
     */
    function getOperation(uint256 operationId)
        external
        view
        operationExists(operationId)
        returns (
            address target,
            bytes memory data,
            uint256 value,
            uint256 confirmations,
            bool executed,
            uint256 timestamp
        )
    {
        Operation storage op = operations[operationId];
        return (
            op.target,
            op.data,
            op.value,
            op.confirmations,
            op.executed,
            op.timestamp
        );
    }

    // ============ Emergency Functions ============

    /**
     * @notice Add a new signer (requires multi-sig approval)
     * @dev This should be called through submitOperation
     */
    function addSigner(address signer) external {
        require(msg.sender == address(this), "Must be called through multi-sig");

        if (isSigner[signer]) {
            revert AlreadyASigner();
        }

        isSigner[signer] = true;
        signers.push(signer);

        emit SignerAdded(signer);
    }

    /**
     * @notice Remove a signer (requires multi-sig approval)
     * @dev This should be called through submitOperation
     */
    function removeSigner(address signer) external {
        require(msg.sender == address(this), "Must be called through multi-sig");
        require(signers.length - 1 >= requiredSignatures, "Would break multi-sig");

        if (!isSigner[signer]) {
            revert NotASigner();
        }

        isSigner[signer] = false;

        // Remove from signers array
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == signer) {
                signers[i] = signers[signers.length - 1];
                signers.pop();
                break;
            }
        }

        emit SignerRemoved(signer);
    }

    /**
     * @notice Update required signatures (requires multi-sig approval)
     * @dev This should be called through submitOperation
     */
    function updateRequiredSignatures(uint256 newRequiredSignatures) external {
        require(msg.sender == address(this), "Must be called through multi-sig");

        if (newRequiredSignatures == 0 || newRequiredSignatures > signers.length) {
            revert InvalidSignerCount();
        }

        uint256 oldRequired = requiredSignatures;
        requiredSignatures = newRequiredSignatures;
        emit RequiredSignaturesUpdated(oldRequired, newRequiredSignatures);
    }

    // ============ Internal Wallet Registry Functions ============

    /**
     * @notice Add a wallet to the internal registry (no time-lock for transfers to this wallet)
     * @dev Must be called through multi-sig operation. Used for treasury, operational, and escrow wallets.
     * @param wallet The wallet address to add to internal registry
     */
    function addInternalWallet(address wallet) external {
        require(msg.sender == address(this), "Must be called through multi-sig");
        require(wallet != address(0), "Invalid wallet address");
        require(!internalWallets[wallet], "Wallet already registered");

        internalWallets[wallet] = true;
        internalWalletCount++;

        emit InternalWalletAdded(wallet, block.timestamp);
    }

    /**
     * @notice Remove a wallet from the internal registry
     * @dev Must be called through multi-sig operation
     * @param wallet The wallet address to remove from internal registry
     */
    function removeInternalWallet(address wallet) external {
        require(msg.sender == address(this), "Must be called through multi-sig");
        require(internalWallets[wallet], "Wallet not registered");

        internalWallets[wallet] = false;
        internalWalletCount--;

        emit InternalWalletRemoved(wallet, block.timestamp);
    }

    /**
     * @notice Check if a wallet is registered as internal
     * @param wallet The wallet address to check
     * @return bool True if the wallet is registered as internal
     */
    function isInternalWallet(address wallet) external view returns (bool) {
        return internalWallets[wallet];
    }

    /**
     * @notice Get the count of registered internal wallets
     * @return uint256 The number of internal wallets currently registered
     */
    function getInternalWalletCount() external view returns (uint256) {
        return internalWalletCount;
    }

    // ============ ETH Receive Function ============

    /**
     * @notice Receive ETH sent directly to the contract
     * @dev ETH can be used for operations or recovered via multisig operation
     * Emits ETHReceived event for tracking
     */
    receive() external payable {
        emit ETHReceived(msg.sender, msg.value);
    }

    /**
     * @notice Event emitted when ETH is received
     */
    event ETHReceived(address indexed from, uint256 amount);
}