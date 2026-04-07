# Staking / Gauge Protocol — Known Vulnerability Patterns

This reference is loaded for protocols classified as staking, vault, or gauge.
Use these patterns as a checklist — verify whether each applies to the code under audit.

## Pattern 1: Reward Inflation via Stale Checkpoint (HIGH/CRITICAL)

**The #1 bug class in gauge/staking protocols.**

Mechanism: When a user's working balance (or equivalent weight) changes, all reward token integrals must be checkpointed BEFORE the balance change. If function A checkpoints all N reward tokens but function B only checkpoints 1 token before the same balance mutation, the remaining N-1 tokens have stale per-user integrals.

Attack flow:
1. User stakes via `stake()` — all tokens checkpointed, balance updated. Correct.
2. Time passes, `rewardPerToken` grows for tokens A, B, C.
3. User calls `claimRewardToken(A)` — only token A checkpointed, then balance updated.
4. Tokens B and C now have stale `userIntegral` relative to the new balance.
5. On next claim of B or C: `earned = (globalIntegral - staleUserIntegral) * newBalance` — inflated.

Detection: For every function that modifies `workingBalance` (or equivalent), verify it calls `_updateAllUserRewards` (or equivalent) for ALL tokens, not just one. Compare the checkpoint call in `stake()` vs `claim()` vs `kick()` vs `boost()`.

Historical examples: Curve gauge `claim_rewards()`, Balancer gauge `claim_rewards()`.

## Pattern 2: Boost Manipulation via Flash Loan

Mechanism: If boost calculation uses current veToken balance without a time-lock or snapshot, an attacker can flash-borrow veTokens (or underlying), stake to inflate boost, earn boosted rewards, then unstake in the same block.

Detection: Check whether `workingBalance` or boost computation has `noSameBlock`, time-lock, or snapshot-based guards. If boost is recalculated on every `stake()`/`deposit()` without any temporal guard, flash-loan boost is possible.

Guards that prevent this:
- `noSameBlock` modifier on both stake and unstake
- veToken balance based on historical checkpoint (not current)
- Boost only updates on epoch boundaries
- Minimum lock duration enforced

## Pattern 3: Multi-Token Reward Isolation Failure

Mechanism: When a gauge supports multiple reward tokens (base + extras), operations on one token's reward state must not corrupt another's. Common failure: a single shared `lastUpdateTime` used for all tokens, but tokens have different `periodFinish` values.

Detection:
- Check whether each reward token has its own `lastUpdateTime` or shares one
- Verify that `notifyRewardAmount()` for token A doesn't reset token B's timing
- Check that removing/replacing a reward token doesn't zero out unclaimed rewards for other tokens

## Pattern 4: Gauge Weight Gaming

Mechanism: In systems where gauge weights determine reward allocation (Curve-style), users can manipulate voting to concentrate rewards, then stake in the favored gauge.

Detection:
- Check whether vote changes take effect immediately or are delayed
- Verify that weight changes trigger proper reward checkpointing
- Check for vote-buying or bribery resistance mechanisms

## Pattern 5: First Depositor / Empty Gauge

Mechanism: When a gauge is empty (totalSupply = 0), the first depositor may capture accumulated rewards, or the reward rate calculation may divide by zero or produce unexpected results.

Detection:
- What happens to rewards distributed while totalSupply = 0? (Should be: lost/unclaimable, not capturable by next depositor)
- Check for division by totalSupply without zero guard
- Check whether `rewardPerTokenStored` updates correctly when transitioning from 0 to non-zero supply

## Pattern 6: Withdrawal Without Full Checkpoint

Mechanism: `withdraw()` or `unstake()` reduces a user's balance. If it doesn't checkpoint all reward tokens first, the user loses unclaimed rewards (user-harm) or, worse, the remaining users' rewards are inflated (protocol-harm).

Detection: Compare the checkpoint set in `withdraw()` vs `stake()`. They should be symmetric — both must checkpoint all reward tokens before modifying the balance.

## Pattern 7: Permissionless Kick / Boost Reset

Mechanism: Some gauges allow anyone to "kick" a user whose veToken lock has expired, reducing their boost. If the kick function doesn't properly checkpoint before reducing workingBalance, it can corrupt reward accounting.

Detection:
- Find the `kick()` or equivalent function
- Verify it checkpoints ALL reward tokens before modifying workingBalance
- Check whether the kicked user or the kicker can extract value from the transition
