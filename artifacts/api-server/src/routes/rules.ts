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
 */

import { Router } from 'express';
import { supabase } from '../worker/supabase.js';
import { fireRule, type DbConnection, type DbRule } from '../worker/executor.js';
import { logger } from '../lib/logger.js';

const router = Router();

router.post('/rules/:ruleId/test-trigger', async (req, res) => {
  const { ruleId } = req.params;
  const { userId } = req.body as { userId?: string };

  if (!userId) {
    res.status(400).json({ error: 'userId is required' });
    return;
  }

  // Verify the rule exists and belongs to this user
  const { data: rule, error: ruleErr } = await supabase
    .from('rules')
    .select('id, user_id, rule_type, asset, threshold_pct, target_price, active')
    .eq('id', ruleId)
    .eq('user_id', userId)
    .single();

  if (ruleErr || !rule) {
    res.status(404).json({ error: 'Rule not found' });
    return;
  }

  // Fetch the user's active OKX connection
  const { data: conn, error: connErr } = await supabase
    .from('okx_connections')
    .select('id, user_id, api_key, api_secret, api_passphrase, is_demo')
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle();

  if (connErr || !conn) {
    res.status(400).json({ error: 'No active OKX connection found for this user' });
    return;
  }

  try {
    const result = await fireRule(conn as DbConnection, rule as DbRule);
    logger.info({ ruleId, userId, result }, '[route] test-trigger completed');
    res.json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? String(err);
    logger.error({ ruleId, userId, err: msg }, '[route] test-trigger failed');
    res.status(500).json({ error: msg });
  }
});

export default router;
