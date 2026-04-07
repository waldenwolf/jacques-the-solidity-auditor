// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Signature verification library
library SignatureVerifier {
    /// @notice Recover signer from message hash and signature
    function recoverSigner(bytes32 messageHash, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Invalid v value");

        return ecrecover(messageHash, v, r, s);
    }

    /// @notice Hash a withdrawal message for signing
    function hashWithdrawal(
        address token,
        address to,
        uint256 amount,
        uint256 nonce
    ) internal pure returns (bytes32) {
        // BUG: No chain ID in the hash — signatures are replayable across chains
        return keccak256(abi.encodePacked(token, to, amount, nonce));
    }
}
