// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title ERC1450Constants
 * @dev Constants library for ERC-1450 standard
 * @notice Reason codes match the official ERC-1450 specification
 */
library ERC1450Constants {
    // Core reason codes for transfer rejection (1-9) - aligned with ERC-1450 spec
    uint16 constant REASON_COMPLIANCE_FAILED = 1;      // General compliance check failed
    uint16 constant REASON_INSUFFICIENT_BALANCE = 2;   // Sender has insufficient balance
    uint16 constant REASON_RESTRICTED_ACCOUNT = 3;     // Account is frozen or restricted
    uint16 constant REASON_TRANSFER_WINDOW_CLOSED = 4; // Transfer window closed
    uint16 constant REASON_EXCEEDS_HOLDING_LIMIT = 5;  // Would exceed recipient holding limit
    uint16 constant REASON_REGULATORY_HALT = 6;        // Trading halted by regulator
    uint16 constant REASON_COURT_ORDER = 7;            // Court order prevents transfer
    uint16 constant REASON_INVALID_RECIPIENT = 8;      // Recipient address invalid
    uint16 constant REASON_LOCK_PERIOD = 9;            // Tokens still in lock-up period

    // KYC/AML specific reason codes (10-14)
    uint16 constant REASON_RECIPIENT_NOT_VERIFIED = 10;  // Recipient hasn't completed KYC/AML
    uint16 constant REASON_ADDRESS_NOT_LINKED = 11;      // Address not linked to verified identity
    uint16 constant REASON_SENDER_VERIFICATION_EXPIRED = 12; // Sender's KYC expired
    uint16 constant REASON_JURISDICTION_BLOCKED = 13;    // Recipient in restricted jurisdiction
    uint16 constant REASON_ACCREDITATION_REQUIRED = 14;  // Recipient not accredited (Reg D)

    // General fallback
    uint16 constant REASON_OTHER = 999;
}