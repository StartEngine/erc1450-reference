/**
 * erc1450-reference - npm Package Exports
 *
 * This file provides easy access to all contract artifacts (ABIs, bytecode, metadata)
 * for both basic (immutable) and upgradeable contract implementations.
 *
 * Usage:
 *   const { ERC1450Upgradeable, RTAProxyUpgradeable } = require('erc1450-reference');
 *
 *   // Access ABI and bytecode
 *   const abi = RTAProxyUpgradeable.abi;
 *   const bytecode = RTAProxyUpgradeable.bytecode;
 */

module.exports = {
  // Basic Contracts (Immutable)
  ERC1450: require('./artifacts/contracts/ERC1450.sol/ERC1450.json'),
  RTAProxy: require('./artifacts/contracts/RTAProxy.sol/RTAProxy.json'),

  // Upgradeable Contracts (UUPS Pattern)
  ERC1450Upgradeable: require('./artifacts/contracts/upgradeable/ERC1450Upgradeable.sol/ERC1450Upgradeable.json'),
  RTAProxyUpgradeable: require('./artifacts/contracts/upgradeable/RTAProxyUpgradeable.sol/RTAProxyUpgradeable.json'),

  // Proxy Contract (OpenZeppelin)
  ERC1967Proxy: require('./artifacts/contracts/ERC1967Proxy.sol/ERC1967Proxy.json'),

  // Interfaces
  IERC1450: require('./artifacts/contracts/interfaces/IERC1450.sol/IERC1450.json'),

  // Libraries
  ERC1450Constants: require('./artifacts/contracts/libraries/ERC1450Constants.sol/ERC1450Constants.json'),
};
