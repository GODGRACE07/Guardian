---
name: trade_log Supabase schema
description: Actual columns in the trade_log table — differs from what the code originally assumed
---

## Actual trade_log columns
`id`, `user_id`, `action_taken` (NOT NULL), `asset`, `reason`, `details` (nullable), `created_at`

**Does NOT have:** `action`, `rule_id`, `amount`, `order_id`, `rule_type`, `symbol`, `description`, `notes`, `timestamp`, `executed_at`

## Why this matters
The server code originally tried to insert `action`, `rule_id`, and `amount` — none of which exist. This caused silent PGRST204 failures, meaning every trade executed on OKX but zero rows were ever written to trade_log (Activity Log always showed "No actions yet").

## How to apply
- In `logTradeEntry` (executor.ts): insert only `user_id`, `asset`, `action_taken`, `reason`, `details`, `created_at`
- Map `entry.action` → `action_taken`, `entry.amount` → `details` as `"amount: X"`, omit `rule_id`
- In the frontend ActivityLog (DashboardPage.tsx): read `entry.action_taken` for the label, parse `entry.details` for amount (strip `"amount: "` prefix)
