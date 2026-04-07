// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IVault} from "../interfaces/IVault.sol";
import {IToken} from "../interfaces/IToken.sol";

contract Vault is IVault {
    IToken public token;
    mapping(address => uint256) public balances;
    uint256 public totalAssets_;

    constructor(address _token) {
        token = IToken(_token);
    }

    function deposit(uint256 amount) external override {
        token.burn(msg.sender, amount);
        balances[msg.sender] += amount;
        totalAssets_ += amount;
    }

    function withdraw(uint256 amount) external override {
        require(balances[msg.sender] >= amount, "insufficient");
        balances[msg.sender] -= amount;
        totalAssets_ -= amount;
        token.mint(msg.sender, amount);
    }

    function totalAssets() external view override returns (uint256) {
        return totalAssets_;
    }
}
