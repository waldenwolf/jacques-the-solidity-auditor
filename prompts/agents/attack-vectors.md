# Attack Vector Reference

Top attack patterns for Solidity smart contracts. Each entry has a detection pattern (D) and false-positive indicator (FP). Use these to systematically scan every contract in scope.

---

**1. CEI Violation — External Call Before State Update**
- D: `.call{value:}`, `.transfer()`, `.send()`, token `transfer()` occurring before balance/state update in the same function. Attacker re-enters via `receive()`, `fallback()`, or ERC callback.
- FP: All state updates before external call. `nonReentrant` modifier on all entry points. CEI pattern strictly followed.

**2. ERC-777 tokensToSend/tokensReceived Reentrancy**
- D: Token `transfer()`/`transferFrom()` called before state updates on a token that may implement ERC-777. Hooks fire on ERC20-style calls.
- FP: CEI followed. `nonReentrant` on all entry points. Token whitelist excludes ERC-777.

**3. Read-Only Reentrancy via View Functions**
- D: View functions (exchange rate, share price, totalAssets) read during a callback return stale state. External protocols that integrate these getters during reentrancy get manipulated prices.
- FP: Reentrancy lock covers view functions. No external protocol reads state mid-transaction.

**4. Unprotected initialize() on Implementation**
- D: `initialize()` without `initializer` modifier, or implementation behind proxy left uninitialized. Anyone can call `initialize()` on the implementation contract directly.
- FP: `initializer` modifier present. Implementation constructor calls `_disableInitializers()`.

**5. Missing Slippage Protection**
- D: Swaps, withdrawals, or redemptions with no `minAmountOut` parameter. Exchange rate can change between submission and execution.
- FP: Slippage parameter validated. Fixed 1:1 exchange rate. Frontend simulation with revert.

**6. Oracle Staleness — No Validity Checks**
- D: `latestRoundData()` called but missing checks: `answer > 0`, `updatedAt > block.timestamp - MAX_STALENESS`, `answeredInRound >= roundId`.
- FP: All four checks present. Circuit breaker or fallback oracle on failure.

**7. Spot Price Oracle from AMM**
- D: Price derived from AMM reserves (`reserve0/reserve1`, `getAmountsOut()`). Flash-loan manipulable atomically.
- FP: TWAP >= 30 min window. Chainlink/Pyth as primary source.

**8. Fee-on-Transfer Token Accounting**
- D: Code uses `amount` parameter instead of actual received amount (`balanceAfter - balanceBefore`). Protocol accounting inflated vs real balance.
- FP: Delta-balance pattern used. Token whitelist excludes FOT tokens.

**9. Non-Standard ERC20 Return Values (USDT)**
- D: `require(token.transfer(to, amount))` reverts on tokens returning nothing (USDT, BNB). Or return value ignored (silent failure).
- FP: OZ `SafeERC20.safeTransfer()`/`safeTransferFrom()` used throughout.

**10. Rebasing Token Balance Desync**
- D: Protocol caches token balance in storage but token rebases externally. Cached balance diverges from `balanceOf()`. Withdrawals under/overpay.
- FP: Internal accounting only. Token whitelist excludes rebasing tokens.

**11. Token Blacklist Blocking Critical Functions**
- D: USDC/USDT blacklist on an address blocks `transfer()`. If that address is in a withdrawal path, all users blocked (push-over-pull).
- FP: Pull pattern. Blacklisted funds handled separately. No single-address bottleneck.

**12. First Depositor Share Inflation**
- D: First depositor donates to inflate exchange rate. Subsequent depositors round to 0 shares, losing deposit. Pattern: `shares = amount * totalShares / totalAssets` with no minimum.
- FP: Virtual shares/dead shares offset. Minimum deposit enforced. OpenZeppelin ERC-4626 with offset.

**13. Division-Before-Multiplication Precision Loss**
- D: `(a / b) * c` loses precision vs `(a * c) / b`. Intermediate truncation amplified.
- FP: Multiplication before division. WAD/RAY math library used.

