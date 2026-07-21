---
name: Worker stat accuracy fixes
description: Two bugs fixed in the background worker's cycle stat counting and dust-position handling.
---

# Worker stat accuracy fixes

## Rule 1: rulesTriggered counter — move after cooldown check

**Problem:** `result.rulesTriggered++` was incremented before the cooldown check. Every cycle after a stop_loss sell showed "1 triggered (0 trades, 0 alerts)" even though the cooldown caused an immediate skip and nothing actually happened.

**Fix:** Moved `result.rulesTriggered++` to AFTER the cooldown check (and AFTER the dust guard below) in both the stop_loss block and the alert block in `artifacts/api-server/src/worker/index.ts`.

**Why:** The cycle summary "N triggered" should only count rules where an action was actually taken.

## Rule 2: Dust guard ($1 minimum) — before OKX order

**Problem:** After a stop_loss sell, the account retains dust (e.g., 2.79e-7 SOL = ~$0.00002). In-memory cooldowns reset on server restart. So every restart triggers an OKX sell attempt on the dust, which OKX rejects with "All operations failed" (below $1 minimum order size).

**Fix (worker):** In `processUser` in `worker/index.ts`, after the `balance <= 0` check, added:
```
if (assetData.usdValue < 1) {
  markFired(rule.id);  // re-arm cooldown
  continue;
}
```

**Fix (executor):** In `fireRule` in `worker/executor.ts`, added the same check with a human-readable error throw so test-trigger shows a clear message instead of OKX's cryptic error.

**How to apply:** Any time a stop_loss is about to attempt a sell, check `usdValue < 1` first. The $1 threshold matches OKX's minimum order value.
