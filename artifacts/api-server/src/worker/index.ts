/**
 * Guardian Background Worker — Stage 5
 *
 * Runs every 60 seconds. For every user with an active OKX connection it:
 *   1. Fetches the live OKX portfolio balance
 *   2. Evaluates each active protection rule
 *   3. For stop_loss rules that trip: places a market sell via OKX trade API
 *   4. For alert rules that trip: writes a notification to trade_log (no trade)
 *   5. Logs a summary line to the console after every cycle
 *
 * Error isolation: a failure for one user never aborts the rest of the cycle.
 *
 * Anti-spam: a per-rule in-memory cooldown (60 min) prevents the same alert
 * from being logged on every tick.  Stop-loss rules are cooled down for 24 h
 * after firing (the sell has already been placed).
 *
 * Reference prices: the first time the worker observes an asset it records the
 * USD price-per-unit.  All subsequent stop_loss comparisons use that baseline.
 * State resets on worker restart, which is fine for a demo — the first cycle
 * always establishes the baseline rather than firing immediately.
 */

import { logger } from '../lib/logger.js';
import { supabase } from './supabase.js';
import { fetchPortfolio, placeMarketSell, type OkxConnection } from './okx.js';
import { logTradeEntry, type DbConnection, type DbRule } from './executor.js';

// ─── Worker cycle status (exported for /api/status route) ─────────────────────

export interface WorkerCycleStatus {
  lastCycleAt: string | null;   // ISO timestamp of the most recent completed cycle
  lastCycleDurationMs: number;
  usersMonitored: number;
  rulesChecked: number;
  triggered: number;
}

const _cycleStatus: WorkerCycleStatus = {
  lastCycleAt: null,
  lastCycleDurationMs: 0,
  usersMonitored: 0,
  rulesChecked: 0,
  triggered: 0,
};

