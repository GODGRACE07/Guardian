---
name: Guardian background worker architecture
description: Where Stage 5 lives, how it's structured, and key design decisions.
---

# Guardian background worker

## Location
`artifacts/api-server/src/worker/` — hosted inside the existing Express server so no second workflow is needed.

## Key files
- `okx.ts` — server-side OKX client using `node:crypto` createHmac (NOT Web Crypto)
- `supabase.ts` — Supabase client using VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (same vars as frontend)
- `index.ts` — main loop: setInterval 60 000 ms, first cycle 10 s after boot

## Design decisions

**Reference prices are in-memory only.**
`pricePerUnit: Map<ruleId, number>` holds the first-observed USD-per-unit price for stop_loss rules. Resets on server restart — the first cycle after a restart always records baselines rather than triggering. This avoids a schema migration.
**Why:** no `reference_price_usd` column exists in the rules table.

**Anti-spam is in-memory.**
`lastFired: Map<ruleId, Date>` with cooldown windows (1h alerts, 24h stop-loss sells). Does NOT query trade_log for dedup.
**Why:** trade_log schema is unknown; in-memory is reliable regardless of schema.

**Error isolation per user.**
processUser() has its own try/catch. One bad OKX credential never aborts the rest of the cycle.

**trade_log insert fallback.**
If the full insert (with rule_id) fails with column-not-found error (Supabase code 42703), the worker retries without rule_id.

## Supabase env var note
The worker reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — the VITE_ prefix vars are available server-side too (not just in the Vite build).
