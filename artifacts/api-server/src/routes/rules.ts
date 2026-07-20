/**
 * POST /api/rules/:ruleId/test-trigger
 *
 * Manually fires a rule's action immediately for demo / testing purposes.
 * Bypasses cooldown and price-threshold checks — executes the exact same
 * trade/log code path as the automatic 60-second worker cycle.
 *
 * Body:  { userId: string }
 * Reply: { ok: true, action: string, reason: string, orderId?: string }
 *        or { error: string } on failure
 *
 * Error guarantee: the ENTIRE handler is wrapped in a single try/catch so
 * any throw — including Supabase network errors and OKX call failures — is
 * caught here and returned as a valid JSON error response. Combined with the
 * global error-handling middleware in app.ts this means a raw/empty response
 * can never reach the frontend.
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

  // ── Input validation (synchronous — no try/catch needed) ──────────────────
  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }

  // ── Everything else is async I/O — wrap entirely ──────────────────────────
  try {

    // Step 1: verify the rule belongs to this user
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

    // Step 2: load the user's active OKX connection
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

    // Step 3: fire the rule (places OKX order or logs alert)
    logger.info(
      { ruleId, userId, ruleType: rule.rule_type, asset: rule.asset, isDemo: conn.is_demo },
      '[test-trigger] step 3 — calling fireRule (OKX API call next)',
    );
    const result = await fireRule(conn as DbConnection, rule as DbRule);

    // Step 4: respond
    const ms = Date.now() - t0;
    logger.info({ ruleId, userId, result, ms }, '[test-trigger] ✅ complete — sending response');
    res.json({ ok: true, ...result });

  } catch (err: unknown) {
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ ruleId, userId, err: msg, ms }, '[test-trigger] ❌ unhandled error — sending JSON 500');
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    }
  }
});

export default router;
