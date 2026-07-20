/**
 * POST /api/trade/buy
 *
 * Places a manual market buy order via the user's active OKX connection.
 * This is a user-initiated action — completely separate from the automatic
 * rule-based worker. Uses the same signing/is_demo pattern as the sell path.
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
 * Reply:
 *   { ok: true, orderId: string, asset: string }
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

  // ── Input validation ───────────────────────────────────────────────────────
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

  // ── Load OKX connection ────────────────────────────────────────────────────
  const { data: conn, error: connErr } = await supabase
    .from('okx_connections')
    .select('id, user_id, api_key, api_secret, api_passphrase, is_demo')
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle();

  if (connErr || !conn) {
    res.status(400).json({ error: 'No active OKX connection found' });
    return;
  }

  const okxConn: OkxConnection = {
    api_key:        conn.api_key        as string,
    api_secret:     conn.api_secret     as string,
    api_passphrase: conn.api_passphrase as string,
    is_demo:        conn.is_demo        as boolean,
  };

  // ── Place the order ────────────────────────────────────────────────────────
  try {
    const { orderId } = await placeMarketBuy(okxConn, asset, mode, numAmount);

    // Build human-readable strings for the trade log
    const amountStr = mode === 'spend'
      ? `$${numAmount.toFixed(2)} USD`
      : `${numAmount} ${asset}`;
    const priceNote = estimatedPrice
      ? ` @ ~$${estimatedPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/coin`
      : '';

    await logTradeEntry({
      user_id: conn.user_id as string,
      rule_id: '',   // no rule — this is a manual user action
      asset,
      action:  `Bought ${asset}`,
      reason:  `Manual buy: ${amountStr}${priceNote} — order ${orderId}`,
      amount:  amountStr,
    });

    logger.info(
      { userId, asset, mode, amount: numAmount, orderId, isDemo: conn.is_demo },
      '[trade] ✅ manual buy placed',
    );

    res.json({ ok: true, orderId, asset });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    logger.error({ userId, asset, mode, amount: numAmount, err: msg }, '[trade] ❌ manual buy FAILED');

    // Distinguish balance errors so the frontend can show a clearer message
    const isBalanceError = /insufficient|balance|not enough|funds/i.test(msg);
    res.status(isBalanceError ? 400 : 500).json({
      error: isBalanceError
        ? `Insufficient USDT balance to complete this purchase. (${msg})`
        : msg,
    });
  }
});

export default router;
