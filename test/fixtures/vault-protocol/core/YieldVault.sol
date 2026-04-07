// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IERC20.sol";
import "../interfaces/IERC4626.sol";
import "../libraries/ShareMath.sol";
import "./YieldStrategy.sol";

/// @title ERC-4626 Yield Vault
/// @notice Accepts deposits, issues shares, deploys to strategy for yield
/// @dev Contains subtle vulnerabilities for audit testing
contract YieldVault is IERC4626 {
    using ShareMath for uint256;

    IERC20 public immutable _asset;
    YieldStrategy public strategy;
    address public owner;

    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 public depositFee = 0; // basis points (0-10000)
    uint256 public withdrawFee = 50; // 0.5% fee
    uint256 private constant BASIS = 10000;

    constructor(address asset_, string memory name_, string memory symbol_) {
        _asset = IERC20(asset_);
        name = name_;
        symbol = symbol_;
        owner = msg.sender;
        strategy = new YieldStrategy(asset_);
    }

    // ========== ERC-4626 ==========

    function asset() external view override returns (address) {
        return address(_asset);
    }

    function totalAssets() public view override returns (uint256) {
        return _asset.balanceOf(address(this)) + strategy.totalValue();
    }

    function convertToShares(uint256 assets) public view override returns (uint256) {
        return ShareMath.toShares(assets, totalSupply, totalAssets());
    }

    function convertToAssets(uint256 shares) public view override returns (uint256) {
        return ShareMath.toAssets(shares, totalSupply, totalAssets());
    }

    function maxDeposit(address) external pure override returns (uint256) {
        return type(uint256).max;
    }

    function previewDeposit(uint256 assets) public view override returns (uint256) {
        return convertToShares(assets);
    }

    /// @notice Deposit assets and receive vault shares
    /// BUG: No minimum shares check — first depositor can inflate share price
    /// Attack: 1) deposit(1 wei) -> get 1 share, 2) donate 10000 tokens directly to vault,
    /// 3) now 1 share = 10001 tokens, 4) victim deposits 9999 tokens -> gets 0 shares
    function deposit(uint256 assets, address receiver) external override returns (uint256 shares) {
        require(assets > 0, "Zero deposit");

        uint256 fee = (assets * depositFee) / BASIS;
        uint256 netAssets = assets - fee;

        shares = convertToShares(netAssets);
        // BUG: No check for shares > 0 — depositor can lose assets if shares round to 0

        _asset.transferFrom(msg.sender, address(this), assets);

        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function maxWithdraw(address _owner) external view override returns (uint256) {
        return convertToAssets(balanceOf[_owner]);
    }

    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        uint256 supply = totalSupply;
        uint256 total = totalAssets();
        if (supply == 0) return 0;
        // BUG: Should round UP for withdraw (shares needed), but rounds DOWN
        return (assets * supply) / total;
    }

    function withdraw(uint256 assets, address receiver, address _owner) external override returns (uint256 shares) {
        shares = previewWithdraw(assets);
        require(shares > 0, "Zero shares");

        if (msg.sender != _owner) {
            uint256 allowed = allowance[_owner][msg.sender];
            require(allowed >= shares, "Allowance exceeded");
            allowance[_owner][msg.sender] = allowed - shares;
        }

        _burn(_owner, shares);

        uint256 fee = (assets * withdrawFee) / BASIS;
        uint256 netAssets = assets - fee;

        _asset.transfer(receiver, netAssets);

        emit Withdraw(msg.sender, receiver, _owner, assets, shares);
    }

    function maxRedeem(address _owner) external view override returns (uint256) {
        return balanceOf[_owner];
    }

    function previewRedeem(uint256 shares) public view override returns (uint256) {
        return convertToAssets(shares);
    }

    function redeem(uint256 shares, address receiver, address _owner) external override returns (uint256 assets) {
        require(shares > 0, "Zero shares");

        if (msg.sender != _owner) {
            uint256 allowed = allowance[_owner][msg.sender];
            require(allowed >= shares, "Allowance exceeded");
            allowance[_owner][msg.sender] = allowed - shares;
        }

        assets = convertToAssets(shares);
        _burn(_owner, shares);

        uint256 fee = (assets * withdrawFee) / BASIS;
        uint256 netAssets = assets - fee;

        _asset.transfer(receiver, netAssets);

        emit Withdraw(msg.sender, receiver, _owner, assets, shares);
    }

    // ========== Admin ==========

    /// @notice Deploy idle assets to the yield strategy
    function deployToStrategy(uint256 amount) external {
        // BUG: No access control — anyone can trigger rebalancing
        _asset.approve(address(strategy), amount);
        strategy.deploy(amount);
    }

    /// @notice Set fees
    function setFees(uint256 _depositFee, uint256 _withdrawFee) external {
        require(msg.sender == owner, "Only owner");
        // BUG: No upper bound check — owner can set fee to 100%
        depositFee = _depositFee;
        withdrawFee = _withdrawFee;
    }

    // ========== ERC-20 ==========

    function transfer(address to, uint256 amount) external override returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        balanceOf[from] -= amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
    }
}
