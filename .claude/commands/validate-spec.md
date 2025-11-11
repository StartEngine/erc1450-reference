You are helping validate the ERC-1450 reference implementation against its specification.

## Project Context

This project has a two-repository structure:

**1. Specification Repository**
- Forked from: https://github.com/ethereum/ERCs
- GitHub: https://github.com/StartEngine/ERCs
- Local: `/Users/devendergollapally/StartEngineRepositories/ERCs`
- Spec file: `ERCS/erc-1450.md`
- Contains the formal ERC-1450 specification

**2. Reference Implementation (this repo)**
- GitHub: https://github.com/StartEngine/erc1450-reference
- Local: `/Users/devendergollapally/StartEngineRepositories/erc1450-reference`
- Contracts:
  - `contracts/ERC1450.sol`
  - `contracts/RTAProxy.sol`
  - `contracts/upgradeable/ERC1450Upgradeable.sol`
  - `contracts/upgradeable/RTAProxyUpgradeable.sol`
  - `contracts/interfaces/IERC1450.sol`

## Your Task

First, present this information to the user in a clear, friendly format and ask:

**"Do you want me to compare the reference implementation with the spec to ensure they're in sync?"**

**If the user says "yes"**, "proceed", or similar affirmative response:

1. Read the specification: `/Users/devendergollapally/StartEngineRepositories/ERCs/ERCS/erc-1450.md`
2. Read the implementation contracts (all files listed above)
3. Perform a comprehensive comparison:
   - Verify all required interface methods from spec are implemented
   - Check function signatures match (names, parameters, return types, visibility)
   - Verify events match the spec (names, parameters, indexed fields)
   - Check error types/reason codes match
   - Validate constants (like reason codes 0-14, 999) match the spec
   - Verify core behaviors align with spec requirements
   - Check that README documentation is consistent with the spec
4. Create a detailed report showing:
   - ✅ What matches correctly
   - ⚠️ Any discrepancies found
   - 📝 Recommendations for fixes if issues exist

**If the user says "no"** or declines:
- Acknowledge and explain they can run `/validate-spec` anytime to check sync status

Use the AskUserQuestion tool to get their confirmation before proceeding with the validation.
