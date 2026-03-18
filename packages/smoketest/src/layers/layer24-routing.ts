/**
 * Layer 24 - LLM Routing Health
 *
 * Validates that routing metadata is populated, multi-model routing is active,
 * deterministic pre-check skips are occurring, default fallback is rare,
 * code-generation runs are using gpt-5.4, daily cost is bounded, and abort rate
 * is within target.
 */

import type { LayerResult, SmokeTestConfig, TestResult } from '../types.js';
import { query } from '../utils/db.js';
import { runTest } from '../utils/test.js';

const SINCE = "NOW() - INTERVAL '2 hours'";

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function run(_config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // T24.1 - Routing columns are populated on recent runs
  tests.push(
    await runTest('T24.1', 'Routing Columns Populated', async () => {
      const rows = await query<{ total: string | number; routed: string | number }>(`
        SELECT COUNT(*) AS total, COUNT(routing_rule) AS routed
        FROM agent_runs
        WHERE created_at > ${SINCE}
      `);
      const total = toNum(rows[0]?.total);
      const routed = toNum(rows[0]?.routed);
      const routedPct = total > 0 ? (routed / total) * 100 : 0;

      if (total === 0) {
        return 'No agent runs in the last 6 hours; unable to validate routing population yet';
      }
      if (routedPct <= 90) {
        return `⚠ ${routedPct.toFixed(1)}% of runs have routing data (${routed}/${total}); expected > 90% after full rollout`;
      }
      return `${routedPct.toFixed(1)}% of runs have routing data (${routed}/${total})`;
    }),
  );

  // T24.2 - Multiple models are in use (active routing)
  tests.push(
    await runTest('T24.2', 'Multi-Model Routing Active', async () => {
      const rows = await query<{ model_count: string | number }>(`
        SELECT COUNT(DISTINCT routing_model) AS model_count
        FROM agent_runs
        WHERE created_at > ${SINCE} AND routing_model IS NOT NULL
      `);
      const modelCount = toNum(rows[0]?.model_count);
      if (modelCount < 3) {
        throw new Error(`${modelCount} distinct models in use; expected >= 3`);
      }
      return `${modelCount} distinct models in use (expected >= 3)`;
    }),
  );

  // T24.3 - Deterministic pre-check skips are happening
  tests.push(
    await runTest('T24.3', 'Deterministic Pre-Checks Active', async () => {
      const rows = await query<{ skipped: string | number }>(`
        SELECT COUNT(*) AS skipped
        FROM agent_runs
        WHERE status = 'skipped_precheck' AND created_at > ${SINCE}
      `);
      const skipped = toNum(rows[0]?.skipped);
      if (skipped <= 0) {
        return '⚠ 0 runs skipped via pre-check in last 6 hours — expected after deterministic pre-check rollout';
      }
      return `${skipped} runs skipped via pre-check`;
    }),
  );

  // T24.4 - Default routing rule remains rare
  tests.push(
    await runTest('T24.4', 'Default Rule Rare', async () => {
      const rows = await query<{ defaults: string | number; total: string | number }>(`
        SELECT
          COUNT(*) FILTER (WHERE routing_rule = 'default') AS defaults,
          COUNT(*) FILTER (WHERE routing_rule IS NOT NULL) AS total
        FROM agent_runs
        WHERE created_at > ${SINCE}
      `);
      const defaults = toNum(rows[0]?.defaults);
      const total = toNum(rows[0]?.total);
      const defaultPct = total > 0 ? (defaults / total) * 100 : 0;

      if (total === 0) {
        return 'No routed runs in the last 6 hours; unable to evaluate default rule frequency';
      }
      if (defaultPct >= 10) {
        throw new Error(`${defaultPct.toFixed(1)}% of routed runs hit default rule (${defaults}/${total}); expected < 10%`);
      }
      return `${defaultPct.toFixed(1)}% of routed runs hit default rule (${defaults}/${total}, expected < 10%)`;
    }),
  );

  // T24.5 - Code-generation capabilities route to gpt-5.4
  tests.push(
    await runTest('T24.5', 'Code Gen Uses GPT-5.4', async () => {
      const rows = await query<{ correct: string | number; total: string | number }>(`
        SELECT
          COUNT(*) FILTER (WHERE routing_model = 'gpt-5.4') AS correct,
          COUNT(*) AS total
        FROM agent_runs
        WHERE 'code_generation' = ANY(routing_capabilities)
          AND status = 'completed'
          AND created_at > ${SINCE}
      `);
      const correct = toNum(rows[0]?.correct);
      const total = toNum(rows[0]?.total);
      const correctPct = total > 0 ? (correct / total) * 100 : 100;

      if (total < 15) {
        return `⚠ Only ${total} completed code_generation runs in the last 2 hours; need >= 15 for a stable KPI window`;
      }

      if (correctPct <= 80) {
        throw new Error(`${correctPct.toFixed(1)}% of code_generation runs use gpt-5.4 (${correct}/${total}); expected > 80%`);
      }
      return `${correctPct.toFixed(1)}% of code_generation runs use gpt-5.4 (${correct}/${total})`;
    }),
  );

  // T24.6 - Daily run cost remains under cap
  tests.push(
    await runTest('T24.6', 'Daily Cost Under Control', async () => {
      const rows = await query<{ total_cost: string | number | null }>(`
        SELECT COALESCE(ROUND(SUM(cost)::numeric, 2), 0) AS total_cost
        FROM agent_runs
        WHERE created_at > CURRENT_DATE
      `);
      const dailyCost = toNum(rows[0]?.total_cost ?? 0);
      if (dailyCost >= 2.5) {
        return `⚠ Today's cost is $${dailyCost.toFixed(2)}; target < $2.50/day after optimization rollout`;
      }
      return `Today's cost: $${dailyCost.toFixed(2)} (cap: $2.50/day)`;
    }),
  );

  // T24.7 - Abort rate is acceptable
  tests.push(
    await runTest('T24.7', 'Abort Rate Acceptable', async () => {
      const rows = await query<{ total: string | number; aborted: string | number }>(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'aborted') AS aborted
        FROM agent_runs
        WHERE created_at > ${SINCE}
          AND status != 'skipped_precheck'
          AND task != 'proactive'
      `);
      const total = toNum(rows[0]?.total);
      const aborted = toNum(rows[0]?.aborted);
      const abortPct = total > 0 ? (aborted / total) * 100 : 0;

      if (total < 25) {
        return `⚠ Abort KPI sample too small in last 2 hours (${total} runs); need >= 25`;
      }

      if (abortPct >= 15) {
        throw new Error(`${abortPct.toFixed(1)}% abort rate (${aborted}/${total}); expected < 15%`);
      }
      return `${abortPct.toFixed(1)}% abort rate (${aborted}/${total}, cap: 15%)`;
    }),
  );

  return { layer: 24, name: 'LLM Routing Health', tests };
}
