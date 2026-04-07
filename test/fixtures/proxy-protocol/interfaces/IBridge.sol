// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IBridge {
    function initialize(address admin, address[] calldata validators) external;
    function deposit(address token, uint256 amount, uint256 destChainId) external;
    function executeWithdrawal(address token, address to, uint256 amount, bytes calldata signatures) external;
    function addValidator(address validator) external;
    function removeValidator(address validator) external;
    function pause() external;
    function unpause() external;

    event Deposited(address indexed token, address indexed from, uint256 amount, uint256 destChainId);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
}
