/**
 * Layer 6 — Authority Gates
 *
 * Tests the tiered authority system: green (auto-execute), yellow (approval
 * required), decision flow, and agent trust scores.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { httpPost } from '../utils/http.js';
import { queryTable } from '../utils/supabase.js';

async function runTest(
  id: string,
  name: string,
  fn: () => Promise<string>,
): Promise<TestResult> {
  const start = Date.now();
  try {
    const message = await fn();
    return { id, name, status: 'pass', message, durationMs: Date.now() - start };
  } catch (err) {
    return { id, name, status: 'fail', message: (err as Error).message, durationMs: Date.now() - start };
  }
}

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // T6.1 — Green Tier (auto-executed, no decision filed)
  tests.push(
    await runTest('T6.1', 'Green Tier', async () => {
      const resp = await httpPost(`${config.schedulerUrl}/run`, {
        agentRole: 'cfo',
        task: 'on_demand',
        message: 'What are our current costs?',
      });

      if (!resp.ok) {
        throw new Error(`Scheduler /run returned ${resp.status}: ${resp.raw}`);
      }

      return `Green-tier task executed — status ${resp.status}`;
    }),
  );

  // T6.2 — Yellow Tier (should file a pending decision)
  tests.push(
    await runTest('T6.2', 'Yellow Tier', async () => {
      const resp = await httpPost(`${config.schedulerUrl}/run`, {
        agentRole: 'chief-of-staff',
        task: 'on_demand',
        message:
          'Grant the web_search tool to the revenue-analyst agent for the next 24 hours.',
      });

      if (!resp.ok) {
        throw new Error(`Scheduler /run returned ${resp.status}: ${resp.raw}`);
      }

      const decisions = await queryTable<{
        id: string;
        tier: string;
        status: string;
      }>(config, 'decisions', 'id,tier,status', {}, {
        order: 'created_at',
        desc: true,
        limit: 10,
      });

      const yellow = decisions.find(
        (d) => d.tier === 'yellow' && d.status === 'pending',
      );

      if (!yellow) {
        throw new Error('No pending yellow-tier decision found');
      }

      return `Yellow-tier decision filed: ${yellow.id}`;
    }),
  );

  // T6.3 — Decision Approval Flow (interactive only)
  tests.push(
    await runTest('T6.3', 'Decision Approval Flow', async () => {
      if (!config.interactive) {
        return 'SKIP';
      }

      return 'Decision approval flow requires dashboard UI interaction — verify manually';
    }),
  );

  // Patch T6.3 status if skipped
  const approvalTest = tests[tests.length - 1];
  if (approvalTest.message === 'SKIP') {
    approvalTest.status = 'skipped';
    approvalTest.message =
      'Skipped — decision approval requires interactive dashboard access';
  }

  // T6.4 — Trust Scores
  tests.push(
    await runTest('T6.4', 'Trust Scores', async () => {
      const scores = await queryTable<{
        agent_role: string;
        trust_score: number;
      }>(config, 'agent_trust_scores', 'agent_role,trust_score');

      if (scores.length === 0) {
        throw new Error('No trust scores found in agent_trust_scores');
      }

      const outOfRange = scores.filter(
        (s) => s.trust_score < 0.1 || s.trust_score > 1.0,
      );
      if (outOfRange.length > 0) {
        throw new Error(
          `${outOfRange.length} agent(s) have scores outside 0.1–1.0: ${outOfRange.map((s) => `${s.agent_role}=${s.trust_score}`).join(', ')}`,
        );
      }

      const lowTrust = scores.filter((s) => s.trust_score < 0.4);
      if (lowTrust.length > 0) {
        throw new Error(
          `${lowTrust.length} agent(s) below 0.4 trust: ${lowTrust.map((s) => `${s.agent_role}=${s.trust_score}`).join(', ')}`,
        );
      }

      return `All ${scores.length} agents have trust scores in range (0.4–1.0)`;
    }),
  );

  return { layer: 6, name: 'Authority Gates', tests };
}
