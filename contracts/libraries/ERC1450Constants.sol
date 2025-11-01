// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title ERC1450Constants
 * @dev Constants library for ERC-1450 standard
 */
library ERC1450Constants {
    // Reason codes for transfer rejection
    uint16 constant REASON_COMPLIANCE_FAILED = 1;
    uint16 constant REASON_INSUFFICIENT_BALANCE = 2;
    uint16 constant REASON_RESTRICTED_ACCOUNT = 3;
    uint16 constant REASON_TRANSFER_WINDOW_CLOSED = 4;
    uint16 constant REASON_EXCEEDS_HOLDING_LIMIT = 5;
    uint16 constant REASON_REGULATORY_HALT = 6;
    uint16 constant REASON_COURT_ORDER = 7;
    uint16 constant REASON_INVALID_RECIPIENT = 8;
    uint16 constant REASON_LOCK_PERIOD = 9;
    uint16 constant REASON_OTHER = 999;
}