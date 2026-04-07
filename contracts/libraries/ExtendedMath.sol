// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Math.sol";

library ExtendedMath {
    function powTwo(uint256 a) internal pure returns (uint256) {
        return Math.pow(a, 2);
    }

    function average(uint256 a, uint256 b) internal pure returns (uint256) {
        return Math.avg(a, b);
    }

    function mulByTwo(uint256 a) internal pure returns (uint256) {
        return Math.mul(a, 2);
    }

    function minWithZero(uint256 a) internal pure returns (uint256) {
        return Math.min(a, 0);
    }
}