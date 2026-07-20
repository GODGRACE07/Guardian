/**
 * POST /api/trade/buy
 *
 * Places a manual market buy order via the user's active OKX connection.
 *
 * ── Two-phase design ──────────────────────────────────────────────────────────
 * Phase 1 (fast, < 500ms): validate inputs + load the OKX connection from
 *   Supabase.  If either fails, return an error immediately.  If both succeed,
 *   respond at once with { ok: true, status: "processing" }.
 *
 * Phase 2 (background, can take minutes on OKX demo): place the OKX order and
 *   write to trade_log via setImmediate — after the HTTP response is already
 *   sent.  The client should not wait for this.  The Activity Log auto-refresh
 *   will surface the completed entry naturally.
 *
 * Body:
 *   userId         string   — the Guardian user making the purchase
 *   asset          string   — coin symbol, e.g. "ETH"
 *   mode           'spend' | 'buy'
 *                    spend → amount is a USDT dollar value (e.g. 500 = spend $500)
 *                    buy   → amount is a coin quantity (e.g. 0.5 = buy 0.5 ETH)
 *   amount         number   — positive value matching the mode above
 *   estimatedPrice number?  — optional frontend price used only for logging
 *
 * Phase-1 reply (fast):
 *   { ok: true, status: "processing", asset: string }
 *   { error: string } on failure (400 for validation / balance issues, 500 otherwise)
 */

import { Router } from 'express';
import { supabase } from '../worker/supabase.js';
import { placeMarketBuy, type OkxConnection } from '../worker/okx.js';
import { logTradeEntry } from '../worker/executor.js';
import { logger } from '../lib/logger.js';

const router = Router();

router.post('/trade/buy', async (req, res) => {
  const { userId, asset, mode, amount, estimatedPrice } = req.body as {
    userId?: string;
    asset?: string;
    mode?: 'spend' | 'buy';
    amount?: number;
    estimatedPrice?: number;
  };
  const t0 = Date.now();

  logger.info({ userId, asset, mode, amount }, '[buy] → received');

  // ── Phase 1a: Input validation (synchronous) ───────────────────────────────
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }
  if (!asset || typeof asset !== 'string') {
    res.status(400).json({ error: 'asset is required' });
    return;
  }
  if (!mode || !['spend', 'buy'].includes(mode)) {
    res.status(400).json({ error: "mode must be 'spend' or 'buy'" });
    return;
  }
  const numAmount = Number(amount);
  if (!numAmount || numAmount <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  // ── Phase 1b: Load OKX connection (fast Supabase lookup) ──────────────────
  try {
    logger.info({ userId, asset }, '[buy] step 1 — querying OKX connection from Supabase');
    const { data: conn, error: connErr } = await supabase
      .from('okx_connections')
      .select('id, user_id, api_key, api_secret, api_passphrase, is_demo')
      .eq('user_id', userId)
      .eq('active', true)
      .maybeSingle();

    if (connErr || !conn) {
      logger.warn({ userId, connErr }, '[buy] no active OKX connection');
      res.status(400).json({ error: 'No active OKX connection found' });
      return;
    }

    const okxConn: OkxConnection = {
      api_key:        conn.api_key        as string,
      api_secret:     conn.api_secret     as string,
      api_passphrase: conn.api_passphrase as string,
      is_demo:        conn.is_demo        as boolean,
    };

    const connUserId = conn.user_id as string;
    const isDemo     = conn.is_demo as boolean;

    // ── Phase 1 complete — respond immediately ─────────────────────────────
    //
    // The client gets this within ~300-500ms (just a Supabase round-trip).
    // The actual OKX order + trade_log write happen in Phase 2 below, after
    // the response has already been sent, so the user never waits on OKX.
    const phase1Ms = Date.now() - t0;
    logger.info({ userId, asset, phase1Ms }, '[buy] ✅ phase 1 complete — sending ack, starting background phase');
    res.json({ ok: true, status: 'processing', asset });

    // ── Phase 2: OKX order + trade_log (background, fire-and-forget) ──────
    //
    // setImmediate runs AFTER the current event-loop tick, so the res.json()
    // above has been fully flushed before this starts.  We never touch `res`
    // again here — the response is already sent.
    setImmediate(async () => {
      const t2 = Date.now();
      try {
        logger.info(
          { userId, asset, mode, amount: numAmount, isDemo },
          '[buy] phase 2 — calling OKX trade/order API',
        );
        const { orderId } = await placeMarketBuy(okxConn, asset, mode, numAmount);
        logger.info({ userId, asset, orderId }, '[buy] phase 2 ✅ OKX order accepted');

        const amountStr = mode === 'spend'
          ? `$${numAmount.toFixed(2)} USD`
          : `${numAmount} ${asset}`;
        const priceNote = estimatedPrice
          ? ` @ ~$${estimatedPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/coin`
          : '';

        await logTradeEntry({
          user_id: connUserId,
          rule_id: '',
          asset,
          action:  `Bought ${asset}`,
          reason:  `Manual buy: ${amountStr}${priceNote} — order ${orderId}`,
          amount:  amountStr,
        });

        const ms = Date.now() - t2;
        logger.info({ userId, asset, orderId, ms }, '[buy] phase 2 ✅ complete — trade logged');
      } catch (err: unknown) {
        const ms = Date.now() - t2;
        const msg = err instanceof Error ? err.message : String(err);
        // Log the full error with stack so it's findable in server logs.
        // The user won't see this as an error toast because the response was
        // already sent — they'll see "check Activity Log" and the entry simply
        // won't appear if this fails.
        logger.error(
          { userId, asset, mode, amount: numAmount, err: msg, ms },
          '[buy] phase 2 ❌ background processing failed — trade may not appear in log',
        );
      }
    });

  } catch (err: unknown) {
    // Phase 1 (Supabase lookup) failed — respond with a proper error.
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ userId, asset, mode, amount: numAmount, err: msg, ms }, '[buy] ❌ phase 1 error — sending JSON 500');
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    }
  }
});

export default router;
