---
name: API Server Error Hardening
description: The three root causes of intermittent "Unexpected end of JSON input" and how they were fixed
---

## Root causes identified

### 1. No timeout on OKX fetch() calls (primary intermittent cause)
`okxGet()` and `okxPost()` called `fetch()` with no timeout. When OKX is slow or rate-limiting, the fetch hangs indefinitely. Replit's reverse proxy kills the idle client connection first, delivering a zero-byte body. The browser's `response.json()` throws "Unexpected end of JSON input" on an empty body.

**Fix:** `fetchWithTimeout()` wrapper in `okx.ts` uses `AbortController` + `setTimeout(15_000)`. Applied to both `okxGet` and `okxPost`. Any OKX hang now throws `AbortError` after 15s, which is caught by the route try/catch and returned as a proper JSON 500.

### 2. Supabase awaits outside try/catch in route handlers
In both `rules.ts` and `trade.ts`, the initial Supabase queries ran outside any try/catch. A network exception there propagated uncaught through the async handler. Express 5 catches async rejections but passes them to error middleware — of which there was none.

**Fix:** Both route handlers now wrap their ENTIRE async body in a single top-level try/catch. Supabase queries, OKX calls, and trade_log writes are all covered.

### 3. No global JSON error-handling middleware
`app.ts` had zero error middleware. Express's default `finalhandler` sends an HTML page (or empty body on edge cases) — not JSON. Frontend `res.json()` then fails.

**Fix:** 4-argument error handler added as last middleware in `app.ts`. Checks `res.headersSent` before writing; always returns `{ error: string }` with status 500.

## Additional: process-level safety nets
`index.ts` now has `process.on('unhandledRejection')` (logs + continues) and `process.on('uncaughtException')` (logs + exits). Prevents silent swallowing of worker-side async failures.

## Detailed step logging
Both `rules.ts` and `trade.ts` log at every I/O boundary with timestamps:
- `→ received` (with all input params)
- `step 1 — querying Supabase`
- `step 2 — calling OKX API`  
- `step 2 ✅ OKX order accepted` (with orderId)
- `step 3 — writing to trade_log`
- `✅ complete — sending response` (with total ms)
- `❌ unhandled error` (with total ms)

**Why:** When failures occur, the exact step that failed is immediately visible in server logs rather than requiring guesswork.

## How to apply
Any new route that makes external I/O (Supabase, OKX) must:
1. Wrap ALL async code in one top-level try/catch
2. Check `if (!res.headersSent)` before sending error response in catch
3. Log at each I/O boundary with `[route-name] step N — description`
The global error middleware in app.ts is a backstop, not a substitute for per-route try/catch.