**14. Unsafe Downcast Truncation**
- D: `uint256` -> `uint128`/`uint96`/`uint64` without bounds check. Solidity >= 0.8 silently truncates on explicit downcast.
- FP: `require(x <= type(uint128).max)` before cast. OZ `SafeCast` used.

**15. Wrong Rounding Direction**
- D: Deposits round shares UP (user gets more than deserved). Withdrawals round assets UP (user gets more). Debt rounds DOWN (borrower owes less). Exploitable by looping.
- FP: Protocol-favoring rounding throughout. `mulDivUp`/`mulDivDown` used correctly.

**16. Flash Loan Price Manipulation**
- D: Current-block balances used for pricing, voting, or collateral. Flash loan inflates balance, exploits protocol, repays.
- FP: Time-weighted or snapshot values. Minimum lock period.

**17. Permit Signature Frontrun Griefing**
- D: Contract calls `permit()` then `transferFrom()` sequentially. Attacker extracts permit from mempool, calls `permit()` first, nonce consumed, user tx reverts.
- FP: `try token.permit(...) {} catch {}`. Permit2 with unordered nonces.

**18. Missing chainId — Cross-Chain Replay**
- D: Signed payload omits `chainId`. Valid signature replayable on forks/other EVM chains.
- FP: EIP-712 domain separator includes dynamic `chainId: block.chainid` and `verifyingContract`.

**19. Storage Layout Collision (Proxy)**
- D: Proxy declares state variables at sequential slots (not EIP-1967). Implementation starts at slot 0. Proxy admin overlaps implementation storage.
- FP: EIP-1967 slots. OZ Transparent/UUPS pattern. No state variables in proxy.

**20. Token Decimal Mismatch**
- D: Cross-token math uses hardcoded `1e18` or assumes identical decimals. USDC (6) vs DAI (18) mixed without normalization.
- FP: Per-token `decimals()` normalization. Canonical WAD/RAY scaling.

**21. Approve Race Condition**
- D: `approve(spender, newAmount)` called without first setting to 0. Front-runner spends old allowance then new allowance.
- FP: `approve(0)` before new value. `increaseAllowance`/`decreaseAllowance` used.

**22. Force-Fed ETH Breaking Invariants**
- D: Contract uses `address(this).balance` for accounting. `selfdestruct(target)`, coinbase rewards, or CREATE2 pre-funding force ETH in without calling `receive()`.
- FP: Internal accounting variable only. Never reads `address(this).balance`.

**23. Unbounded Loop DoS**
- D: Loop iterates over a user-growable array (registered addresses, pending withdrawals). Gas exceeds block limit, function permanently reverts.
- FP: Fixed-size iteration. Pagination. Off-chain computation with on-chain verification.

**24. Governance Flash-Loan Vote Hijack**
- D: Governance uses current-block vote weight. No voting delay or timelock. Flash-borrow, vote, execute upgrade atomically.
- FP: `getPastVotes(block.number - 1)`. Timelock >= 24h. High quorum thresholds.

**25. ERC-4626 maxDeposit vs Actual Limit Mismatch**
- D: `maxDeposit()` returns a value but `deposit()` reverts below that limit. Downstream aggregators get wrong sizing.
- FP: Implementation consistent. Query and execution limits match.

**26. Reward Rate Changed Without Settling Accumulator**
- D: Admin updates emission rate without calling `updateReward()` first. New rate retroactively applied to entire elapsed period.
- FP: Rate-change calls `updateReward()` first. Modifier auto-settles on every state change.

**27. Withdrawal Queue Rate Lock-In Front-Run**
- D: `requestWithdraw()` locks exchange rate at request time, not claim time. Attacker front-runs pending loss event, locks pre-loss rate.
- FP: Conversion at claim time. Same-block deposit+request prevented.

**28. Dirty Higher-Order Bits in Assembly**
- D: Assembly loads value with `calldataload`/`sload` as 32 bytes but treats as narrower type without masking. Dirty bits cause mapping key mismatches or incorrect comparisons.
- FP: `and(value, mask)` applied immediately after load.

