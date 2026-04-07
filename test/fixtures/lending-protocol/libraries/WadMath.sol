// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Fixed-point math with 18-decimal WAD precision
library WadMath {
    uint256 internal constant WAD = 1e18;

    function wadMul(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * b) / WAD;
    }

    function wadDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * WAD) / b;
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }
}