/** Returns a snapshot of the most recent worker cycle stats. */
export function getWorkerStatus(): WorkerCycleStatus {
  return { ..._cycleStatus };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CYCLE_MS             = 60_000;   // how often the worker runs
const ALERT_COOLDOWN_MS    = 60 * 60 * 1000;   // 1 hour between repeated alerts
const SELL_COOLDOWN_MS     = 24 * 60 * 60 * 1000; // 24 hours after a stop-loss sell

// ─── In-memory state ──────────────────────────────────────────────────────────

/**
 * pricePerUnit[ruleId] = USD value per single unit of the asset when the rule
 * was first observed.  Acts as the stop-loss baseline.
 */
const pricePerUnit = new Map<string, number>();

/**
 * lastFired[ruleId] = Date when we last wrote a trade_log entry for this rule.
 * Used to enforce cooldown windows without requiring a trade_log schema change.
 */
const lastFired = new Map<string, Date>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOnCooldown(ruleId: string, windowMs: number): boolean {
  const last = lastFired.get(ruleId);
  if (!last) return false;
  return Date.now() - last.getTime() < windowMs;
}

function markFired(ruleId: string): void {
  lastFired.set(ruleId, new Date());
}

// ─── Rule evaluation ──────────────────────────────────────────────────────────

interface EvalOutcome {
  triggered: boolean;
  reason: string;
  dropPct?: number;
  currentPct?: number;
}

function evaluateRule(
  rule: DbRule,
  portfolio: Awaited<ReturnType<typeof fetchPortfolio>>,
): EvalOutcome {
  const asset = portfolio.assets.find((a) => a.symbol === rule.asset);

  if (rule.rule_type === 'stop_loss') {
    if (!asset || asset.balance <= 0) {
      return { triggered: false, reason: 'Asset not in portfolio' };
    }

    const currentPrice = asset.usdValue / asset.balance;

    // ── Price-target mode ────────────────────────────────────────────────────
    // No baseline needed — fire immediately when price ≤ target_price.
    if (rule.target_price != null && rule.target_price > 0) {
      const willTrigger = currentPrice <= rule.target_price;
      logger.info(
        {
          ruleId:       rule.id,
          asset:        rule.asset,
          targetPrice:  rule.target_price,
          currentPrice: currentPrice,
          balance:      asset.balance,
          usdValue:     asset.usdValue,
          willTrigger,
        },
        `[worker] stop_loss target_price check — current ${currentPrice.toFixed(4)} ${willTrigger ? '<=' : '>'} target ${rule.target_price.toFixed(4)} → ${willTrigger ? 'TRIGGER' : 'no trigger'}`,
      );
      if (willTrigger) {
        return {
          triggered: true,
          reason: `Stop-loss triggered: ${rule.asset} price ${currentPrice.toFixed(4)} reached target ${rule.target_price.toFixed(4)}`,
        };
      }
      return {
        triggered: false,
        reason: `Current ${currentPrice.toFixed(4)} > target ${rule.target_price.toFixed(4)}`,
      };
    }

    // ── Percentage-drop mode (original logic) ────────────────────────────────
    // First observation — record baseline, don't trigger this cycle.
    if (!pricePerUnit.has(rule.id)) {
      pricePerUnit.set(rule.id, currentPrice);
      logger.debug(
        { ruleId: rule.id, asset: rule.asset, baselineUsd: currentPrice.toFixed(4) },
        '[worker] stop_loss baseline recorded',
      );
      return { triggered: false, reason: 'Baseline recorded on first observation' };
    }

    const basePrice = pricePerUnit.get(rule.id)!;
    if (basePrice <= 0) return { triggered: false, reason: 'Invalid baseline price' };

    const threshold = rule.threshold_pct ?? 0;
    const dropPct   = ((basePrice - currentPrice) / basePrice) * 100;

    if (dropPct >= threshold) {
      return {
        triggered: true,
        reason: `Stop-loss triggered: ${rule.asset} dropped ${dropPct.toFixed(2)}% from entry (${basePrice.toFixed(4)} → ${currentPrice.toFixed(4)})`,
        dropPct,
      };
    }

    return { triggered: false, reason: `Drop ${dropPct.toFixed(2)}% < threshold ${threshold}%` };
  }

  if (rule.rule_type === 'concentration_alert' || rule.rule_type === 'rebalance_alert') {
    if (!asset) {
      return { triggered: false, reason: 'Asset not in portfolio' };
    }

    const currentPct = asset.pct;

    if (currentPct >= rule.threshold_pct) {
      const label = rule.rule_type === 'rebalance_alert' ? 'Rebalance alert' : 'Concentration alert';
      return {
        triggered: true,
        reason: `${label}: ${rule.asset} is ${currentPct.toFixed(1)}% of portfolio (threshold: ${rule.threshold_pct}%)`,
        currentPct,
      };
    }

    return { triggered: false, reason: `${asset.pct.toFixed(1)}% < threshold ${rule.threshold_pct}%` };
  }

  return { triggered: false, reason: `Unknown rule type: ${rule.rule_type}` };
}

// ─── Per-user processing ──────────────────────────────────────────────────────

interface UserCycleResult {
  rulesChecked: number;
  rulesTriggered: number;
  tradesExecuted: number;
  alertsLogged: number;
  errors: string[];
}

async function processUser(conn: DbConnection, rules: DbRule[]): Promise<UserCycleResult> {
  const result: UserCycleResult = {
    rulesChecked:   0,
    rulesTriggered: 0,
    tradesExecuted: 0,
    alertsLogged:   0,
    errors:         [],
  };

  if (rules.length === 0) return result;

  // Fetch portfolio — if this fails, abort this user gracefully
  let portfolio: Awaited<ReturnType<typeof fetchPortfolio>>;
  try {
    const okxConn: OkxConnection = {
      api_key:        conn.api_key,
      api_secret:     conn.api_secret,
      api_passphrase: conn.api_passphrase,
      is_demo:        conn.is_demo,
    };
    portfolio = await fetchPortfolio(okxConn);
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    result.errors.push(`Portfolio fetch failed: ${msg}`);
    logger.warn(
      { userId: conn.user_id, connId: conn.id, err: msg },
      '[worker] portfolio fetch error — skipping user this cycle',
    );
    return result;
  }

  // Evaluate each rule
  for (const rule of rules) {
    result.rulesChecked++;

    const outcome = evaluateRule(rule, portfolio);

    if (!outcome.triggered) {
      logger.debug(
        { ruleId: rule.id, type: rule.rule_type, asset: rule.asset, reason: outcome.reason },
        '[worker] rule not triggered',
      );
      continue;
    }

    // ── Stop-loss: place a real trade ─────────────────────────────────────
    if (rule.rule_type === 'stop_loss') {
      // USDT is the quote currency for every OKX spot pair (e.g. BTC-USDT).
      // Attempting to sell USDT constructs the pair "USDT-USDT" which does not
      // exist on OKX — the order is always rejected. Skip these rules early and
      // put them on a long cooldown so they don't flood the Activity Log.
      if (rule.asset === 'USDT') {
        logger.warn(
          { ruleId: rule.id, asset: rule.asset, targetPrice: rule.target_price },
          '[worker] stop_loss skipped — USDT is the quote currency and cannot be sold via OKX spot pairs; delete or re-assign this rule',
        );
        markFired(rule.id);
        continue;
      }

      if (isOnCooldown(rule.id, SELL_COOLDOWN_MS)) {
        logger.debug({ ruleId: rule.id }, '[worker] stop_loss on 24h cooldown after sell — skipping');
        continue;
      }

      const assetData = portfolio.assets.find((a) => a.symbol === rule.asset);
      if (!assetData || assetData.balance <= 0) {
        result.errors.push(`stop_loss: ${rule.asset} has no sellable balance`);
        continue;
      }

      // OKX rejects orders below ~$1 USDT. Skip dust positions silently so
      // server restarts (which reset in-memory cooldowns) don't flood the log
      // with guaranteed OKX failures on leftover dust after a successful sell.
      if (assetData.usdValue < 1) {
        logger.debug(
          { ruleId: rule.id, asset: rule.asset, usdValue: assetData.usdValue },
          '[worker] stop_loss skipped — dust position below $1 OKX minimum, marking on cooldown',
        );
        markFired(rule.id); // re-arm cooldown so we don't spam on next restart
        continue;
      }

      // Only count as triggered once we've confirmed we'll actually act
      result.rulesTriggered++;

      let orderId = '(dry-run)';
      let tradeError: string | null = null;

      const okxConn: OkxConnection = {
        api_key:        conn.api_key,
        api_secret:     conn.api_secret,
        api_passphrase: conn.api_passphrase,
        is_demo:        conn.is_demo,
      };

      try {
        const sell = await placeMarketSell(okxConn, rule.asset, assetData.balance);
        orderId = sell.orderId;
        result.tradesExecuted++;
        logger.info(
          { ruleId: rule.id, asset: rule.asset, sz: assetData.balance, orderId, isDemo: conn.is_demo },
          '[worker] ✅ stop-loss sell order placed',
        );
      } catch (err: unknown) {
        tradeError = (err as Error).message ?? String(err);
        result.errors.push(`stop_loss sell failed (${rule.asset}): ${tradeError}`);
        logger.error(
          { ruleId: rule.id, asset: rule.asset, err: tradeError },
          '[worker] ❌ stop-loss sell order FAILED',
        );
      }

      // Log to trade_log regardless of whether the order succeeded
      const action = tradeError
        ? `Sell failed — ${rule.asset}`
        : `Sold ${rule.asset}`;
      const reason = tradeError
        ? `${outcome.reason} — order error: ${tradeError}`
        : `${outcome.reason} — order ${orderId}`;

      await logTradeEntry({
        user_id: conn.user_id,
        rule_id: rule.id,
        asset:   rule.asset,
        action,
        reason,
        amount:  assetData.balance.toString(),
      });

      markFired(rule.id);
    }

    // ── Alert rules: log to trade_log, no trade ───────────────────────────
    if (rule.rule_type === 'concentration_alert' || rule.rule_type === 'rebalance_alert') {
      if (isOnCooldown(rule.id, ALERT_COOLDOWN_MS)) {
        logger.debug({ ruleId: rule.id }, '[worker] alert on 1h cooldown — skipping');
        continue;
      }

      // Only count as triggered once we've confirmed we'll actually act
      result.rulesTriggered++;

      await logTradeEntry({
        user_id: conn.user_id,
        rule_id: rule.id,
        asset:   rule.asset,
        action:  'Alert',
        reason:  outcome.reason,
      });

      result.alertsLogged++;
      markFired(rule.id);
      logger.info(
        { ruleId: rule.id, type: rule.rule_type, asset: rule.asset },
        '[worker] 🔔 alert logged to trade_log',
      );
    }
  }

  return result;
}

// ─── Main cycle ───────────────────────────────────────────────────────────────

async function runCycle(): Promise<void> {
  const cycleStart = Date.now();

  // 1. Fetch all active connections
  const { data: connections, error: connErr } = await supabase
    .from('okx_connections')
    .select('id, user_id, api_key, api_secret, api_passphrase, is_demo')
    .eq('active', true);

  if (connErr) {
    logger.error({ err: connErr }, '[worker] failed to fetch connections — cycle aborted');
    return;
  }

  if (!connections || connections.length === 0) {
    logger.debug('[worker] no active connections — nothing to do this cycle');
    return;
  }

  // 2. Fetch all active rules for those users in one query
  const userIds = [...new Set((connections as DbConnection[]).map((c) => c.user_id))];

  const { data: allRules, error: rulesErr } = await supabase
    .from('rules')
    .select('id, user_id, rule_type, asset, threshold_pct, target_price, active')
    .in('user_id', userIds)
    .eq('active', true);

  if (rulesErr) {
    logger.error({ err: rulesErr }, '[worker] failed to fetch rules — cycle aborted');
    return;
  }

  const rulesByUser = new Map<string, DbRule[]>();
  for (const rule of (allRules ?? []) as DbRule[]) {
    if (!rulesByUser.has(rule.user_id)) rulesByUser.set(rule.user_id, []);
    rulesByUser.get(rule.user_id)!.push(rule);
  }

  // 3. Process each connection — isolated per user
  let totalRulesChecked   = 0;
  let totalRulesTriggered = 0;
  let totalTradesExecuted = 0;
  let totalAlertsLogged   = 0;
  let totalErrors         = 0;

  for (const conn of connections as DbConnection[]) {
    const userRules = rulesByUser.get(conn.user_id) ?? [];
    try {
      const r = await processUser(conn, userRules);
      totalRulesChecked   += r.rulesChecked;
      totalRulesTriggered += r.rulesTriggered;
      totalTradesExecuted += r.tradesExecuted;
      totalAlertsLogged   += r.alertsLogged;
      totalErrors         += r.errors.length;
    } catch (err: unknown) {
      // Safety net — processUser already catches everything, but just in case
      totalErrors++;
      logger.error(
        { userId: conn.user_id, err: (err as Error).message },
        '[worker] unexpected error processing user — skipping',
      );
    }
  }

  const elapsed = Date.now() - cycleStart;

  // 4. Human-readable console summary every cycle
  logger.info(
    {
      users:    connections.length,
      rules:    totalRulesChecked,
      triggered: totalRulesTriggered,
      trades:   totalTradesExecuted,
      alerts:   totalAlertsLogged,
      errors:   totalErrors,
      ms:       elapsed,
    },
    `[worker] cycle complete — ${connections.length} user(s), ${totalRulesChecked} rule(s) checked, ` +
    `${totalRulesTriggered} triggered (${totalTradesExecuted} trade(s), ${totalAlertsLogged} alert(s)), ` +
    `${totalErrors} error(s) — ${elapsed}ms`,
  );

  // 5. Update exported status so /api/status reflects the latest cycle
  _cycleStatus.lastCycleAt        = new Date().toISOString();
  _cycleStatus.lastCycleDurationMs = elapsed;
  _cycleStatus.usersMonitored     = connections.length;
  _cycleStatus.rulesChecked       = totalRulesChecked;
  _cycleStatus.triggered          = totalRulesTriggered;
}

// ─── Start ────────────────────────────────────────────────────────────────────

export function startWorker(): void {
  logger.info(
    { intervalMs: CYCLE_MS },
    '[worker] Guardian background worker starting — first cycle in 10s',
  );

  // Short initial delay so the server is fully up before the first OKX call
  const firstRun = setTimeout(async () => {
    await runCycle().catch((err) =>
      logger.error({ err }, '[worker] unhandled error in runCycle'),
    );
  }, 10_000);

  // Then repeat every 60 seconds
  const interval = setInterval(async () => {
    await runCycle().catch((err) =>
      logger.error({ err }, '[worker] unhandled error in runCycle'),
    );
  }, CYCLE_MS);

  // Graceful shutdown on SIGTERM / SIGINT
  const cleanup = () => {
    clearTimeout(firstRun);
    clearInterval(interval);
    logger.info('[worker] background worker stopped');
  };
  process.once('SIGTERM', cleanup);
  process.once('SIGINT',  cleanup);
}
