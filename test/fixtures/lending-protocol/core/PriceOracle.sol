// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IPriceOracle.sol";

/// @title Simple price oracle
/// @notice Stores token prices — anyone can update (simulates manipulable spot oracle)
contract PriceOracle is IPriceOracle {
    mapping(address => uint256) public prices;
    mapping(address => uint256) public lastUpdated;

    event PriceUpdated(address indexed token, uint256 price, uint256 timestamp);

    /// @notice Returns stored price for a token
    function getPrice(address token) external view override returns (uint256 price) {
        price = prices[token];
        require(price > 0, "Price not set");
        // BUG: No staleness check — price could be arbitrarily old
        return price;
    }

    /// @notice Set price for a token
    /// BUG: No access control — anyone can set any price
    function setPrice(address token, uint256 price) external override {
        require(price > 0, "Price must be positive");
        prices[token] = price;
        lastUpdated[token] = block.timestamp;
        emit PriceUpdated(token, price, block.timestamp);
    }
}
