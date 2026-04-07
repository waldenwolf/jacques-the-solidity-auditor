// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IToken} from "../interfaces/IToken.sol";

contract Token is IToken {
    mapping(address => uint256) private _balances;
    address public minter;

    constructor() {
        minter = msg.sender;
    }

    function mint(address to, uint256 amount) external override {
        _balances[to] += amount;
    }

    function burn(address from, uint256 amount) external override {
        require(_balances[from] >= amount, "insufficient");
        _balances[from] -= amount;
    }

    function balanceOf(address account) external view override returns (uint256) {
        return _balances[account];
    }
}
