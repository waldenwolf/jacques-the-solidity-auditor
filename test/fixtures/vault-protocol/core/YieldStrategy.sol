// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IERC20.sol";

/// @title Simplified yield strategy
/// @notice Accepts tokens and generates yield (simulated via donation)
contract YieldStrategy {
    address public vault;
    address public asset;
    uint256 public totalDeployed;

    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        _;
    }

    constructor(address _asset) {
        asset = _asset;
        vault = msg.sender;
    }

    /// @notice Deploy assets into the strategy
    function deploy(uint256 amount) external onlyVault {
        IERC20(asset).transferFrom(vault, address(this), amount);
        totalDeployed += amount;
    }

    /// @notice Withdraw assets back to vault
    function withdraw(uint256 amount) external onlyVault {
        require(amount <= totalDeployed, "Exceeds deployed");
        totalDeployed -= amount;
        IERC20(asset).transfer(vault, amount);
    }

    /// @notice Total value held by strategy (deployed + any yield)
    function totalValue() external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }
}
