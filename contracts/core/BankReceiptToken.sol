// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/Math.sol";
import "../libraries/ExtendedMath.sol";

contract BankReceiptToken {
    string public name = "Bank Receipt Token";
    string public symbol = "BRT";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    using Math for uint256;
    using ExtendedMath for uint256;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");

        balanceOf[msg.sender] = Math.sub(balanceOf[msg.sender], amount);
        balanceOf[to] = Math.add(balanceOf[to], amount);

        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;

        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        require(balanceOf[from] >= amount, "Insufficient balance");

        allowance[from][msg.sender] = Math.sub(allowance[from][msg.sender], amount);
        balanceOf[from] = Math.sub(balanceOf[from], amount);
        balanceOf[to] = Math.add(balanceOf[to], amount);

        emit Transfer(from, to, amount);
        return true;
    }

    // Receipt token mint/burn (public for POC; in production restrict to Bank)
    function mint(address to, uint256 amount) external {
        totalSupply = Math.add(totalSupply, amount);
        balanceOf[to] = Math.add(balanceOf[to], amount);

        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(balanceOf[from] >= amount, "Insufficient balance");

        totalSupply = Math.sub(totalSupply, amount);
        balanceOf[from] = Math.sub(balanceOf[from], amount);

        emit Transfer(from, address(0), amount);
    }

    // Functions demonstrating usage of the additional library (ExtendedMath)
    function getDoubledTotalSupply() external view returns (uint256) {
        return ExtendedMath.mulByTwo(totalSupply);
    }

    function getAverageBalance(address a, address b) external view returns (uint256) {
        return ExtendedMath.average(balanceOf[a], balanceOf[b]);
    }

    function getBalanceSquared(address user) external view returns (uint256) {
        return ExtendedMath.powTwo(balanceOf[user]);
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}