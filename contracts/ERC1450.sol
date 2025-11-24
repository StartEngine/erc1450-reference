// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IERC1450.sol";
import "./libraries/ERC1450Constants.sol";

/**
 * @title ERC1450
 * @dev Reference implementation of the ERC-1450 RTA-Controlled Security Token Standard
 * @notice This token is designed for compliant securities offerings under SEC regulations
 */
contract ERC1450 is IERC1450, IERC20Metadata, ERC165, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Custom Errors (ERC-6093 compliant) ============

    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);
    error ERC20InvalidSender(address sender);
    error ERC20InvalidReceiver(address receiver);

    // ============ State Variables ============

    // Token metadata
    string private _name;
    string private _symbol;
    uint8 private immutable _decimals;

    // Token balances and supply
    mapping(address => uint256) private _balances;
    uint256 private _totalSupply;

    // RTA (Registered Transfer Agent)
    address private _transferAgent;
    bool private _transferAgentLocked;

    // Transfer request system
    uint256 private _nextRequestId = 1;

    struct TransferRequest {
        address from;
        address to;
        uint256 amount;
        address requestedBy;
        uint256 feePaid;
        address feeToken;
        RequestStatus status;
        uint256 timestamp;
    }

    mapping(uint256 => TransferRequest) public transferRequests;

    // Fee management
    uint8 public feeType; // 0: flat, 1: percentage, 2: tiered
    uint256 public feeValue; // Amount or basis points
    address[] public acceptedFeeTokens;
    mapping(address => uint256) public collectedFees;

    // Broker management
    mapping(address => bool) public approvedBrokers;

    // Account restrictions
    mapping(address => bool) public frozenAccounts;

    // ============ Regulation Tracking ============

    /**
     * @dev Structure to track tokens by regulation and issuance date
     */
    struct TokenBatch {
        uint256 amount;
        uint16 regulationType;
        uint256 issuanceDate;
    }

    // Holder address => array of token batches (FIFO ordered)
    // Solidity automatically initializes mappings to default values (empty arrays)
    // slither-disable-start uninitialized-state
    mapping(address => TokenBatch[]) private _holderBatches;
    // slither-disable-end uninitialized-state

    // Track total supply per regulation type
    mapping(uint16 => uint256) private _regulationSupply;

    // Common US regulation types (examples, not enforced on-chain)
    uint16 public constant REG_US_S1 = 0x0001;           // S-1 Registration (IPO)
    uint16 public constant REG_US_A_TIER_1 = 0x0004;     // Regulation A Tier I
    uint16 public constant REG_US_A_TIER_2 = 0x0005;     // Regulation A Tier II
    uint16 public constant REG_US_CF = 0x0006;           // Regulation Crowdfunding
    uint16 public constant REG_US_D_506B = 0x0007;       // Regulation D 506(b)
    uint16 public constant REG_US_D_506C = 0x0008;       // Regulation D 506(c)
    uint16 public constant REG_US_S = 0x0009;            // Regulation S

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

    // ============ Constructor ============

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address initialOwner,
        address initialTransferAgent
    ) Ownable(initialOwner) {
        require(initialTransferAgent != address(0), "ERC1450: Invalid transfer agent");
        _name = name_;
        _symbol = symbol_;
        _decimals = decimals_;
        _transferAgent = initialTransferAgent;

        // Default fee configuration
        feeType = 0; // Flat fee
        feeValue = 0; // No fee initially
        acceptedFeeTokens.push(address(0)); // Accept native token by default
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
        address from,
        address to,
        uint256 amount
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

    function mint(
        address to,
        uint256 amount,
        uint16 regulationType,
        uint256 issuanceDate
    ) external override onlyTransferAgent returns (bool) {
        if (to == address(0)) {
            revert ERC20InvalidReceiver(address(0));
        }
        require(regulationType > 0, "ERC1450: Invalid regulation type");
        require(issuanceDate > 0, "ERC1450: Invalid issuance date");
        require(issuanceDate <= block.timestamp, "ERC1450: Future issuance date not allowed");

        _totalSupply += amount;
        unchecked {
            _balances[to] += amount;
        }

        // Add to holder's token batches (maintaining FIFO order by issuanceDate)
        _addTokenBatch(to, amount, regulationType, issuanceDate);

        // Track total supply per regulation
        _regulationSupply[regulationType] += amount;

        // Emit both standard Transfer and new TokensMinted events
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

            // Add to holder's token batches
            _addTokenBatch(to, amount, regulationType, issuanceDate);

            // Track total supply per regulation
            _regulationSupply[regulationType] += amount;

            // Emit events for each mint
            emit Transfer(address(0), to, amount);
            emit TokensMinted(to, amount, regulationType, issuanceDate, block.timestamp);
        }

        return true;
    }

    /**
     * @notice Burn tokens from an account (RTA only) - Uses RTA's chosen strategy
     * @dev The RTA determines which tokens to burn based on their strategy
     */
    function burnFrom(address from, uint256 amount) external override onlyTransferAgent returns (bool) {
        if (from == address(0)) {
            revert ERC20InvalidSender(address(0));
        }

        uint256 fromBalance = _balances[from];
        if (fromBalance < amount) {
            revert ERC20InsufficientBalance(from, fromBalance, amount);
        }

        unchecked {
            _balances[from] = fromBalance - amount;
            _totalSupply -= amount;
        }

        // Burn tokens using FIFO, emitting TokensBurned events for each regulation
        _burnTokensFIFO(from, amount);

        emit Transfer(from, address(0), amount);
        return true;
    }

    function burnFromRegulation(
        address from,
        uint256 amount,
        uint16 regulationType
    ) external override onlyTransferAgent returns (bool) {
        if (from == address(0)) {
            revert ERC20InvalidSender(address(0));
        }

        // Check if holder has enough tokens of this specific regulation
        uint256 regulationBalance = _getRegulationBalance(from, regulationType);
        require(regulationBalance >= amount, "ERC1450: Insufficient regulation balance");

        uint256 fromBalance = _balances[from];
        unchecked {
            _balances[from] = fromBalance - amount;
            _totalSupply -= amount;
            _regulationSupply[regulationType] -= amount;
        }

        // Burn specific regulation tokens
        _burnSpecificRegulation(from, amount, regulationType);

        emit Transfer(from, address(0), amount);
        return true;
    }

    /**
     * @notice Burn tokens from an account with regulation tracking (RTA only)
     * @param from Address from which to burn tokens
     * @param amount Number of tokens to burn
     * @param regulationType Type of regulation for the tokens to burn
     * @param issuanceDate Original issuance date of the tokens to burn
     */
    function burnFromRegulated(
        address from,
        uint256 amount,
        uint16 regulationType,
        uint256 issuanceDate
    ) external override onlyTransferAgent returns (bool) {
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

    // ============ Regulation Query Functions ============

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

    // ============ Batch Operations ============

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
            // Reuse burnFromBatch logic
            this.burnFromRegulated(froms[i], amounts[i], regulationTypes[i], issuanceDates[i]);
        }

        return true;
    }

    // ============ Transfer Request System ============

    function requestTransferWithFee(
        address from,
        address to,
        uint256 amount,
        address feeToken,
        uint256 feeAmount
    ) external payable override nonReentrant returns (uint256 requestId) {
        // Validate request
        if (from == address(0) || to == address(0)) {
            revert ERC20InvalidReceiver(address(0));
        }

        // Check authorization (must be token holder or approved broker)
        if (msg.sender != from && !approvedBrokers[msg.sender]) {
            revert OwnableUnauthorizedAccount(msg.sender);
        }

        // Validate fee payment
        if (!_isAcceptedFeeToken(feeToken)) {
            revert ERC20InvalidReceiver(feeToken);
        }

        // Collect fee
        if (feeAmount > 0) {
            if (feeToken == address(0)) {
                // Native token payment
                if (msg.value != feeAmount) {
                    revert ERC20InsufficientBalance(msg.sender, msg.value, feeAmount);
                }
                collectedFees[address(0)] += feeAmount;
            } else {
                // ERC20 token payment
                IERC20(feeToken).safeTransferFrom(msg.sender, address(this), feeAmount);
                collectedFees[feeToken] += feeAmount;
            }
        }

        // Create request
        requestId = _nextRequestId++;
        transferRequests[requestId] = TransferRequest({
            from: from,
            to: to,
            amount: amount,
            requestedBy: msg.sender,
            feePaid: feeAmount,
            feeToken: feeToken,
            status: RequestStatus.Requested,
            timestamp: block.timestamp
        });

        emit TransferRequested(requestId, from, to, amount, feeAmount, msg.sender);
        return requestId;
    }

    function processTransferRequest(uint256 requestId) external override onlyTransferAgent {
        TransferRequest storage request = transferRequests[requestId];

        // Prevent replay attacks - reject already finalized requests
        require(
            request.status != RequestStatus.Executed && request.status != RequestStatus.Rejected,
            "ERC1450: Request already finalized"
        );

        if (request.status != RequestStatus.Approved) {
            // Update status to approved first
            _updateRequestStatus(requestId, RequestStatus.Approved);
        }

        // Execute the transfer
        _transfer(request.from, request.to, request.amount);

        // Update status to executed
        _updateRequestStatus(requestId, RequestStatus.Executed);

        emit TransferExecuted(requestId, request.from, request.to, request.amount);
    }

    function rejectTransferRequest(
        uint256 requestId,
        uint16 reasonCode,
        bool refundFee
    ) external override onlyTransferAgent {
        TransferRequest storage request = transferRequests[requestId];

        _updateRequestStatus(requestId, RequestStatus.Rejected);

        // Handle fee refund if requested
        if (refundFee && request.feePaid > 0) {
            if (request.feeToken == address(0)) {
                // Refund native token
                payable(request.requestedBy).transfer(request.feePaid);
            } else {
                // Refund ERC20 token
                IERC20(request.feeToken).safeTransfer(request.requestedBy, request.feePaid);
            }
            collectedFees[request.feeToken] -= request.feePaid;
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
        uint256 amount,
        address feeToken
    ) external view override returns (uint256 feeAmount) {
        // Check if the fee token is accepted
        if (!_isAcceptedFeeToken(feeToken)) {
            return 0;
        }

        // Calculate fee based on fee type
        if (feeType == 0) {
            // Flat fee
            feeAmount = feeValue;
        } else if (feeType == 1) {
            // Percentage fee (in basis points)
            feeAmount = (amount * feeValue) / 10000;
        } else {
            // Tiered or custom logic
            feeAmount = feeValue;
        }

        // In a real implementation, you might adjust fee based on the token
        // For example, different amounts for different tokens based on their value
        // This is a simplified version that returns the same fee for all accepted tokens
    }

    function getAcceptedFeeTokens() external view override returns (address[] memory) {
        return acceptedFeeTokens;
    }

    function setFeeParameters(
        uint8 newFeeType,
        uint256 newFeeValue,
        address[] calldata newAcceptedTokens
    ) external override onlyTransferAgent {
        feeType = newFeeType;
        feeValue = newFeeValue;
        acceptedFeeTokens = newAcceptedTokens;

        emit FeeParametersUpdated(newFeeType, newFeeValue, newAcceptedTokens);
    }

    function withdrawFees(
        address token,
        uint256 amount,
        address recipient
    ) external override onlyTransferAgent {
        require(recipient != address(0), "ERC1450: Invalid recipient");

        if (collectedFees[token] < amount) {
            revert ERC20InsufficientBalance(address(this), collectedFees[token], amount);
        }

        collectedFees[token] -= amount;

        if (token == address(0)) {
            payable(recipient).transfer(amount);
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }

        emit FeesWithdrawn(token, amount, recipient);
    }

    // ============ Broker Management ============

    function setBrokerStatus(address broker, bool approved) external override onlyTransferAgent {
        approvedBrokers[broker] = approved;
        emit BrokerStatusUpdated(broker, approved, msg.sender);
    }

    function isBroker(address broker) external view override returns (bool) {
        return approvedBrokers[broker];
    }

    // ============ Account Restrictions ============

    function setAccountFrozen(address account, bool frozen) external override onlyTransferAgent {
        frozenAccounts[account] = frozen;
    }

    function isAccountFrozen(address account) external view override returns (bool) {
        return frozenAccounts[account];
    }

    // ============ Court Orders ============

    function executeCourtOrder(
        address from,
        address to,
        uint256 amount,
        bytes32 documentHash
    ) external override onlyTransferAgent {
        // Force transfer regardless of frozen status
        _transfer(from, to, amount);

        // Emit event with document hash for audit trail
        emit CourtOrderExecuted(from, to, amount, documentHash, block.timestamp);
    }

    // ============ Introspection ============

    function isSecurityToken() external pure override returns (bool) {
        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return
            interfaceId == 0xaf175dee || // IERC1450
            interfaceId == type(IERC20).interfaceId ||
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

        // Transfer tokens using FIFO to maintain regulation tracking
        _transferTokensFIFO(from, to, amount);

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

    function _isAcceptedFeeToken(address token) internal view returns (bool) {
        for (uint i = 0; i < acceptedFeeTokens.length; i++) {
            if (acceptedFeeTokens[i] == token) {
                return true;
            }
        }
        return false;
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

    // ============ Regulation Tracking Internal Functions ============

    /**
     * @dev Add tokens to holder's batches, maintaining FIFO order by issuance date
     */
    function _addTokenBatch(
        address holder,
        uint256 amount,
        uint16 regulationType,
        uint256 issuanceDate
    ) internal {
        TokenBatch[] storage batches = _holderBatches[holder];

        // Find the correct position to insert (maintain order by issuanceDate)
        uint256 insertIndex = batches.length;
        for (uint256 i = 0; i < batches.length; i++) {
            if (batches[i].issuanceDate > issuanceDate) {
                insertIndex = i;
                break;
            }
            // If same regulation and date, merge with existing batch
            if (batches[i].regulationType == regulationType &&
                batches[i].issuanceDate == issuanceDate) {
                batches[i].amount += amount;
                return;
            }
        }

        // Insert new batch at the correct position
        TokenBatch memory newBatch = TokenBatch({
            amount: amount,
            regulationType: regulationType,
            issuanceDate: issuanceDate
        });

        if (insertIndex == batches.length) {
            batches.push(newBatch);
        } else {
            // Shift elements and insert
            batches.push(batches[batches.length - 1]);
            for (uint256 i = batches.length - 1; i > insertIndex; i--) {
                batches[i] = batches[i - 1];
            }
            batches[insertIndex] = newBatch;
        }
    }

    /**
     * @dev Burn tokens using FIFO, emitting TokensBurned events for each regulation
     */
    function _burnTokensFIFO(address from, uint256 amount) internal {
        TokenBatch[] storage batches = _holderBatches[from];
        uint256 remaining = amount;
        uint256 i = 0;

        while (remaining > 0 && i < batches.length) {
            if (batches[i].amount > 0) {
                uint256 burnAmount = batches[i].amount > remaining ? remaining : batches[i].amount;

                batches[i].amount -= burnAmount;
                _regulationSupply[batches[i].regulationType] -= burnAmount;
                remaining -= burnAmount;

                // Emit TokensBurned event for this regulation
                emit TokensBurned(from, burnAmount, batches[i].regulationType, batches[i].issuanceDate);
            }
            i++;
        }

        // Clean up empty batches
        _cleanupEmptyBatches(from);
    }

    /**
     * @dev Burn tokens of a specific regulation type
     */
    function _burnSpecificRegulation(address from, uint256 amount, uint16 regulationType) internal {
        TokenBatch[] storage batches = _holderBatches[from];
        uint256 remaining = amount;
        uint256 oldestIssuance = 0;

        // Burn from oldest issuance date first (FIFO within regulation)
        for (uint256 i = 0; i < batches.length && remaining > 0; i++) {
            if (batches[i].regulationType == regulationType && batches[i].amount > 0) {
                uint256 burnAmount = batches[i].amount > remaining ? remaining : batches[i].amount;

                batches[i].amount -= burnAmount;
                remaining -= burnAmount;

                if (oldestIssuance == 0) {
                    oldestIssuance = batches[i].issuanceDate;
                }

                // Emit TokensBurned event
                emit TokensBurned(from, burnAmount, regulationType, batches[i].issuanceDate);
            }
        }

        // Clean up empty batches
        _cleanupEmptyBatches(from);
    }

    /**
     * @dev Transfer tokens using FIFO
     */
    function _transferTokensFIFO(address from, address to, uint256 amount) internal {
        TokenBatch[] storage fromBatches = _holderBatches[from];
        uint256 remaining = amount;
        uint256 i = 0;

        while (remaining > 0 && i < fromBatches.length) {
            if (fromBatches[i].amount > 0) {
                uint256 transferAmount = fromBatches[i].amount > remaining ? remaining : fromBatches[i].amount;

                fromBatches[i].amount -= transferAmount;
                remaining -= transferAmount;

                // Add to recipient's batches
                _addTokenBatch(to, transferAmount, fromBatches[i].regulationType, fromBatches[i].issuanceDate);
            }
            i++;
        }

        // Clean up empty batches
        _cleanupEmptyBatches(from);
    }

    /**
     * @dev Get balance of a specific regulation type for a holder
     */
    function _getRegulationBalance(address holder, uint16 regulationType) internal view returns (uint256) {
        TokenBatch[] memory batches = _holderBatches[holder];
        uint256 balance = 0;

        for (uint256 i = 0; i < batches.length; i++) {
            if (batches[i].regulationType == regulationType) {
                balance += batches[i].amount;
            }
        }

        return balance;
    }

    /**
     * @dev Remove empty batches from holder's array
     */
    function _cleanupEmptyBatches(address holder) internal {
        TokenBatch[] storage batches = _holderBatches[holder];
        uint256 writeIndex = 0;

        for (uint256 readIndex = 0; readIndex < batches.length; readIndex++) {
            if (batches[readIndex].amount > 0) {
                if (writeIndex != readIndex) {
                    batches[writeIndex] = batches[readIndex];
                }
                writeIndex++;
            }
        }

        // Remove empty slots at the end
        while (batches.length > writeIndex) {
            batches.pop();
        }
    }
}