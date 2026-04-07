// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Minimal ERC-1967 Proxy
/// @notice Delegates all calls to an implementation contract
contract ERC1967Proxy {
    /// @dev ERC-1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1
    bytes32 internal constant _IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    /// @dev ERC-1967 admin slot: keccak256("eip1967.proxy.admin") - 1
    bytes32 internal constant _ADMIN_SLOT =
        0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    constructor(address implementation, bytes memory data) {
        _setImplementation(implementation);
        _setAdmin(msg.sender);
        if (data.length > 0) {
            (bool success,) = implementation.delegatecall(data);
            require(success, "Init failed");
        }
    }

    function _setImplementation(address impl) internal {
        assembly {
            sstore(_IMPLEMENTATION_SLOT, impl)
        }
    }

    function _setAdmin(address admin) internal {
        assembly {
            sstore(_ADMIN_SLOT, admin)
        }
    }

    function _getImplementation() internal view returns (address impl) {
        assembly {
            impl := sload(_IMPLEMENTATION_SLOT)
        }
    }

    fallback() external payable {
        address impl = _getImplementation();
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}
}