**29. Partial Redemption Accounting**
- D: Partial redemption doesn't reduce `totalQueuedShares`/`totalPendingAssets` proportionally. Inflated total skews share price.
- FP: Tracked totals reduced proportionally. Atomic full-or-nothing.

**30. Liquidation Discount Inconsistency**
- D: Liquidation discount applied differently across code paths (partial vs full, different token pairs). Arbitrageable mismatch.
- FP: Single discount source. Consistent application across all liquidation paths.

**31. Cross-Contract Storage Collision via delegatecall**
- D: `delegatecall` to external contract executes in caller's storage context. Target contract writes to slots that overlap caller's state variables.
- FP: Target contract is immutable and verified. Storage layout explicitly aligned.

**32. Sandwich Attack on Missing Deadline**
- D: Swap or liquidity operation has no deadline parameter. Transaction can be held in mempool and executed at attacker-favorable price.
- FP: `deadline` parameter validated. `block.timestamp` check present.

**33. Push Pattern — Single Recipient Blocking All**
- D: Batch distribution uses push pattern. One failing `transfer()` (blacklisted, out-of-gas) reverts entire batch.
- FP: Pull pattern. Individual try/catch. Failed transfers tracked separately.

**33a. Contract msg.sender DoS via Revert**
- D: Function sends ETH to `msg.sender` (refund, withdrawal, auction settle) without try/catch. Attacker deploys contract with reverting `receive()`/`fallback()`, permanently blocking that code path for themselves or others in a shared loop. Also applies to ERC callbacks (`onERC721Received`, `tokensReceived`) that revert or consume all gas.
- FP: Pull pattern (user claims separately). `try/catch` around the transfer with failed-transfer tracking. Gas-limited `.call{gas: X}`.

**33b. Selective Revert — Atomic "Free Option"**
- D: User-facing function performs an action then sends value/tokens to `msg.sender`. Contract attacker checks outcome in `receive()` callback and reverts if unfavorable, getting risk-free "try and undo" on auctions, liquidations, or swaps. Attacker pays only gas on revert.
- FP: Commit-reveal pattern. Outcome determined after callback completes. No value sent to msg.sender mid-execution. Pull pattern for settlements.

**34. Stale Configuration During In-Flight Operation**
- D: Multi-step operation (request -> wait -> execute) reads config at execute time. Admin changes config between request and execute, affecting user's expected outcome.
- FP: Config snapshotted at request time. Timelock on config changes.

**35. Integer Overflow in Unchecked Block**
- D: `unchecked {}` block with user-influenced arithmetic. Overflow wraps silently in 0.8+.
- FP: Values bounded by prior checks. Overflow mathematically impossible given constraints.

**36. Weak On-Chain Randomness**
- D: Randomness from `block.prevrandao`, `blockhash(block.number - 1)`, `block.timestamp`. Validator-influenceable.
- FP: Chainlink VRF v2+. Commit-reveal scheme.

**37. Missing Rate Limits on Bridge**
- D: Bridge or OFT contract has no per-transaction or time-window transfer caps. No pause mechanism during active exploit.
- FP: Per-tx and per-window rate limits. `whenNotPaused` modifier. Emergency multisig.

**38. Signed Integer Mishandling in Assembly**
- D: Assembly uses `shr` instead of `sar` for signed right shift. `lt`/`gt` instead of `slt`/`sgt`. Negative numbers treated as huge positives.
- FP: Consistent `sar`/`slt`/`sgt` for signed operations.

**39. ERC-1155 Unchecked Array Lengths**
- D: `safeBatchTransferFrom` iterates `ids`/`amounts` without `require(ids.length == amounts.length)`. Assembly paths may read uninitialized memory.
- FP: OZ ERC1155 base unmodified. Custom override asserts equal lengths.

**40. Slippage Enforced at Intermediate Step Only**
- D: Multi-hop swap checks `minAmountOut` on first hop but not final output. Intermediate hops can be sandwiched.
- FP: `minAmountOut` validated against user's final received balance.
