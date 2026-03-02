/**
 * Layer 3 – Heartbeat & Work Loop
 * Verifies that the scheduler's heartbeat, tier selection, proactive gating,
 * and abort-cooldown logic are working correctly.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { queryTable, query } from '../utils/db.js';
import { runTest } from '../utils/test.js';

interface AgentRun {
  id: string;
  agent_id: string;
  task: string;
  status: string;
  started_at: string;
  finished_at: string | null;
}

const EXECUTIVE_ROLES = ['chief-of-staff', 'cto', 'cfo', 'cmo', 'clo', 'ops'];

export async function run(config: SmokeTestConfig): Promise<LayerResult> {
  const tests: TestResult[] = [];

  // T3.1 — Heartbeat Firing
  tests.push(
    await runTest('T3.1', 'Heartbeat Firing', async () => {
      const runs = await queryTable<AgentRun>(
        'agent_runs',
        '*',
        undefined,
        { order: 'started_at', limit: 10, desc: true },
      );

      const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const recentHeartbeats = runs.filter(
        (r) =>
          (r.task === 'heartbeat' || r.agent_id === 'chief-of-staff') &&
          r.started_at >= thirtyMinAgo,
      );

      if (recentHeartbeats.length === 0) {
        throw new Error(
          'No heartbeat or chief-of-staff runs found in the last 30 minutes',
        );
      }
      return `${recentHeartbeats.length} recent heartbeat run(s) found`;
    }),
  );

  // T3.2 — Tier Selection
  tests.push(
    await runTest('T3.2', 'Tier Selection', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const rows = await query<{ agent_id: string }>(
        `SELECT agent_id FROM agent_runs WHERE started_at >= $1`,
        [oneHourAgo],
      );
      if (rows.length === 0) {
        throw new Error('No agent runs in the last hour');
      }

      const highTier = ['chief-of-staff', 'cto', 'ops'];
      const highCount = rows.filter((r) => highTier.includes(r.agent_id)).length;
      const lowCount = rows.length - highCount;

      if (highCount <= lowCount && lowCount > 0) {
        throw new Error(
          `High-tier agents (${highCount}) should outnumber low-tier (${lowCount})`,
        );
      }
      return `Tier balance OK — high-tier: ${highCount}, low-tier: ${lowCount}`;
    }),
  );

  // T3.3 — Proactive Disabled for Sub-Team
  tests.push(
    await runTest('T3.3', 'Proactive Disabled for Sub-Team', async () => {
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const rows = await query<{ agent_id: string; task: string }>(
        `SELECT agent_id, task FROM agent_runs WHERE task = 'proactive' AND started_at >= $1`,
        [fourHoursAgo],
      );

      const subTeamProactive = rows.filter(
        (r) => !EXECUTIVE_ROLES.includes(r.agent_id),
      );

      if (subTeamProactive.length > 0) {
        const agents = [...new Set(subTeamProactive.map((r) => r.agent_id))];
        throw new Error(
          `Sub-team agents ran proactive tasks: ${agents.join(', ')}`,
        );
      }
      return `No sub-team proactive runs in last 4 hours (${rows.length} executive proactive run(s))`;
    }),
  );

  // T3.4 — Abort Cooldown
  tests.push(
    await runTest('T3.4', 'Abort Cooldown', async () => {
      const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const abortedRuns = await query<AgentRun>(
        `SELECT * FROM agent_runs WHERE status = 'aborted' AND started_at >= $1 ORDER BY started_at DESC`,
        [fourHoursAgo],
      );

      if (abortedRuns.length === 0) {
        return 'SKIP: No aborted runs found to verify cooldown';
      }

      // Find the next run for the same agent after the abort
      const sample = abortedRuns[0];
      const nextRuns = await query<{ started_at: string }>(
        `SELECT started_at FROM agent_runs WHERE agent_id = $1 AND started_at > $2 ORDER BY started_at ASC LIMIT 1`,
        [sample.agent_id, sample.started_at],
      );

      if (nextRuns.length === 0) {
        return 'SKIP: Aborted agent has not run again yet';
      }

      const recovery =
        new Date(nextRuns[0].started_at).getTime() -
        new Date(sample.started_at).getTime();
      const recoveryMin = Math.round(recovery / 60_000);

      if (recoveryMin > 15) {
        throw new Error(
          `Abort cooldown too long: ${recoveryMin} min (expected ~5 min) for agent ${sample.agent_id}`,
        );
      }
      return `Abort cooldown OK — ${sample.agent_id} recovered in ${recoveryMin} min`;
    }),
  );

  // Mark skip results
  for (const t of tests) {
    if (t.status === 'pass' && t.message.startsWith('SKIP:')) {
      t.status = 'skipped';
    }
  }

  return { layer: 3, name: 'Heartbeat & Work Loop', tests };
}
