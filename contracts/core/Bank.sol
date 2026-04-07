// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../libraries/Math.sol";
import "./BankReceiptToken.sol";

contract Bank {
    mapping(address => uint256) public balances;
    
    BankReceiptToken public receiptToken;
    using Math for uint256;


    constructor() {
        receiptToken = new BankReceiptToken();
    }

    /// @notice Deposit ETH into the bank and receive receipt tokens (1:1)
    function deposit() external payable {
        balances[msg.sender] = Math.add(balances[msg.sender], msg.value);
        receiptToken.mint(msg.sender, msg.value);
    }

    /// @notice Withdraw ETH
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        require(receiptToken.balanceOf(msg.sender) >= amount, "Insufficient receipt tokens");

        receiptToken.burn(msg.sender, amount);

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "ETH transfer failed");

        balances[msg.sender] = Math.sub(balances[msg.sender], amount);
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }

}