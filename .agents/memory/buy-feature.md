---
name: Manual Buy Feature
description: How the Guardian manual buy flow works — OKX market buy, tgtCcy parameter, route, log format
---

## OKX Market Buy — tgtCcy Parameter
- `mode='spend'` (user enters USD): `tgtCcy: 'quote_ccy'`, `sz` = USDT amount (2 dp)
- `mode='buy'` (user enters coin qty): `tgtCcy: 'base_ccy'`, `sz` = coin amount (8 dp, trailing zeros stripped)
- Route: `POST /api/trade/buy` → `artifacts/api-server/src/routes/trade.ts`

**Why:** OKX interprets `sz` differently for market buys depending on `tgtCcy`. Without it, buy orders default to base_ccy which breaks "spend $X" UX.

**How to apply:** Any future market buy order must set `tgtCcy` explicitly. Quote currency (USDT) for dollar-amount spend; base currency for coin-quantity buy.

## trade_log format for buys
- `action_taken`: `"Bought ETH"` (or whichever asset)
- `reason`: `"Manual buy: $50.00 USD @ ~$3,500.00/coin — order <orderId>"`
- `details`: `"amount: $50.00 USD"` (or `"amount: 0.5 ETH"` for coin-mode)

## Frontend BuySheet component
- Located at `artifacts/guardian/src/components/BuySheet.tsx`
- Fetches live price from OKX public ticker: `GET /api/v5/market/ticker?instId=ETH-USDT` (no auth)
- Dashboard "Buy Crypto" row only shown when `portfolioState.status === 'ok'`
- Calls `onSuccess()` after order → triggers `handleLogRefresh()` to refresh portfolio + activity log
