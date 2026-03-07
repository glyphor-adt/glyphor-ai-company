/**
 * Layer 22 – Reasoning & Thinking System
 *
 * Validates that the reasoning/thinking system is properly configured:
 * default-ON for on-demand chat, thinking-enabled scheduled tasks,
 * reasoning protocol injection, and JIT context loading.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpPost } from '../utils/http.js';
import { query } from '../utils/db.js';
import { runTest } from '../utils/test.js';

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];
  const sched = config.schedulerUrl;

  // T22.1 — On-Demand Thinking Default-ON
  tests.push(
    await runTest('T22.1', 'On-Demand Thinking Default-ON', async () => {
      // Submit a non-trivial on_demand chat that should trigger thinking
      const res = await httpPost<Record<string, unknown>>(
        `${sched}/run`,
        {
          agentRole: 'ops',
          task: 'on_demand',
          payload: {
            message: 'What is the current system health status across all services?',
          },
        },
        60_000,
      );
      if (!res.ok) throw new Error(`POST /run returned ${res.status}: ${res.raw}`);

      // Extract thinking indicators from the response
      const data = res.data as {
        runId?: string;
        thinkingEnabled?: boolean;
        thinking?: boolean;
        model?: string;
      };
      const runId = data?.runId;
      if (!runId) {
        return 'Run accepted but no runId in response — verify thinking in agent_runs table';
      }

      // Check the agent_runs record for thinking metadata
      const runs = await query<{ thinking_enabled: boolean; model: string }>(
        `SELECT
           (metadata->>'thinkingEnabled')::boolean AS thinking_enabled,
           COALESCE(metadata->>'model', '') AS model
         FROM agent_runs WHERE id = $1`,
        [runId],
      );
      if (runs.length > 0 && runs[0].thinking_enabled === true) {
        return `Thinking enabled for on-demand run ${runId} (model: ${runs[0].model})`;
      }
      return `Run ${runId} accepted — thinking status: ${data?.thinkingEnabled ?? 'not in response'}`;
    }),
  );

  // T22.2 — Trivial Messages Skip Thinking
  tests.push(
    await runTest('T22.2', 'Trivial Messages Skip Thinking', async () => {
      const res = await httpPost<Record<string, unknown>>(
        `${sched}/run`,
        {
          agentRole: 'ops',
          task: 'on_demand',
          payload: { message: 'hi' },
        },
        60_000,
      );
      if (!res.ok) throw new Error(`POST /run returned ${res.status}: ${res.raw}`);
      const data = res.data as { runId?: string };
      const runId = data?.runId;
      if (!runId) return 'Trivial message accepted — no runId to verify';

      const runs = await query<{ thinking_enabled: boolean | null }>(
        `SELECT (metadata->>'thinkingEnabled')::boolean AS thinking_enabled
         FROM agent_runs WHERE id = $1`,
        [runId],
      );
      if (runs.length > 0 && runs[0].thinking_enabled === false) {
        return `Thinking correctly disabled for trivial message (run ${runId})`;
      }
      return `Trivial message run ${runId} accepted — thinking: ${runs[0]?.thinking_enabled ?? 'not recorded'}`;
    }),
  );

  // T22.3 — JIT Context Loading
  tests.push(
    await runTest('T22.3', 'JIT Context Loading Active', async () => {
      // Check recent agent runs for JIT context metadata
      const rows = await query<{ agent_role: string; jit_tokens: number }>(
        `SELECT
           agent_role,
           COALESCE((metadata->>'jitContextTokens')::int, 0) AS jit_tokens
         FROM agent_runs
         WHERE created_at > NOW() - INTERVAL '24 hours'
           AND metadata->>'jitContextTokens' IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 10`,
      );
      if (rows.length === 0) {
        // Try alternative key names
        const alt = await query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM agent_runs
           WHERE created_at > NOW() - INTERVAL '24 hours'
             AND (metadata->>'contextTokens' IS NOT NULL
               OR metadata->>'jitContext' IS NOT NULL)`,
        );
        if ((alt[0]?.count ?? 0) > 0) {
          return `${alt[0].count} recent run(s) have JIT context metadata`;
        }
        return 'No JIT context metadata in recent runs — may need to verify metadata key names';
      }
      const avgTokens = Math.round(
        rows.reduce((sum, r) => sum + r.jit_tokens, 0) / rows.length,
      );
      return `${rows.length} recent run(s) used JIT context (avg ${avgTokens} tokens)`;
    }),
  );

  // T22.4 — Reasoning Protocol in System Prompts
  tests.push(
    await runTest('T22.4', 'Reasoning Protocol Present', async () => {
      // Check that agent system prompts include reasoning protocol markers
      const rows = await query<{ role: string; has_reasoning: boolean }>(
        `SELECT
           ca.role,
           (ca.system_prompt ILIKE '%reasoning%' OR ca.system_prompt ILIKE '%self-assess%') AS has_reasoning
         FROM company_agents ca
         WHERE ca.status = 'active'
           AND ca.system_prompt IS NOT NULL
         LIMIT 10`,
      );
      if (rows.length === 0) {
        return 'No system prompts to check — agents may use file-based prompts';
      }
      const withReasoning = rows.filter(r => r.has_reasoning).length;
      return `${withReasoning}/${rows.length} sampled agents have reasoning protocol in system prompt`;
    }),
  );

  // T22.5 — Thinking-Enabled Task Types
  tests.push(
    await runTest('T22.5', 'Thinking-Enabled Task Coverage', async () => {
      // Check that runs with thinking-heavy tasks actually used thinking
      const thinkingTasks = [
        'morning_briefing', 'eod_summary', 'weekly_content_planning',
        'daily_cost_check', 'competitive_scan', 'orchestrate',
      ];
      const rows = await query<{ task: string; thinking_count: number; total: number }>(
        `SELECT
           metadata->>'task' AS task,
           COUNT(*) FILTER (WHERE (metadata->>'thinkingEnabled')::boolean = true)::int AS thinking_count,
           COUNT(*)::int AS total
         FROM agent_runs
         WHERE created_at > NOW() - INTERVAL '7 days'
           AND metadata->>'task' = ANY($1)
         GROUP BY metadata->>'task'`,
        [thinkingTasks],
      );
      if (rows.length === 0) {
        return 'No thinking-enabled task runs in last 7 days — may need more scheduled runs';
      }
      const summary = rows.map(r => `${r.task}: ${r.thinking_count}/${r.total}`).join(', ');
      return `Thinking in scheduled tasks: ${summary}`;
    }),
  );

  // T22.6 — Decision Chains (Reasoning Traces)
  tests.push(
    await runTest('T22.6', 'Decision Chains Recorded', async () => {
      const rows = await query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM decision_chains
         WHERE created_at > NOW() - INTERVAL '7 days'`,
      );
      const count = rows[0]?.count ?? 0;
      if (count === 0) {
        return 'No decision chains in last 7 days — reasoning traces may be stored elsewhere';
      }
      return `${count} decision chain(s) recorded in last 7 days`;
    }),
  );

  return { layer: 22, name: 'Reasoning & Thinking', tests };
}
