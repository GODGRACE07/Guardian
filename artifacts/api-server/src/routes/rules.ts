/**
 * POST /api/rules/:ruleId/test-trigger
 *
 * Manually fires a rule's action immediately for demo / testing purposes.
 * Bypasses cooldown and price-threshold checks — executes the exact same
 * trade/log code path as the automatic 60-second worker cycle.
 *
 * ── Two-phase design ──────────────────────────────────────────────────────────
 * Phase 1 (fast, < 500ms): validate inputs + verify the rule + load the OKX
 *   connection from Supabase.  If any step fails, return an error immediately.
 *   If all succeed, respond at once with { ok: true, status: "processing" }.
 *
 * Phase 2 (background, can take minutes on OKX demo): call fireRule (which
 *   places the OKX order or logs the alert).  Runs via setImmediate — after
 *   the HTTP response is already sent.  The Activity Log auto-refresh will
 *   surface the result naturally.
 *
 * Body:  { userId: string }
 * Phase-1 reply: { ok: true, status: "processing" }
 *               or { error: string } on failure
 */

import { Router } from 'express';
import { supabase } from '../worker/supabase.js';
import { fireRule, type DbConnection, type DbRule } from '../worker/executor.js';
import { logger } from '../lib/logger.js';

const router = Router();

router.post('/rules/:ruleId/test-trigger', async (req, res) => {
  const { ruleId } = req.params;
  const { userId } = req.body as { userId?: string };
  const t0 = Date.now();

  logger.info({ ruleId, userId }, '[test-trigger] → received');

  // ── Phase 1a: Input validation ─────────────────────────────────────────────
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }

  // ── Phase 1b: Verify rule + load connection (Supabase, fast) ──────────────
  try {
    logger.info({ ruleId, userId }, '[test-trigger] step 1 — querying rule from Supabase');
    const { data: rule, error: ruleErr } = await supabase
      .from('rules')
      .select('id, user_id, rule_type, asset, threshold_pct, target_price, active')
      .eq('id', ruleId)
      .eq('user_id', userId)
      .single();

    if (ruleErr || !rule) {
      logger.warn({ ruleId, userId, ruleErr }, '[test-trigger] rule not found');
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    logger.info({ ruleId, userId }, '[test-trigger] step 2 — querying OKX connection from Supabase');
    const { data: conn, error: connErr } = await supabase
      .from('okx_connections')
      .select('id, user_id, api_key, api_secret, api_passphrase, is_demo')
      .eq('user_id', userId)
      .eq('active', true)
      .maybeSingle();

    if (connErr || !conn) {
      logger.warn({ ruleId, userId, connErr }, '[test-trigger] no active OKX connection');
      res.status(400).json({ error: 'No active OKX connection found for this user' });
      return;
    }

    // ── Phase 1 complete — respond immediately ─────────────────────────────
    const phase1Ms = Date.now() - t0;
    logger.info(
      { ruleId, userId, ruleType: rule.rule_type, asset: rule.asset, phase1Ms },
      '[test-trigger] ✅ phase 1 complete — sending ack, starting background phase',
    );
    res.json({ ok: true, status: 'processing' });

    // ── Phase 2: fire rule (background, fire-and-forget) ──────────────────
    setImmediate(async () => {
      const t2 = Date.now();
      try {
        logger.info(
          { ruleId, userId, ruleType: rule.rule_type, asset: rule.asset, isDemo: conn.is_demo },
          '[test-trigger] phase 2 — calling fireRule (OKX API call next)',
        );
        const result = await fireRule(conn as DbConnection, rule as DbRule);
        const ms = Date.now() - t2;
        logger.info({ ruleId, userId, result, ms }, '[test-trigger] phase 2 ✅ complete');
      } catch (err: unknown) {
        const ms = Date.now() - t2;
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          { ruleId, userId, err: msg, ms },
          '[test-trigger] phase 2 ❌ background processing failed',
        );
      }
    });

  } catch (err: unknown) {
    // Phase 1 (Supabase lookup) failed
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ ruleId, userId, err: msg, ms }, '[test-trigger] ❌ phase 1 error — sending JSON 500');
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    }
  }
});

export default router;
