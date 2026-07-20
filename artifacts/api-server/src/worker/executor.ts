/**
 * Guardian Rule Executor
 *
 * Shared logic for firing a rule's action (place a sell order or log an alert).
 * Used by both the 60-second background worker and the Test Trigger API route.
 * Keeping it here avoids duplicating the trade/log code path.
 */

import { logger } from '../lib/logger.js';
import { supabase } from './supabase.js';
import { fetchPortfolio, placeMarketSell, type OkxConnection } from './okx.js';

// ─── Shared DB row shapes (used by both worker and route) ─────────────────────

export interface DbConnection {
  id: string;
  user_id: string;
  api_key: string;
  api_secret: string;
  api_passphrase: string;
  is_demo: boolean;
}

export interface DbRule {
  id: string;
  user_id: string;
  rule_type: 'stop_loss' | 'concentration_alert' | 'rebalance_alert';
  asset: string;
  threshold_pct: number | null;
  target_price: number | null;
  active: boolean;
}

// ─── Trade log ────────────────────────────────────────────────────────────────

export async function logTradeEntry(entry: {
  user_id: string;
  rule_id: string;
  asset: string;
  action: string;
  reason: string;
  amount?: string;
}): Promise<void> {
  // trade_log columns: id, user_id, action_taken (NOT NULL), asset, reason, details, created_at
  // rule_id and amount are not columns — amount goes into `details`.
  const details = entry.amount ? `amount: ${entry.amount}` : null;

  const { error } = await supabase.from('trade_log').insert({
    user_id:      entry.user_id,
    asset:        entry.asset,
    action_taken: entry.action,
    reason:       entry.reason,
    details,
    created_at:   new Date().toISOString(),
  });

  if (error) {
    logger.warn({ err: error, entry }, '[executor] trade_log insert failed');
  }
}

// ─── Fire rule ────────────────────────────────────────────────────────────────

export interface FireRuleResult {
  action: string;
  reason: string;
  orderId?: string;
  tradeError?: string;
}

/**
 * Immediately executes a rule's action regardless of current price / cooldown.
 * Used by the Test Trigger endpoint — not the automatic 60s cycle.
 *
 * For stop_loss: fetches current portfolio, places a real market sell via OKX
 *   (respects is_demo), logs to trade_log.
 * For alerts: logs the alert to trade_log.
 */
export async function fireRule(
  conn: DbConnection,
  rule: DbRule,
): Promise<FireRuleResult> {
  const okxConn: OkxConnection = {
    api_key:        conn.api_key,
    api_secret:     conn.api_secret,
    api_passphrase: conn.api_passphrase,
    is_demo:        conn.is_demo,
  };

  // Always fetch a fresh portfolio snapshot so amounts and prices are live
  const portfolio = await fetchPortfolio(okxConn);

  // ── Stop-loss: place a real market sell ────────────────────────────────────
  if (rule.rule_type === 'stop_loss') {
    const assetData = portfolio.assets.find((a) => a.symbol === rule.asset);
    if (!assetData || assetData.balance <= 0) {
      throw new Error(`${rule.asset} has no sellable balance in this portfolio`);
    }

    const currentPrice = assetData.usdValue / assetData.balance;
    const baseReason = rule.target_price != null && rule.target_price > 0
      ? `Manual test trigger: ${rule.asset} price ${currentPrice.toFixed(4)} (target ${rule.target_price.toFixed(4)}) — forced via Test Trigger`
      : `Manual test trigger: ${rule.asset} — forced via Test Trigger`;

    let orderId = '(dry-run)';
    let tradeError: string | undefined;

    try {
      const sell = await placeMarketSell(okxConn, rule.asset, assetData.balance);
      orderId = sell.orderId;
      logger.info(
        { ruleId: rule.id, asset: rule.asset, sz: assetData.balance, orderId, isDemo: conn.is_demo },
        '[executor] ✅ test-trigger stop-loss sell placed',
      );
    } catch (err: unknown) {
      tradeError = (err as Error).message ?? String(err);
      logger.error(
        { ruleId: rule.id, asset: rule.asset, err: tradeError },
        '[executor] ❌ test-trigger sell FAILED',
      );
    }

    const action = tradeError ? `Sell failed — ${rule.asset}` : `Sold ${rule.asset}`;
    const reason = tradeError
      ? `${baseReason} — order error: ${tradeError}`
      : `${baseReason} — order ${orderId}`;

    await logTradeEntry({
      user_id: conn.user_id,
      rule_id: rule.id,
      asset:   rule.asset,
      action,
      reason,
      amount:  assetData.balance.toString(),
    });

    return { action, reason, orderId, tradeError };
  }

  // ── Alert rules: log to trade_log, no trade ────────────────────────────────
  const assetData = portfolio.assets.find((a) => a.symbol === rule.asset);
  const label = rule.rule_type === 'rebalance_alert' ? 'Rebalance alert' : 'Concentration alert';
  const reason = assetData
    ? `Manual test trigger: ${label} for ${rule.asset} (${assetData.pct.toFixed(1)}% of portfolio) — forced via Test Trigger`
    : `Manual test trigger: ${label} for ${rule.asset} — forced via Test Trigger`;

  await logTradeEntry({
    user_id: conn.user_id,
    rule_id: rule.id,
    asset:   rule.asset,
    action:  'Alert',
    reason,
  });

  logger.info(
    { ruleId: rule.id, type: rule.rule_type, asset: rule.asset },
    '[executor] 🔔 test-trigger alert logged to trade_log',
  );

  return { action: 'Alert', reason };
}
