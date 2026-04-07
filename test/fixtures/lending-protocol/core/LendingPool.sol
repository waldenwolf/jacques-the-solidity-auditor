// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IERC20.sol";
import "../interfaces/IPriceOracle.sol";
import "../libraries/WadMath.sol";

/// @title Simple lending pool with collateral and borrowing
/// @notice Inspired by real lending protocol patterns (Aave/Compound style)
contract LendingPool {
    using WadMath for uint256;

    IPriceOracle public oracle;
    address public owner;

    uint256 public constant COLLATERAL_FACTOR = 75e16; // 75% LTV
    uint256 public constant LIQUIDATION_THRESHOLD = 80e16; // 80%
    uint256 public constant LIQUIDATION_BONUS = 5e16; // 5% bonus for liquidators

    struct UserAccount {
        uint256 collateralAmount;
        uint256 borrowedAmount;
        address collateralToken;
        address borrowToken;
    }

    mapping(address => UserAccount) public accounts;
    mapping(address => uint256) public totalDeposited;
    mapping(address => uint256) public totalBorrowed;
    mapping(address => uint256) public poolLiquidity;

    event Deposited(address indexed user, address token, uint256 amount);
    event Withdrawn(address indexed user, address token, uint256 amount);
    event Borrowed(address indexed user, address token, uint256 amount);
    event Repaid(address indexed user, address token, uint256 amount);
    event Liquidated(address indexed user, address indexed liquidator, uint256 debtRepaid, uint256 collateralSeized);

    constructor(address _oracle) {
        oracle = IPriceOracle(_oracle);
        owner = msg.sender;
    }

    /// @notice Deposit collateral
    function deposit(address token, uint256 amount) external {
        require(amount > 0, "Amount must be positive");

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        accounts[msg.sender].collateralAmount += amount;
        accounts[msg.sender].collateralToken = token;
        totalDeposited[token] += amount;
        poolLiquidity[token] += amount;

        emit Deposited(msg.sender, token, amount);
    }

    /// @notice Withdraw collateral
    function withdraw(address token, uint256 amount) external {
        UserAccount storage account = accounts[msg.sender];
        require(account.collateralAmount >= amount, "Insufficient collateral");

        // Check health factor after withdrawal
        uint256 newCollateral = account.collateralAmount - amount;
        if (account.borrowedAmount > 0) {
            uint256 collateralValue = _getTokenValue(token, newCollateral);
            uint256 borrowValue = _getTokenValue(account.borrowToken, account.borrowedAmount);
            // BUG: Division before multiplication — precision loss in health factor calculation
            uint256 healthFactor = (collateralValue / borrowValue) * WadMath.WAD;
            require(healthFactor >= WadMath.WAD, "Would be undercollateralized");
        }

        account.collateralAmount -= amount;
        totalDeposited[token] -= amount;
        poolLiquidity[token] -= amount;

        IERC20(token).transfer(msg.sender, amount);

        emit Withdrawn(msg.sender, token, amount);
    }

    /// @notice Borrow tokens against deposited collateral
    function borrow(address token, uint256 amount) external {
        UserAccount storage account = accounts[msg.sender];
        require(account.collateralAmount > 0, "No collateral");
        require(poolLiquidity[token] >= amount, "Insufficient pool liquidity");

        uint256 collateralValue = _getTokenValue(account.collateralToken, account.collateralAmount);
        uint256 maxBorrow = collateralValue.wadMul(COLLATERAL_FACTOR);
        uint256 currentBorrowValue = _getTokenValue(token, account.borrowedAmount);
        uint256 newBorrowValue = currentBorrowValue + _getTokenValue(token, amount);

        require(newBorrowValue <= maxBorrow, "Exceeds borrow limit");

        account.borrowedAmount += amount;
        account.borrowToken = token;
        totalBorrowed[token] += amount;
        poolLiquidity[token] -= amount;

        IERC20(token).transfer(msg.sender, amount);

        emit Borrowed(msg.sender, token, amount);
    }

    /// @notice Repay borrowed tokens
    function repay(uint256 amount) external {
        UserAccount storage account = accounts[msg.sender];
        require(account.borrowedAmount >= amount, "Repay exceeds debt");

        IERC20(account.borrowToken).transferFrom(msg.sender, address(this), amount);

        account.borrowedAmount -= amount;
        totalBorrowed[account.borrowToken] -= amount;
        poolLiquidity[account.borrowToken] += amount;

        emit Repaid(msg.sender, account.borrowToken, amount);
    }

    /// @notice Liquidate an undercollateralized position
    function liquidate(address user) external {
        UserAccount storage account = accounts[user];
        require(account.borrowedAmount > 0, "No debt to liquidate");

        uint256 collateralValue = _getTokenValue(account.collateralToken, account.collateralAmount);
        uint256 borrowValue = _getTokenValue(account.borrowToken, account.borrowedAmount);

        // Check if undercollateralized
        uint256 healthFactor = collateralValue.wadDiv(borrowValue);
        require(healthFactor < WadMath.WAD, "Position is healthy");

        uint256 debtToRepay = account.borrowedAmount;
        uint256 collateralToSeize = account.collateralAmount;

        // BUG: Liquidator pays the debt but seizes ALL collateral + bonus
        // even if the debt is much less than the collateral value.
        // Should only seize proportional amount + bonus.
        uint256 bonusCollateral = collateralToSeize.wadMul(LIQUIDATION_BONUS);

        // Repay the debt
        IERC20(account.borrowToken).transferFrom(msg.sender, address(this), debtToRepay);

        // BUG: External call before state update (CEI violation)
        // The collateral transfer happens before zeroing the account
        IERC20(account.collateralToken).transfer(msg.sender, collateralToSeize);

        // State updates after external calls
        account.borrowedAmount = 0;
        account.collateralAmount = 0;
        totalBorrowed[account.borrowToken] -= debtToRepay;
        totalDeposited[account.collateralToken] -= collateralToSeize;

        emit Liquidated(user, msg.sender, debtToRepay, collateralToSeize);
    }

    /// @notice Get health factor for a user
    function getHealthFactor(address user) external view returns (uint256) {
        UserAccount storage account = accounts[user];
        if (account.borrowedAmount == 0) return type(uint256).max;

        uint256 collateralValue = _getTokenValue(account.collateralToken, account.collateralAmount);
        uint256 borrowValue = _getTokenValue(account.borrowToken, account.borrowedAmount);

        return collateralValue.wadDiv(borrowValue);
    }

    function _getTokenValue(address token, uint256 amount) internal view returns (uint256) {
        uint256 price = oracle.getPrice(token);
        return amount.wadMul(price);
    }
}
