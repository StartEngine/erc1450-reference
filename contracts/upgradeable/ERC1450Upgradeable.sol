// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../interfaces/IERC1450.sol";
import "../libraries/ERC1450Constants.sol";

/**
 * @title ERC1450Upgradeable
 * @dev Upgradeable implementation of the ERC-1450 RTA-Controlled Security Token Standard
 * @notice This token is designed for compliant securities offerings under SEC regulations
 *
 * IMPORTANT: This contract uses UUPS proxy pattern. Only the RTA can authorize upgrades
 * to ensure security and prevent unauthorized modifications.
 */
contract ERC1450Upgradeable is
    Initializable,
    IERC1450,
    IERC20Metadata,
    ERC165Upgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Custom Errors (ERC-6093 compliant) ============

    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);
    error ERC20InvalidSender(address sender);
    error ERC20InvalidReceiver(address receiver);

    // ============ State Variables ============

    // Token metadata
    string private _name;
    string private _symbol;
    uint8 private _decimals;

    // Token balances and supply
    mapping(address => uint256) private _balances;
    uint256 private _totalSupply;

    // RTA (Registered Transfer Agent)
    address private _transferAgent;
    bool private _transferAgentLocked;

    // Transfer request system
    uint256 private _nextRequestId;

    struct TransferRequest {
        address from;
        address to;
        uint256 amount;
        address requestedBy;
        uint256 feePaid;
        address __deprecated_feeToken; // Kept for storage compatibility with V1 requests
        RequestStatus status;
        uint256 timestamp;
    }

    mapping(uint256 => TransferRequest) public transferRequests;

    // Fee management
    uint8 public feeType; // 0: flat, 1: percentage
    uint256 public feeValue; // Amount or basis points
    /// @custom:deprecated Use feeToken instead
    address[] public acceptedFeeTokens; // DEPRECATED - kept for storage compatibility
    /// @custom:deprecated Use collectedFeesTotal instead
    mapping(address => uint256) public collectedFees; // DEPRECATED - kept for storage compatibility

    // Broker management
    mapping(address => bool) public approvedBrokers;

    // Account restrictions
    mapping(address => bool) public frozenAccounts;

    // Regulation tracking storage
    struct TokenBatch {
        uint256 amount;
        uint16 regulationType;
        uint256 issuanceDate;
    }

    // Solidity automatically initializes mappings to default values (empty arrays)
    // slither-disable-start uninitialized-state
    mapping(address => TokenBatch[]) private _holderBatches;
    // slither-disable-end uninitialized-state
    mapping(uint16 => uint256) private _regulationSupply;

    // Common US regulation types (examples, not enforced on-chain)
    uint16 public constant REG_US_S1 = 0x0001;           // S-1 Registration (IPO)
    uint16 public constant REG_US_D_504 = 0x0002;        // Regulation D Rule 504 ($10M max)
    uint16 public constant REG_US_A_TIER_1 = 0x0004;     // Regulation A Tier I ($20M max)
    uint16 public constant REG_US_A_TIER_2 = 0x0005;     // Regulation A Tier II ($75M max)
    uint16 public constant REG_US_CF = 0x0006;           // Regulation Crowdfunding ($5M max)
    uint16 public constant REG_US_D_506B = 0x0007;       // Regulation D 506(b) (no general solicitation)
    uint16 public constant REG_US_D_506C = 0x0008;       // Regulation D 506(c) (accredited only)
    uint16 public constant REG_US_S = 0x0009;            // Regulation S (offshore offerings)

    // ============ V2 Storage (Single Fee Token) ============
    // Added in upgrade to simplify fee handling - uses slots from gap

    /// @notice Single ERC-20 token for fee payments (e.g., USDC)
    address public feeToken;

    /// @notice Total collected fees in feeToken
    uint256 public collectedFeesTotal;

    // Gap for future storage variables (standard practice for upgradeable contracts)
    uint256[41] private __gap; // Reduced from 43 to 41 for feeToken and collectedFeesTotal

    // ============ Modifiers ============

    modifier onlyTransferAgent() {
        if (msg.sender != _transferAgent) {
            revert ERC1450OnlyRTA();
        }
        _;
    }

    modifier notFrozen(address account) {
        if (frozenAccounts[account]) {
            revert ERC1450ComplianceCheckFailed(account, address(0));
        }
        _;
    }

    // ============ Initializer (replaces constructor) ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address initialOwner,
        address initialTransferAgent
    ) public initializer {
        require(initialTransferAgent != address(0), "ERC1450: Invalid transfer agent");

        __Ownable_init(initialOwner);
        __ReentrancyGuard_init();
        __ERC165_init();
        __UUPSUpgradeable_init();

        _name = name_;
        _symbol = symbol_;
        _decimals = decimals_;
        _transferAgent = initialTransferAgent;
        _nextRequestId = 1;

        // Default fee configuration
        feeType = 0; // Flat fee
        feeValue = 0; // No fee initially
        feeToken = address(0); // No fee token set initially - RTA must configure
    }

    // ============ UUPS Upgrade Authorization ============

    /**
     * @notice Authorize contract upgrade
     * @dev Only the RTA can authorize upgrades for security
     * @param newImplementation Address of the new implementation
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyTransferAgent {
        // Additional validation could be added here
        // For example, checking the new implementation against a whitelist
    }

    // ============ ERC-20 Metadata ============

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }

    function decimals() public view override(IERC20Metadata, IERC1450) returns (uint8) {
        return _decimals;
    }

    // ============ ERC-20 Core (Restricted) ============

    function totalSupply() public view override returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return _balances[account];
    }

    /**
     * @notice Direct transfers are disabled for security tokens
     * @dev Always reverts with ERC1450TransferDisabled
     */
    function transfer(address, uint256) public pure override returns (bool) {
        revert ERC1450TransferDisabled();
    }

    /**
     * @notice Allowances are disabled for security tokens
     * @dev Always returns 0
     */
    function allowance(address, address) public pure override returns (uint256) {
        return 0;
    }

    /**
     * @notice Approvals are disabled for security tokens
     * @dev Always reverts with ERC1450TransferDisabled
     */
    function approve(address, uint256) public pure override returns (bool) {
        revert ERC1450TransferDisabled();
    }

    /**
     * @notice Transfer tokens - DISABLED for security tokens
     * @dev Always reverts with ERC1450TransferDisabled
     */
    function transferFrom(
        address /* from */,
        address /* to */,
        uint256 /* amount */
    ) public pure override(IERC20, IERC1450) returns (bool) {
        revert ERC1450TransferDisabled();
    }

    /**
     * @notice Transfer tokens with regulation tracking (RTA only)
     * @param from Source address
     * @param to Destination address
     * @param amount Number of tokens to transfer
     * @param regulationType Type of regulation for the transferred tokens
     * @param issuanceDate Original issuance date of the transferred tokens
     * @dev Callable only by the transfer agent after compliance checks
     */
    function transferFromRegulated(
        address from,
        address to,
        uint256 amount,
        uint16 regulationType,
        uint256 issuanceDate
    ) public override onlyTransferAgent notFrozen(from) notFrozen(to) returns (bool) {
        _transferBatch(from, to, amount, regulationType, issuanceDate);
        return true;
    }

    // ============ RTA Functions ============

    function changeIssuer(address newIssuer) external override onlyTransferAgent {
        if (newIssuer == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        address previousOwner = owner();
        _transferOwnership(newIssuer);
        emit IssuerChanged(previousOwner, newIssuer);
    }

    function setTransferAgent(address newTransferAgent) external override {
        require(newTransferAgent != address(0), "ERC1450: Invalid transfer agent");

        if (_transferAgentLocked) {
            revert ERC1450TransferAgentLocked();
        }

        // Can be called by owner initially, then only by RTA
        if (_transferAgent != address(0) && msg.sender != _transferAgent) {
            revert ERC1450OnlyRTA();
        }

        if (msg.sender != owner() && msg.sender != _transferAgent) {
            revert OwnableUnauthorizedAccount(msg.sender);
        }

        address previousAgent = _transferAgent;
        _transferAgent = newTransferAgent;

        // Lock after setting to a contract (RTAProxy pattern)
        if (newTransferAgent.code.length > 0) {
            _transferAgentLocked = true;
        }

        emit TransferAgentUpdated(previousAgent, newTransferAgent);
    }

    function isTransferAgent(address addr) external view override returns (bool) {
        return addr == _transferAgent;
    }

    function mint(address to, uint256 amount, uint16 regulationType, uint256 issuanceDate)
        external override onlyTransferAgent returns (bool) {
        if (to == address(0)) {
            revert ERC20InvalidReceiver(address(0));
        }

        // Validate regulation type and issuance date
        require(regulationType > 0, "ERC1450: Invalid regulation type");
        require(issuanceDate > 0, "ERC1450: Invalid issuance date");
        require(issuanceDate <= block.timestamp, "ERC1450: Future issuance date not allowed");

        _totalSupply += amount;
        unchecked {
            _balances[to] += amount;
        }

        // Track regulation details
        _addTokenBatch(to, amount, regulationType, issuanceDate);
        _regulationSupply[regulationType] += amount;

        emit Transfer(address(0), to, amount);
        emit TokensMinted(to, amount, regulationType, issuanceDate, block.timestamp);
        return true;
    }

    function batchMint(
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint16[] calldata regulationTypes,
        uint256[] calldata issuanceDates
    ) external override onlyTransferAgent returns (bool) {
        // Validate array lengths
        require(
            recipients.length == amounts.length &&
            recipients.length == regulationTypes.length &&
            recipients.length == issuanceDates.length,
            "ERC1450: Array length mismatch"
        );

        require(recipients.length > 0, "ERC1450: Empty batch");
        require(recipients.length <= 100, "ERC1450: Batch too large"); // Reasonable limit to prevent gas issues

        // Process each mint
        for (uint256 i = 0; i < recipients.length; i++) {
            address to = recipients[i];
            uint256 amount = amounts[i];
            uint16 regulationType = regulationTypes[i];
            uint256 issuanceDate = issuanceDates[i];

            // Validate each mint (same rules as individual mint)
            if (to == address(0)) {
                revert ERC20InvalidReceiver(address(0));
            }

            require(regulationType > 0, "ERC1450: Invalid regulation type");
            require(issuanceDate > 0, "ERC1450: Invalid issuance date");
            require(issuanceDate <= block.timestamp, "ERC1450: Future issuance date not allowed");

            // Update balances and supply
            _totalSupply += amount;
            unchecked {
                _balances[to] += amount;
            }

            // Track regulation details
            _addTokenBatch(to, amount, regulationType, issuanceDate);
            _regulationSupply[regulationType] += amount;

            // Emit events for each mint
            emit Transfer(address(0), to, amount);
            emit TokensMinted(to, amount, regulationType, issuanceDate, block.timestamp);
        }

        return true;
    }

    function burnFromRegulation(address from, uint256 amount, uint16 regulationType)
        external override onlyTransferAgent returns (bool) {
        if (from == address(0)) {
            revert ERC20InvalidSender(address(0));
        }

        uint256 fromBalance = _balances[from];
        if (fromBalance < amount) {
            revert ERC20InsufficientBalance(from, fromBalance, amount);
        }

        // Burn tokens of specific regulation type
        uint256 remainingToBurn = amount;
        TokenBatch[] storage batches = _holderBatches[from];

        for (uint256 i = 0; i < batches.length && remainingToBurn > 0; i++) {
            if (batches[i].regulationType == regulationType && batches[i].amount > 0) {
                uint256 burnFromBatch = batches[i].amount > remainingToBurn ? remainingToBurn : batches[i].amount;

                batches[i].amount -= burnFromBatch;
                remainingToBurn -= burnFromBatch;
                _regulationSupply[regulationType] -= burnFromBatch;

                emit TokensBurned(from, burnFromBatch, regulationType, batches[i].issuanceDate);
            }
        }

        // Clean up empty batches (iterate backwards to avoid index issues)
        for (uint256 i = batches.length; i > 0; i--) {
            if (batches[i - 1].amount == 0) {
                batches[i - 1] = batches[batches.length - 1];
                batches.pop();
            }
        }

        require(remainingToBurn == 0, "ERC1450: Insufficient tokens of specified regulation");

        unchecked {
            _balances[from] = fromBalance - amount;
            _totalSupply -= amount;
        }

        emit Transfer(from, address(0), amount);
        return true;
    }

    /**
     * @notice Burn tokens from an account with regulation tracking (RTA only)
     */
    function burnFromRegulated(
        address from,
        uint256 amount,
        uint16 regulationType,
        uint256 issuanceDate
    ) external override onlyTransferAgent returns (bool) {
        return _burnFromRegulated(from, amount, regulationType, issuanceDate);
    }

    /**
     * @dev Internal function to burn tokens with regulation tracking.
     * This is called by both burnFromRegulated and batchBurnFrom to avoid
     * external calls that would change msg.sender.
     */
    function _burnFromRegulated(
        address from,
        uint256 amount,
        uint16 regulationType,
        uint256 issuanceDate
    ) internal returns (bool) {
        if (from == address(0)) {
            revert ERC20InvalidSender(address(0));
        }

        // Find and burn from specific batch
        TokenBatch[] storage batches = _holderBatches[from];
        bool found = false;

        for (uint256 i = 0; i < batches.length; i++) {
            if (batches[i].regulationType == regulationType &&
                batches[i].issuanceDate == issuanceDate) {
                require(batches[i].amount >= amount, "ERC1450: Insufficient batch balance");

                unchecked {
                    batches[i].amount -= amount;
                    _balances[from] -= amount;
                    _totalSupply -= amount;
                    _regulationSupply[regulationType] -= amount;
                }

                // Remove batch if empty
                if (batches[i].amount == 0) {
                    batches[i] = batches[batches.length - 1];
                    batches.pop();
                }

                found = true;
                emit TokensBurned(from, amount, regulationType, issuanceDate);
                emit Transfer(from, address(0), amount);
                break;
            }
        }

        require(found, "ERC1450: Batch not found");
        return true;
    }

    /**
     * @notice Batch transfer tokens between multiple address pairs with regulation tracking
     */
    function batchTransferFrom(
        address[] calldata froms,
        address[] calldata tos,
        uint256[] calldata amounts,
        uint16[] calldata regulationTypes,
        uint256[] calldata issuanceDates
    ) external override onlyTransferAgent returns (bool) {
        require(
            froms.length == tos.length &&
            froms.length == amounts.length &&
            froms.length == regulationTypes.length &&
            froms.length == issuanceDates.length,
            "ERC1450: Array length mismatch"
        );

        for (uint256 i = 0; i < froms.length; i++) {
            _transferBatch(froms[i], tos[i], amounts[i], regulationTypes[i], issuanceDates[i]);
        }

        return true;
    }

    /**
     * @notice Batch burn tokens from multiple addresses with regulation tracking
     */
    function batchBurnFrom(
        address[] calldata froms,
        uint256[] calldata amounts,
        uint16[] calldata regulationTypes,
        uint256[] calldata issuanceDates
    ) external override onlyTransferAgent returns (bool) {
        require(
            froms.length == amounts.length &&
            froms.length == regulationTypes.length &&
            froms.length == issuanceDates.length,
            "ERC1450: Array length mismatch"
        );

        for (uint256 i = 0; i < froms.length; i++) {
            // Call internal function to preserve msg.sender (RTAProxy)
            _burnFromRegulated(froms[i], amounts[i], regulationTypes[i], issuanceDates[i]);
        }

        return true;
    }

    function getHolderRegulations(address holder) external view override returns (
        uint16[] memory regulationTypes,
        uint256[] memory amounts,
        uint256[] memory issuanceDates
    ) {
        TokenBatch[] memory batches = _holderBatches[holder];
        uint256 batchCount = batches.length;

        regulationTypes = new uint16[](batchCount);
        amounts = new uint256[](batchCount);
        issuanceDates = new uint256[](batchCount);

        for (uint256 i = 0; i < batchCount; i++) {
            regulationTypes[i] = batches[i].regulationType;
            amounts[i] = batches[i].amount;
            issuanceDates[i] = batches[i].issuanceDate;
        }
    }

    function getRegulationSupply(uint16 regulationType) external view override returns (uint256) {
        return _regulationSupply[regulationType];
    }

    /**
     * @notice Get detailed batch information for a holder's tokens
     */
    function getDetailedBatchInfo(address holder) external view override returns (
        uint256 count,
        uint16[] memory regulationTypes,
        uint256[] memory issuanceDates,
        uint256[] memory amounts
    ) {
        TokenBatch[] memory batches = _holderBatches[holder];
        count = batches.length;

        regulationTypes = new uint16[](count);
        issuanceDates = new uint256[](count);
        amounts = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            regulationTypes[i] = batches[i].regulationType;
            issuanceDates[i] = batches[i].issuanceDate;
            amounts[i] = batches[i].amount;
        }
    }

    function burnFrom(address from, uint256 amount) external override onlyTransferAgent returns (bool) {
        if (from == address(0)) {
            revert ERC20InvalidSender(address(0));
        }

        uint256 fromBalance = _balances[from];
        if (fromBalance < amount) {
            revert ERC20InsufficientBalance(from, fromBalance, amount);
        }

        // Burn tokens, emitting TokensBurned events for each regulation
        _burnTokens(from, amount);

        unchecked {
            _balances[from] = fromBalance - amount;
            _totalSupply -= amount;
        }

        emit Transfer(from, address(0), amount);
        return true;
    }

    // ============ Transfer Request System ============

    function requestTransferWithFee(
        address from,
        address to,
        uint256 amount,
        uint256 feeAmount
    ) external override nonReentrant returns (uint256 requestId) {
        // Validate request
        if (from == address(0) || to == address(0)) {
            revert ERC20InvalidReceiver(address(0));
        }

        // Check frozen status - frozen accounts cannot request transfers
        if (frozenAccounts[from]) {
            revert ERC1450ComplianceCheckFailed(from, address(0));
        }

        // Check authorization (must be token holder or approved broker)
        if (msg.sender != from && !approvedBrokers[msg.sender]) {
            revert OwnableUnauthorizedAccount(msg.sender);
        }

        // Validate fee token is configured
        require(feeToken != address(0), "ERC1450: Fee token not configured");

        // Collect fee
        if (feeAmount > 0) {
            IERC20(feeToken).safeTransferFrom(msg.sender, address(this), feeAmount);
            collectedFeesTotal += feeAmount;
        }

        // Create request
        requestId = _nextRequestId++;
        transferRequests[requestId] = TransferRequest({
            from: from,
            to: to,
            amount: amount,
            requestedBy: msg.sender,
            feePaid: feeAmount,
            __deprecated_feeToken: address(0), // Not used in V2 - kept for struct compatibility
            status: RequestStatus.Requested,
            timestamp: block.timestamp
        });

        emit TransferRequested(requestId, from, to, amount, feeAmount, msg.sender);
        return requestId;
    }

    function processTransferRequest(uint256 requestId, bool approved) external override onlyTransferAgent {
        TransferRequest storage request = transferRequests[requestId];

        // Prevent replay attacks - reject already finalized requests
        require(
            request.status != RequestStatus.Executed && request.status != RequestStatus.Rejected,
            "ERC1450: Request already finalized"
        );

        if (approved) {
            // Check frozen status - use controllerTransfer for frozen account transfers
            if (frozenAccounts[request.from]) {
                revert ERC1450ComplianceCheckFailed(request.from, address(0));
            }
            if (frozenAccounts[request.to]) {
                revert ERC1450ComplianceCheckFailed(request.to, address(0));
            }

            // APPROVE: Update status and execute transfer
            if (request.status != RequestStatus.Approved) {
                _updateRequestStatus(requestId, RequestStatus.Approved);
            }

            // Execute the transfer
            _transfer(request.from, request.to, request.amount);

            // Update status to executed
            _updateRequestStatus(requestId, RequestStatus.Executed);

            emit TransferExecuted(requestId, request.from, request.to, request.amount);
        } else {
            // REJECT: Update status to rejected (no fee refund in this simplified path)
            _updateRequestStatus(requestId, RequestStatus.Rejected);

            emit TransferRejected(requestId, 0, false);
        }
    }

    function rejectTransferRequest(
        uint256 requestId,
        uint16 reasonCode,
        bool refundFee
    ) external override onlyTransferAgent {
        TransferRequest storage request = transferRequests[requestId];

        // Prevent replay attacks - reject already finalized requests
        require(
            request.status != RequestStatus.Executed && request.status != RequestStatus.Rejected,
            "ERC1450: Request already finalized"
        );

        _updateRequestStatus(requestId, RequestStatus.Rejected);

        // Handle fee refund if requested (CEI pattern: update state before external calls)
        if (refundFee && request.feePaid > 0) {
            // Check if this is a V1 request (has legacy feeToken) or V2 request
            if (request.__deprecated_feeToken != address(0)) {
                // V1 legacy request - refund from old collectedFees mapping
                collectedFees[request.__deprecated_feeToken] -= request.feePaid;
                IERC20(request.__deprecated_feeToken).safeTransfer(request.requestedBy, request.feePaid);
            } else {
                // V2 request - refund from collectedFeesTotal
                collectedFeesTotal -= request.feePaid;
                IERC20(feeToken).safeTransfer(request.requestedBy, request.feePaid);
            }
        }

        emit TransferRejected(requestId, reasonCode, refundFee);
    }

    function updateRequestStatus(uint256 requestId, RequestStatus newStatus) external override onlyTransferAgent {
        _updateRequestStatus(requestId, newStatus);
    }

    // ============ Fee Management ============

    function getTransferFee(
        address, // from
        address, // to
        uint256 amount
    ) external view override returns (uint256 feeAmount) {
        // Calculate fee based on fee type
        if (feeType == 0) {
            // Flat fee
            feeAmount = feeValue;
        } else if (feeType == 1) {
            // Percentage fee (in basis points)
            feeAmount = (amount * feeValue) / 10000;
        } else {
            // Unknown fee type - return flat fee as fallback
            feeAmount = feeValue;
        }
    }

    function getFeeToken() external view override returns (address) {
        return feeToken;
    }

    function setFeeToken(address newFeeToken) external override onlyTransferAgent {
        require(newFeeToken != address(0), "ERC1450: Invalid fee token");
        address previousToken = feeToken;
        feeToken = newFeeToken;
        emit FeeTokenUpdated(previousToken, newFeeToken);
    }

    function setFeeParameters(
        uint8 newFeeType,
        uint256 newFeeValue
    ) external override onlyTransferAgent {
        require(newFeeType <= 1, "ERC1450: Invalid fee type (0=flat, 1=percentage)");
        feeType = newFeeType;
        feeValue = newFeeValue;
        emit FeeParametersUpdated(newFeeType, newFeeValue);
    }

    function withdrawFees(
        uint256 amount,
        address recipient
    ) external override onlyTransferAgent {
        require(recipient != address(0), "ERC1450: Invalid recipient");
        require(feeToken != address(0), "ERC1450: Fee token not configured");

        if (collectedFeesTotal < amount) {
            revert ERC20InsufficientBalance(address(this), collectedFeesTotal, amount);
        }

        collectedFeesTotal -= amount;
        IERC20(feeToken).safeTransfer(recipient, amount);

        emit FeesWithdrawn(amount, recipient);
    }

    /// @notice Withdraw legacy fees collected before V2 upgrade (RTA only)
    /// @param token The legacy fee token to withdraw
    /// @param amount Amount to withdraw
    /// @param recipient Recipient address
    function withdrawLegacyFees(
        address token,
        uint256 amount,
        address recipient
    ) external onlyTransferAgent {
        require(recipient != address(0), "ERC1450: Invalid recipient");
        require(collectedFees[token] >= amount, "ERC1450: Insufficient legacy fees");

        collectedFees[token] -= amount;

        if (token == address(0)) {
            payable(recipient).transfer(amount);
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    // ============ Broker Management ============

    function setBrokerStatus(address broker, bool approved) external override onlyTransferAgent {
        approvedBrokers[broker] = approved;
        emit BrokerStatusUpdated(broker, approved, msg.sender);
    }

    function isRegisteredBroker(address broker) external view override returns (bool) {
        return approvedBrokers[broker];
    }

    // ============ Account Restrictions ============

    function setAccountFrozen(address account, bool frozen) external override onlyTransferAgent {
        frozenAccounts[account] = frozen;
        emit AccountFrozen(account, frozen, msg.sender);
    }

    function isAccountFrozen(address account) external view override returns (bool) {
        return frozenAccounts[account];
    }

    // ============ Controller Operations (ERC-1644) ============

    function controllerTransfer(
        address from,
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata operatorData
    ) external override onlyTransferAgent {
        // Force transfer regardless of frozen status
        _transfer(from, to, value);

        // Emit ERC-1644 standard event
        emit ControllerTransfer(msg.sender, from, to, value, data, operatorData);
    }

    // ============ Introspection ============

    function isSecurityToken() external pure override returns (bool) {
        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165Upgradeable, IERC165) returns (bool) {
        return
            interfaceId == 0xaf175dee || // IERC1450
            // Note: We do NOT report ERC-20 support to prevent wallets from assuming
            // standard transfer() behavior works. ERC-1450 tokens disable direct transfers.
            interfaceId == type(IERC20Metadata).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // ============ Internal Functions ============

    function _transfer(address from, address to, uint256 amount) internal {
        if (from == address(0)) {
            revert ERC20InvalidSender(address(0));
        }
        if (to == address(0)) {
            revert ERC20InvalidReceiver(address(0));
        }

        uint256 fromBalance = _balances[from];
        if (fromBalance < amount) {
            revert ERC20InsufficientBalance(from, fromBalance, amount);
        }

        unchecked {
            _balances[from] = fromBalance - amount;
            _balances[to] += amount;
        }

        emit Transfer(from, to, amount);
    }

    /**
     * @dev Transfer specific batch of tokens
     */
    function _transferBatch(
        address from,
        address to,
        uint256 amount,
        uint16 regulationType,
        uint256 issuanceDate
    ) internal {
        if (from == address(0)) {
            revert ERC20InvalidSender(address(0));
        }
        if (to == address(0)) {
            revert ERC20InvalidReceiver(address(0));
        }

        // Find and transfer from specific batch
        TokenBatch[] storage fromBatches = _holderBatches[from];
        bool found = false;

        for (uint256 i = 0; i < fromBatches.length; i++) {
            if (fromBatches[i].regulationType == regulationType &&
                fromBatches[i].issuanceDate == issuanceDate) {
                require(fromBatches[i].amount >= amount, "ERC1450: Insufficient batch balance");

                unchecked {
                    fromBatches[i].amount -= amount;
                    _balances[from] -= amount;
                    _balances[to] += amount;
                }

                // Remove batch if empty
                if (fromBatches[i].amount == 0) {
                    fromBatches[i] = fromBatches[fromBatches.length - 1];
                    fromBatches.pop();
                }

                // Add to recipient's batches
                _addTokenBatch(to, amount, regulationType, issuanceDate);

                found = true;
                emit Transfer(from, to, amount);
                emit RegulatedTransfer(from, to, amount, regulationType, issuanceDate);
                break;
            }
        }

        require(found, "ERC1450: Batch not found");
    }

    function _updateRequestStatus(uint256 requestId, RequestStatus newStatus) internal {
        TransferRequest storage request = transferRequests[requestId];
        RequestStatus oldStatus = request.status;
        request.status = newStatus;

        emit RequestStatusChanged(requestId, oldStatus, newStatus, block.timestamp);
    }

    // ============ Emergency Functions ============

    /**
     * @notice Allow contract to receive ETH
     * @dev Emits ETHReceived event for tracking
     * Can be recovered using recoverToken(address(0), amount)
     */
    receive() external payable {
        emit ETHReceived(msg.sender, msg.value);
    }

    /**
     * @notice Event emitted when ETH is received
     */
    event ETHReceived(address indexed from, uint256 amount);

    /**
     * @notice Emergency function to recover accidentally sent tokens
     * @dev Only callable by RTA, cannot withdraw the security token itself
     */
    function recoverToken(address token, uint256 amount) external onlyTransferAgent {
        if (token == address(this)) {
            revert ERC1450OnlyRTA(); // Cannot withdraw the security token
        }

        if (token == address(0)) {
            payable(_transferAgent).transfer(amount);
        } else {
            IERC20(token).safeTransfer(_transferAgent, amount);
        }
    }

    /**
     * @notice Get the current implementation version
     * @return string Version identifier
     */
    function version() external pure returns (string memory) {
        return "1.16.0";
    }

    // ============ Internal Regulation Tracking Functions ============

    function _addTokenBatch(address to, uint256 amount, uint16 regulationType, uint256 issuanceDate) internal {
        TokenBatch[] storage batches = _holderBatches[to];

        // Try to merge with existing batch of same regulation and date
        for (uint256 i = 0; i < batches.length; i++) {
            if (batches[i].regulationType == regulationType && batches[i].issuanceDate == issuanceDate) {
                batches[i].amount += amount;
                return;
            }
        }

        // Add new batch if no match found
        batches.push(TokenBatch(amount, regulationType, issuanceDate));
    }

    function _burnTokens(address from, uint256 amount) internal {
        TokenBatch[] storage batches = _holderBatches[from];
        uint256 remainingToBurn = amount;

        for (uint256 i = 0; i < batches.length && remainingToBurn > 0; i++) {
            if (batches[i].amount > 0) {
                uint256 burnFromBatch = batches[i].amount > remainingToBurn ? remainingToBurn : batches[i].amount;

                batches[i].amount -= burnFromBatch;
                remainingToBurn -= burnFromBatch;
                _regulationSupply[batches[i].regulationType] -= burnFromBatch;

                emit TokensBurned(from, burnFromBatch, batches[i].regulationType, batches[i].issuanceDate);
            }
        }

        // Clean up empty batches (iterate backwards to avoid index issues)
        for (uint256 i = batches.length; i > 0; i--) {
            if (batches[i - 1].amount == 0) {
                batches[i - 1] = batches[batches.length - 1];
                batches.pop();
            }
        }
    }

}