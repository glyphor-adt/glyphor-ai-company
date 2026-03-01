/**
 * Layer 3 – Heartbeat & Work Loop
 * Verifies that the scheduler's heartbeat, tier selection, proactive gating,
 * and abort-cooldown logic are working correctly.
 */

import type { SmokeTestConfig, TestResult, LayerResult } from '../types.js';
import { queryTable } from '../utils/supabase.js';
import { getSupabase } from '../utils/supabase.js';

interface AgentRun {
  id: string;
  agent_id: string;
  task: string;
  status: string;
  started_at: string;
  finished_at: string | null;
}

const EXECUTIVE_ROLES = ['chief-of-staff', 'cto', 'cfo', 'cmo', 'clo', 'ops'];

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

  // T3.1 — Heartbeat Firing
  tests.push(
    await runTest('T3.1', 'Heartbeat Firing', async () => {
      const runs = await queryTable<AgentRun>(
        config,
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
      const sb = getSupabase(config);
      const { data, error } = await sb
        .from('agent_runs')
        .select('agent_id')
        .gte('started_at', oneHourAgo);

      if (error) throw new Error(`Query failed: ${error.message}`);
      const rows = (data ?? []) as { agent_id: string }[];
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
      const sb = getSupabase(config);
      const { data, error } = await sb
        .from('agent_runs')
        .select('agent_id, task')
        .eq('task', 'proactive')
        .gte('started_at', fourHoursAgo);

      if (error) throw new Error(`Query failed: ${error.message}`);
      const rows = (data ?? []) as { agent_id: string; task: string }[];

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
      const sb = getSupabase(config);
      const { data: aborted, error: abortErr } = await sb
        .from('agent_runs')
        .select('*')
        .eq('status', 'aborted')
        .gte('started_at', fourHoursAgo)
        .order('started_at', { ascending: false });

      if (abortErr) throw new Error(`Query failed: ${abortErr.message}`);
      const abortedRuns = (aborted ?? []) as AgentRun[];

      if (abortedRuns.length === 0) {
        return 'SKIP: No aborted runs found to verify cooldown';
      }

      // Find the next run for the same agent after the abort
      const sample = abortedRuns[0];
      const { data: nextRuns, error: nextErr } = await sb
        .from('agent_runs')
        .select('started_at')
        .eq('agent_id', sample.agent_id)
        .gt('started_at', sample.started_at)
        .order('started_at', { ascending: true })
        .limit(1);

      if (nextErr) throw new Error(`Follow-up query failed: ${nextErr.message}`);
      if (!nextRuns || nextRuns.length === 0) {
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
