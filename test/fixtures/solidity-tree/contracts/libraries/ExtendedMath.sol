// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./Math.sol";

library ExtendedMath {
    function mulByTwo(uint256 a) internal pure returns (uint256) {
        return Math.mul(a, 2);
    }
}
