// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC165.sol";

/**
 * @title IERC1450 RTA-Controlled Security Token Interface
 * @dev Interface for ERC-1450 compliant security tokens with RTA control
 * @notice This standard facilitates compliant securities offerings under SEC regulations
 */
interface IERC1450 is IERC20, IERC165 {
    // ============ Errors (ERC-6093 Compliant) ============

    // ERC-1450 specific errors
    error ERC1450TransferDisabled();
    error ERC1450OnlyRTA();
    error ERC1450TransferAgentLocked();
    error ERC1450ComplianceCheckFailed(address from, address to);

    // ============ Events ============

    event IssuerChanged(address indexed previousIssuer, address indexed newIssuer);
    event TransferAgentUpdated(address indexed previousAgent, address indexed newAgent);

    // Transfer request events
    event TransferRequested(
        uint256 indexed requestId,
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 feePaid,
        address requestedBy
    );

    event RequestStatusChanged(
        uint256 indexed requestId,
        RequestStatus indexed oldStatus,
        RequestStatus indexed newStatus,
        uint256 timestamp
    );

    event TransferExecuted(
        uint256 indexed requestId,
        address indexed from,
        address indexed to,
        uint256 amount
    );

    event TransferRejected(
        uint256 indexed requestId,
        uint16 reasonCode,
        bool feeRefunded
    );

    event TransferExpired(
        uint256 indexed requestId,
        uint256 expiredAt
    );

    // Fee events
    event FeeParametersUpdated(uint8 feeType, uint256 feeValue, address[] acceptedTokens);
    event FeesWithdrawn(address indexed token, uint256 amount, address indexed recipient);
    event BrokerStatusUpdated(address indexed broker, bool isApproved, address indexed updatedBy);

    // ============ Enums ============

    enum RequestStatus {
        Requested,
        UnderReview,
        Approved,
        Rejected,
        Executed,
        Expired
    }

    // ============ Core RTA Functions ============

    /**
     * @notice Change the issuer (owner) of the token contract
     * @param newIssuer Address of the new issuer
     * @dev Only callable by the RTA
     */
    function changeIssuer(address newIssuer) external;

    /**
     * @notice Update the transfer agent address
     * @param newTransferAgent Address of the new transfer agent (should be RTAProxy)
     * @dev Callable by issuer initially, then locked or RTA-only
     */
    function setTransferAgent(address newTransferAgent) external;

    /**
     * @notice Check if an address is the current transfer agent
     * @param addr Address to check
     * @return bool True if the address is the transfer agent
     */
    function isTransferAgent(address addr) external view returns (bool);

    /**
     * @notice Execute token transfer (RTA only)
     * @param from Source address
     * @param to Destination address
     * @param amount Number of tokens
     * @return bool Success status
     * @dev Only callable by RTA after compliance checks
     */
    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    /**
     * @notice Mint new tokens (RTA only)
     * @param to Recipient address
     * @param amount Number of tokens to mint
     * @return bool Success status
     */
    function mint(address to, uint256 amount) external returns (bool);

    /**
     * @notice Burn tokens from an account (RTA only)
     * @param from Account to burn from
     * @param amount Number of tokens to burn
     * @return bool Success status
     */
    function burnFrom(address from, uint256 amount) external returns (bool);

    /**
     * @notice Get token decimals
     * @return uint8 Number of decimal places
     */
    function decimals() external view returns (uint8);

    // ============ Introspection ============

    /**
     * @notice Check if this is a security token
     * @return bool Always returns true for ERC-1450 tokens
     */
    function isSecurityToken() external pure returns (bool);

    // ============ Transfer Request System ============

    /**
     * @notice Request a transfer with fee payment
     * @param from Source address
     * @param to Destination address
     * @param amount Number of tokens
     * @param feeToken Fee payment token (address(0) for native)
     * @param feeAmount Fee amount being paid
     * @return requestId Unique request identifier
     */
    function requestTransferWithFee(
        address from,
        address to,
        uint256 amount,
        address feeToken,
        uint256 feeAmount
    ) external payable returns (uint256 requestId);

    /**
     * @notice Get current fee for a transfer in a specific token
     * @param from Source address
     * @param to Destination address
     * @param amount Transfer amount
     * @param feeToken Token to pay fee in (address(0) for native token)
     * @return feeAmount Required fee amount in the specified token
     *         Returns 0 if the token is not accepted
     */
    function getTransferFee(address from, address to, uint256 amount, address feeToken)
        external view returns (uint256 feeAmount);

    /**
     * @notice Get all accepted fee tokens for transfers
     * @return acceptedTokens Array of accepted fee token addresses
     */
    function getAcceptedFeeTokens()
        external view returns (address[] memory acceptedTokens);

    /**
     * @notice Set fee parameters (RTA only)
     * @param feeType Fee structure type
     * @param feeValue Fee amount or percentage
     * @param acceptedTokens Array of accepted fee tokens
     */
    function setFeeParameters(uint8 feeType, uint256 feeValue, address[] calldata acceptedTokens) external;

    /**
     * @notice Withdraw collected fees (RTA only)
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     * @param recipient Recipient address
     */
    function withdrawFees(address token, uint256 amount, address recipient) external;

    // ============ Broker Management ============

    /**
     * @notice Update broker status (RTA only)
     * @param broker Broker address
     * @param approved Approval status
     */
    function setBrokerStatus(address broker, bool approved) external;

    /**
     * @notice Check if address is approved broker
     * @param broker Address to check
     * @return bool True if approved broker
     */
    function isBroker(address broker) external view returns (bool);

    // ============ Request Lifecycle ============

    /**
     * @notice Process transfer request (RTA only)
     * @param requestId Request to process
     */
    function processTransferRequest(uint256 requestId) external;

    /**
     * @notice Reject transfer request (RTA only)
     * @param requestId Request to reject
     * @param reasonCode Rejection reason
     * @param refundFee Whether to refund the fee
     */
    function rejectTransferRequest(uint256 requestId, uint16 reasonCode, bool refundFee) external;

    /**
     * @notice Update request status (RTA only)
     * @param requestId Request to update
     * @param newStatus New status
     */
    function updateRequestStatus(uint256 requestId, RequestStatus newStatus) external;

    // ============ Court Orders & Recovery ============

    /**
     * @notice Execute court-ordered transfer (RTA only)
     * @param from Source address
     * @param to Destination address
     * @param amount Number of tokens
     * @param documentHash Court order document hash
     */
    function executeCourtOrder(
        address from,
        address to,
        uint256 amount,
        bytes32 documentHash
    ) external;

    /**
     * @notice Freeze/unfreeze an account (RTA only)
     * @param account Account to freeze/unfreeze
     * @param frozen Freeze status
     */
    function setAccountFrozen(address account, bool frozen) external;

    /**
     * @notice Check if account is frozen
     * @param account Account to check
     * @return bool True if frozen
     */
    function isAccountFrozen(address account) external view returns (bool);
}