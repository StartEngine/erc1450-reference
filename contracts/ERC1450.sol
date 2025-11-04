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
     * @notice Only the RTA can execute transfers
     * @dev Callable only by the transfer agent after compliance checks
     */
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override(IERC20, IERC1450) onlyTransferAgent notFrozen(from) notFrozen(to) returns (bool) {
        _transfer(from, to, amount);
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

    function mint(address to, uint256 amount) external override onlyTransferAgent returns (bool) {
        if (to == address(0)) {
            revert ERC20InvalidReceiver(address(0));
        }

        _totalSupply += amount;
        unchecked {
            _balances[to] += amount;
        }

        emit Transfer(address(0), to, amount);
        return true;
    }

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

        emit Transfer(from, address(0), amount);
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

        // Document hash can be used for off-chain record keeping
        // In a production system, this would link to IPFS or similar
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

        emit Transfer(from, to, amount);
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
     */
    receive() external payable {}

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
}