// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPriceOracle {
    function getPrice(address token) external view returns (uint256 price);
    function setPrice(address token, uint256 price) external;
}
