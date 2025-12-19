// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title RTAProxy
 * @dev Proxy contract for RTA operations with multi-signature security
 * @notice This contract acts as the immutable transfer agent for ERC-1450 tokens
 *
 * The RTAProxy pattern provides:
 * - Protection against single key compromise
 * - Multi-signature requirements for critical operations
 * - Audit trail of all RTA actions
 */
contract RTAProxy {
    // ============ State Variables ============

    // Multi-sig configuration
    address[] public signers;
    mapping(address => bool) public isSigner;
    uint256 public requiredSignatures;

    // Operation expiration (7 days)
    uint256 public constant OPERATION_EXPIRY = 7 days;

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

    // Events
    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);
    event RequiredSignaturesUpdated(uint256 oldRequired, uint256 newRequired);
    event OperationSubmitted(uint256 indexed operationId, address indexed submitter);
    event OperationConfirmed(uint256 indexed operationId, address indexed signer);
    event OperationExecuted(uint256 indexed operationId);
    event OperationRevoked(uint256 indexed operationId, address indexed signer);

    // Errors
    error NotASigner();
    error AlreadyASigner();
    error AlreadyConfirmed();
    error NotConfirmed();
    error InsufficientConfirmations();
    error OperationAlreadyExecuted();
    error OperationExpired();
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

    // ============ Internal Functions ============

    /**
     * @dev Execute an operation after confirming sufficient signatures.
     *
     * SECURITY NOTE - Reentrancy Considerations:
     * This function uses a low-level call to execute operations on target contracts.
     * While `op.executed = true` is set BEFORE the external call (preventing replay of
     * the same operation), the target contract could theoretically reenter this contract
     * to submit or confirm OTHER operations.
     *
     * This is acceptable because:
     * 1. RTA signers are trusted parties who control which contracts are targeted
     * 2. New operations still require multi-sig confirmation from trusted signers
     * 3. The same operation cannot be replayed (executed flag set first)
     *
     * GOVERNANCE REQUIREMENT: RTAProxy should only target known, audited contracts
     * (e.g., ERC1450 tokens, fee vaults). Do not target arbitrary untrusted contracts.
     */
    function _checkAndExecute(uint256 operationId) internal {
        Operation storage op = operations[operationId];

        // Check if operation has expired
        if (block.timestamp > op.timestamp + OPERATION_EXPIRY) {
            revert OperationExpired();
        }

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

    /**
     * @notice Check if an operation has expired
     * @param operationId The operation ID
     * @return bool True if the operation has expired
     */
    function isOperationExpired(uint256 operationId)
        external
        view
        operationExists(operationId)
        returns (bool)
    {
        return block.timestamp > operations[operationId].timestamp + OPERATION_EXPIRY;
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

    // ============ Version ============

    /**
     * @notice Returns the contract version
     * @dev Version is synced from package.json via scripts/sync-version.js
     * @return string Version identifier (e.g., "1.10.1")
     */
    function version() external pure returns (string memory) {
        return "1.16.0";
    }

}