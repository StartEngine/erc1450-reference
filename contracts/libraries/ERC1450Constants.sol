// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title ERC1450Constants
 * @dev Constants library for ERC-1450 standard
 * @notice Reason codes match the official ERC-1450 specification
 */
library ERC1450Constants {
    // Core reason codes for transfer rejection (0-9)
    uint16 constant REASON_INSUFFICIENT_BALANCE = 0;
    uint16 constant REASON_INVALID_SENDER = 1;
    uint16 constant REASON_INVALID_RECEIVER = 2;
    uint16 constant REASON_COMPLIANCE_FAILURE = 3;
    uint16 constant REASON_TRANSFER_RESTRICTED = 4;
    uint16 constant REASON_HOLDER_LIMIT_EXCEEDED = 5;
    uint16 constant REASON_TRADING_HALT = 6;
    uint16 constant REASON_COURT_ORDER = 7;
    uint16 constant REASON_REGULATORY_FREEZE = 8;
    uint16 constant REASON_LOCK_PERIOD = 9;

    // KYC/AML specific reason codes (10-14)
    uint16 constant REASON_RECIPIENT_NOT_VERIFIED = 10;  // Recipient hasn't completed KYC/AML
    uint16 constant REASON_ADDRESS_NOT_LINKED = 11;      // Address not linked to verified identity
    uint16 constant REASON_SENDER_VERIFICATION_EXPIRED = 12; // Sender's KYC expired
    uint16 constant REASON_JURISDICTION_BLOCKED = 13;    // Recipient in restricted jurisdiction
    uint16 constant REASON_ACCREDITATION_REQUIRED = 14;  // Recipient not accredited (Reg D)

    // General fallback
    uint16 constant REASON_OTHER = 999;
}