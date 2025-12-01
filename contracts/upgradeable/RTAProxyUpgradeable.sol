// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title RTAProxyUpgradeable
 * @dev Upgradeable proxy contract for RTA operations with multi-signature security
 * @notice This contract acts as the immutable transfer agent for ERC-1450 tokens
 *
 * The RTAProxy pattern provides:
 * - Protection against single key compromise
 * - Multi-signature requirements for critical operations
 * - Audit trail of all RTA actions
 * - Upgradeability for bug fixes and improvements
 *
 * IMPORTANT: Upgrades require multi-sig approval through the contract's own mechanism
 */
contract RTAProxyUpgradeable is Initializable, UUPSUpgradeable {
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

    // Upgrade control
    bool private _upgradeAuthorized;
    uint256 private _authorizedUpgradeOperation;

    // Gap for future storage variables (standard practice for upgradeable contracts)
    uint256[45] private __gap;

    // Events
    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);
    event RequiredSignaturesUpdated(uint256 oldRequired, uint256 newRequired);
    event OperationSubmitted(uint256 indexed operationId, address indexed submitter);
    event OperationConfirmed(uint256 indexed operationId, address indexed signer);
    event OperationExecuted(uint256 indexed operationId);
    event OperationRevoked(uint256 indexed operationId, address indexed signer);
    event UpgradeAuthorized(uint256 indexed operationId, address indexed newImplementation);
    event ETHReceived(address indexed from, uint256 amount);

    // Errors
    error NotASigner();
    error AlreadyASigner();
    error AlreadyConfirmed();
    error NotConfirmed();
    error InsufficientConfirmations();
    error OperationAlreadyExecuted();
    error InvalidSignerCount();
    error UpgradeNotAuthorized();

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

    // ============ Initializer (replaces constructor) ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address[] memory _signers, uint256 _requiredSignatures) public initializer {
        __UUPSUpgradeable_init();

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

    // ============ UUPS Upgrade Authorization ============

    /**
     * @notice Authorize contract upgrade
     * @dev Requires multi-sig approval through submitUpgradeOperation
     * @param newImplementation Address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal override {
        if (!_upgradeAuthorized) {
            revert UpgradeNotAuthorized();
        }
        _upgradeAuthorized = false;
        emit UpgradeAuthorized(_authorizedUpgradeOperation, newImplementation);
    }

    /**
     * @notice Submit an upgrade operation for multi-sig approval
     * @param newImplementation The new implementation contract address
     * @return operationId The ID of the upgrade operation
     */
    function submitUpgradeOperation(address newImplementation) external onlySigner returns (uint256 operationId) {
        require(newImplementation != address(0), "Invalid implementation");
        require(newImplementation.code.length > 0, "Implementation has no code");

        // Create the upgrade call data
        bytes memory upgradeData = abi.encodeWithSignature(
            "upgradeToAndCall(address,bytes)",
            newImplementation,
            ""
        );

        // Submit it as a regular operation targeting this contract
        operationId = submitOperation(address(this), upgradeData, 0);
        return operationId;
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
    ) public onlySigner returns (uint256 operationId) {
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

        // Special handling for upgrade operations
        if (op.target == address(this)) {
            bytes memory data = op.data;
            bytes4 selector;
            assembly {
                selector := mload(add(data, 32))
            }

            // Check if this is an upgrade call
            if (selector == bytes4(keccak256("upgradeToAndCall(address,bytes)"))) {
                _upgradeAuthorized = true;
                _authorizedUpgradeOperation = operationId;
            }
        }

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

    /**
     * @notice Get the current implementation version
     * @return string Version identifier
     */
    function version() external pure returns (string memory) {
        return "1.13.0";
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
}