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

    /**
     * @notice Emitted when tokens are minted with regulation tracking
     * @param to Recipient of the minted tokens
     * @param amount Number of tokens minted
     * @param regulationType Regulation under which tokens were issued
     * @param issuanceDate Original share issuance date
     * @param tokenizationDate When tokenized on blockchain (block.timestamp)
     */
    event TokensMinted(
        address indexed to,
        uint256 amount,
        uint16 indexed regulationType,
        uint256 issuanceDate,
        uint256 tokenizationDate
    );

    /**
     * @notice Emitted when tokens are burned with regulation tracking
     * @param from Address from which tokens were burned
     * @param amount Number of tokens burned
     * @param regulationType Regulation type of burned tokens
     * @param issuanceDate Original issuance date of burned tokens
     */
    event TokensBurned(
        address indexed from,
        uint256 amount,
        uint16 indexed regulationType,
        uint256 issuanceDate
    );

    /**
     * @notice Emitted when tokens are transferred with specific regulation tracking
     */
    event RegulatedTransfer(
        address indexed from,
        address indexed to,
        uint256 amount,
        uint16 indexed regulationType,
        uint256 issuanceDate
    );

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

    // Court order event
    event CourtOrderExecuted(
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes32 documentHash,
        uint256 timestamp
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
     * @notice Transfer tokens - DISABLED for security tokens
     * @dev Must always revert with ERC1450TransferDisabled()
     *      Use transferFromRegulated() for actual transfers with regulation tracking
     */
    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    /**
     * @notice Transfer tokens between accounts with regulation tracking (RTA only)
     * @param from Source address
     * @param to Destination address
     * @param amount Number of tokens to transfer
     * @param regulationType Type of regulation for the transferred tokens
     * @param issuanceDate Original issuance date of the transferred tokens
     * @return bool Success status
     * @dev Only callable by the registered transfer agent
     *      MUST revert if sender has insufficient tokens of the specified regulation/issuance
     */
    function transferFromRegulated(address from, address to, uint256 amount, uint16 regulationType, uint256 issuanceDate) external returns (bool);

    /**
     * @notice Mint new tokens with regulation tracking (RTA only)
     * @param to Recipient address
     * @param amount Number of tokens to mint
     * @param regulationType Type of regulation under which shares were issued
     * @param issuanceDate Unix timestamp when shares were originally issued
     * @return bool Success status
     */
    function mint(address to, uint256 amount, uint16 regulationType, uint256 issuanceDate) external returns (bool);

    /**
     * @notice Batch mint tokens with regulation tracking (RTA only)
     * @param recipients Array of addresses to receive the minted tokens
     * @param amounts Array of token amounts to mint for each recipient
     * @param regulationTypes Array of regulation types for each mint
     * @param issuanceDates Array of issuance timestamps for each mint
     * @return bool Success status
     */
    function batchMint(
        address[] calldata recipients,
        uint256[] calldata amounts,
        uint16[] calldata regulationTypes,
        uint256[] calldata issuanceDates
    ) external returns (bool);

    /**
     * @notice Burn tokens from an account (RTA only) - Uses RTA's chosen strategy
     * @param from Account to burn from
     * @param amount Number of tokens to burn
     * @return bool Success status
     * @dev The RTA determines which tokens to burn based on their strategy (FIFO, LIFO, tax optimization, etc.)
     */
    function burnFrom(address from, uint256 amount) external returns (bool);

    /**
     * @notice Burn tokens from an account with regulation tracking (RTA only)
     * @param from Address from which to burn tokens
     * @param amount Number of tokens to burn
     * @param regulationType Type of regulation for the tokens to burn
     * @param issuanceDate Original issuance date of the tokens to burn
     * @return bool Success status
     * @dev MUST revert if holder has insufficient tokens of the specified regulation/issuance
     */
    function burnFromRegulated(address from, uint256 amount, uint16 regulationType, uint256 issuanceDate) external returns (bool);

    /**
     * @notice Burn tokens of a specific regulation type (RTA only)
     * @param from Account to burn from
     * @param amount Number of tokens to burn
     * @param regulationType Specific regulation type to burn
     * @return bool Success status
     */
    function burnFromRegulation(address from, uint256 amount, uint16 regulationType) external returns (bool);

    /**
     * @notice Get token decimals
     * @return uint8 Number of decimal places
     */
    function decimals() external view returns (uint8);

    // ============ Regulation Tracking ============

    /**
     * @notice Get regulation information for tokens held by an address
     * @param holder Address to query
     * @return regulationTypes Array of regulation types for holder's tokens
     * @return amounts Array of token amounts per regulation type
     * @return issuanceDates Array of original issuance dates
     */
    function getHolderRegulations(address holder) external view returns (
        uint16[] memory regulationTypes,
        uint256[] memory amounts,
        uint256[] memory issuanceDates
    );

    /**
     * @notice Get total tokens minted under a specific regulation
     * @param regulationType The regulation type to query
     * @return totalSupply Total tokens minted under this regulation
     */
    function getRegulationSupply(uint16 regulationType) external view returns (uint256 totalSupply);

    /**
     * @notice Get detailed batch information for a holder's tokens
     * @param holder Address to query
     * @return count Number of unique batches the holder has
     * @return regulationTypes Array of regulation types for each batch
     * @return issuanceDates Array of issuance dates for each batch
     * @return amounts Array of token amounts for each batch
     */
    function getDetailedBatchInfo(address holder) external view returns (
        uint256 count,
        uint16[] memory regulationTypes,
        uint256[] memory issuanceDates,
        uint256[] memory amounts
    );

    /**
     * @notice Batch transfer tokens between multiple address pairs with regulation tracking (RTA only)
     * @param froms Array of source addresses
     * @param tos Array of destination addresses
     * @param amounts Array of token amounts to transfer
     * @param regulationTypes Array of regulation types for each transfer
     * @param issuanceDates Array of issuance dates for each transfer
     * @return bool Success status
     */
    function batchTransferFrom(
        address[] calldata froms,
        address[] calldata tos,
        uint256[] calldata amounts,
        uint16[] calldata regulationTypes,
        uint256[] calldata issuanceDates
    ) external returns (bool);

    /**
     * @notice Batch burn tokens from multiple addresses with regulation tracking (RTA only)
     * @param froms Array of addresses from which to burn tokens
     * @param amounts Array of token amounts to burn from each address
     * @param regulationTypes Array of regulation types for each burn
     * @param issuanceDates Array of issuance dates for each burn
     * @return bool Success status
     */
    function batchBurnFrom(
        address[] calldata froms,
        uint256[] calldata amounts,
        uint16[] calldata regulationTypes,
        uint256[] calldata issuanceDates
    ) external returns (bool);

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