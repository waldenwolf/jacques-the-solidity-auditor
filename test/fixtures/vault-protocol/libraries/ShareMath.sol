// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Share-to-asset conversion math
/// @notice Used by ERC-4626 vault for share calculations
library ShareMath {
    /// @notice Convert assets to shares
    /// BUG: Rounds DOWN on deposit — should favor the vault (round down), which is correct
    /// BUT there's no protection against first-depositor inflation
    function toShares(
        uint256 assets,
        uint256 totalShares,
        uint256 totalAssets
    ) internal pure returns (uint256) {
        if (totalShares == 0 || totalAssets == 0) {
            return assets; // 1:1 on first deposit
        }
        return (assets * totalShares) / totalAssets;
    }

    /// @notice Convert shares to assets
    /// BUG: Rounds DOWN on withdraw — should round DOWN (favoring vault), but combined
    /// with the inflation attack this allows theft
    function toAssets(
        uint256 shares,
        uint256 totalShares,
        uint256 totalAssets
    ) internal pure returns (uint256) {
        if (totalShares == 0) {
            return 0;
        }
        return (shares * totalAssets) / totalShares;
    }
}
