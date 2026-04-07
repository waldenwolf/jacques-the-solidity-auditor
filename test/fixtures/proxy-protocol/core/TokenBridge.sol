// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IBridge.sol";
import "../libraries/SignatureVerifier.sol";

/// @title Token Bridge Implementation (behind UUPS proxy)
/// @notice Cross-chain token bridge with multi-sig validator set
/// @dev Contains intentional vulnerabilities for audit testing
contract TokenBridge is IBridge {
    using SignatureVerifier for bytes32;

    address public admin;
    bool public initialized;
    bool public paused;

    mapping(address => bool) public isValidator;
    address[] public validators;
    uint256 public requiredSignatures;

    mapping(bytes32 => bool) public processedWithdrawals;
    uint256 public withdrawalNonce;

    // UUPS upgrade slot
    bytes32 internal constant _IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Bridge is paused");
        _;
    }

    /// @notice Initialize the bridge (called once via proxy)
    /// BUG: No `initializer` guard — can be called again to reset admin
    function initialize(address _admin, address[] calldata _validators) external override {
        // BUG: Should check `!initialized` but the check is commented out
        // require(!initialized, "Already initialized");
        admin = _admin;

        for (uint256 i = 0; i < _validators.length; i++) {
            isValidator[_validators[i]] = true;
            validators.push(_validators[i]);
        }

        requiredSignatures = (_validators.length * 2) / 3 + 1; // 2/3 + 1 threshold
        initialized = true;
    }

    /// @notice Deposit tokens to be bridged to destination chain
    function deposit(address token, uint256 amount, uint256 destChainId) external override whenNotPaused {
        require(amount > 0, "Zero amount");
        require(destChainId != block.chainid, "Same chain");

        // BUG: Uses transferFrom but doesn't check return value (works with standard ERC-20
        // but fails silently with non-standard tokens like USDT)
        (bool success,) = token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", msg.sender, address(this), amount)
        );
        require(success, "Transfer failed");

        emit Deposited(token, msg.sender, amount, destChainId);
    }

    /// @notice Execute a withdrawal with validator signatures
    function executeWithdrawal(
        address token,
        address to,
        uint256 amount,
        bytes calldata signatures
    ) external override whenNotPaused {
        require(amount > 0, "Zero amount");

        bytes32 messageHash = SignatureVerifier.hashWithdrawal(token, to, amount, withdrawalNonce);

        // BUG: processedWithdrawals check uses messageHash which doesn't include nonce in a unique way
        // since nonce increments AFTER the check, concurrent calls with same params could race
        require(!processedWithdrawals[messageHash], "Already processed");

        // Verify signatures
        uint256 validSigs = 0;
        uint256 sigCount = signatures.length / 65;

        for (uint256 i = 0; i < sigCount; i++) {
            bytes memory sig = signatures[i * 65:(i + 1) * 65];
            address signer = messageHash.recoverSigner(sig);

            // BUG: No duplicate signer check — same validator signature can be submitted multiple times
            if (isValidator[signer]) {
                validSigs++;
            }
        }

        require(validSigs >= requiredSignatures, "Insufficient signatures");

        processedWithdrawals[messageHash] = true;
        withdrawalNonce++;

        // Transfer tokens
        (bool success,) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, amount)
        );
        require(success, "Transfer failed");

        emit Withdrawn(token, to, amount);
    }

    function addValidator(address validator) external override onlyAdmin {
        require(!isValidator[validator], "Already validator");
        isValidator[validator] = true;
        validators.push(validator);
        requiredSignatures = (validators.length * 2) / 3 + 1;
        emit ValidatorAdded(validator);
    }

    function removeValidator(address validator) external override onlyAdmin {
        require(isValidator[validator], "Not a validator");
        isValidator[validator] = false;
        // BUG: Doesn't remove from validators array — length stays inflated,
        // which means requiredSignatures stays high even with fewer active validators
        requiredSignatures = (validators.length * 2) / 3 + 1;
        emit ValidatorRemoved(validator);
    }

    function pause() external override onlyAdmin {
        paused = true;
    }

    function unpause() external override onlyAdmin {
        paused = false;
    }

    /// @notice Upgrade the implementation
    /// BUG: No access control — anyone can upgrade the implementation
    function upgradeTo(address newImplementation) external {
        assembly {
            sstore(_IMPLEMENTATION_SLOT, newImplementation)
        }
    }
}
