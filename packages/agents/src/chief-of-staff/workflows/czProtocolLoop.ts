/**
 * Sarah's cz_protocol_loop workflow.
 *
 * Runs on a schedule (Cloud Scheduler → Pub/Sub → this handler). Each tick:
 *
 *   1. Check if automation is enabled (respect the config kill-switch).
 *   2. Check convergence state. If green, pause runs and notify once.
 *   3. Run auto-reassignment for misrouted tasks.
 *   4. Tick shadow-eval — queue pending canaries, evaluate completed ones,
 *      promote challengers that beat their gate, escalate stuck ones.
 *   5. Trigger scheduled test runs:
 *      - Every 30 min: critical (P0 only) if any P0 is currently failing
 *      - Nightly 04:00 UTC: full
 *      - On-demand: single/canary if specific tasks/agents need attention
 *   6. Summarize what was done and emit to Slack on state transitions.
 *
 * This file is framework-agnostic — it doesn't assume any specific workflow
 * engine. The entry point `runCzProtocolLoop` is a pure async function that
 * the Glyphor agent framework can invoke. Wire it in wherever your workflow
 * registry lives (likely packages/agents/src/chief-of-staff/workflows/).
 *
 * IMPORTANT: this does NOT replace your existing processCzBatchFailures
 * reflection bridge — it complements it. Reflection stages prompts,
 * shadow-eval decides whether to deploy them, and this loop just keeps
 * everything running.
 */

import { systemQuery } from '@glyphor/shared/db';

// ── Config & types ──────────────────────────────────────

// When invoked inside the scheduler Cloud Run process, prefer loopback so we
// don't have to re-authenticate against ourselves. Fall back to SCHEDULER_URL
// or PUBLIC_URL when running out-of-process.
const CANONICAL_SCHEDULER_URL =
  process.env.SCHEDULER_URL
  ?? (process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : undefined)
  ?? process.env.PUBLIC_URL
  ?? 'http://127.0.0.1:8080';

async function schedulerFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  // In production this would use the same auth pathway as other
  // scheduler-internal calls. For now we assume the loop runs inside the
  // scheduler process itself, which is true when this module is imported
  // directly by the Cloud Scheduler Pub/Sub handler. If you want to run
  // this out-of-process, replace this with buildApiHeaders() + fetch().
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // In-process loopback secret minted by scheduler/server.ts on startup.
  // When runCzProtocolLoop is invoked inside the same process, this header
  // lets the request bypass dashboard-admin auth without exposing the
  // bypass to any external caller (the secret only lives in this process's memory).
  if (process.env.CZ_LOOP_INTERNAL_SECRET) {
    headers['X-Glyphor-Internal-Secret'] = process.env.CZ_LOOP_INTERNAL_SECRET;
  }
  const res = await fetch(`${CANONICAL_SCHEDULER_URL}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${path} → ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

interface LoopTickResult {
  skipped_reason?: 'disabled' | 'green_paused';
  convergence: {
    state: 'green' | 'converging' | 'stuck';
    pass_rate: number;
    p0_pass_rate: number;
    trend_7d: number;
  };
  reassignments: number;
  shadow_ticks: Array<{ id: string; state: string }>;
  runs_queued: Array<{ batch_id: string; mode: string; reason: string }>;
  escalations: string[];
}

// ── Entry point ──────────────────────────────────────────

export async function runCzProtocolLoop(opts: {
  trigger: 'interval' | 'nightly' | 'manual';
  dry_run?: boolean;
} = { trigger: 'interval' }): Promise<LoopTickResult> {
  const result: LoopTickResult = {
    convergence: { state: 'converging', pass_rate: 0, p0_pass_rate: 0, trend_7d: 0 },
    reassignments: 0,
    shadow_ticks: [],
    runs_queued: [],
    escalations: [],
  };

  // 1. Kill-switch
  const cfg = await systemQuery<{ key: string; value_json: unknown }>(
    "SELECT key, value_json FROM cz_automation_config WHERE key='loop_enabled'",
  );
  const enabled = (cfg[0]?.value_json as boolean) ?? true;
  if (!enabled) {
    result.skipped_reason = 'disabled';
    console.log('[CZ Loop] disabled by config; exiting');
    return result;
  }

  // 2. Convergence check
  const convergence = await schedulerFetch<LoopTickResult['convergence'] & {
    stuck_tasks: Array<{ task_id: string; task_number: number; tag: string; attempts: number }>;
    should_pause_auto_runs: boolean;
  }>('/api/cz/shadow/convergence');
  result.convergence = {
    state: convergence.state,
    pass_rate: convergence.pass_rate,
    p0_pass_rate: convergence.p0_pass_rate,
    trend_7d: convergence.trend_7d,
  };

  // Emit convergence state transitions to Slack (once per transition —
  // dedupe by writing to a small state table).
  await maybeEmitStateTransition(convergence.state, convergence);

  if (convergence.should_pause_auto_runs) {
    result.skipped_reason = 'green_paused';
    console.log(`[CZ Loop] convergence=green, pass_rate=${convergence.pass_rate}; pausing auto-runs`);
    return result;
  }

  if (opts.dry_run) {
    console.log('[CZ Loop] dry_run — would proceed with actions', convergence);
    return result;
  }

  // 3. Auto-reassignment — clears agent_retired / misrouted infra issues.
  try {
    const { reassignments } = await schedulerFetch<{ reassignments: Array<unknown> }>(
      '/api/cz/shadow/auto-reassign',
      { method: 'POST' },
    );
    result.reassignments = reassignments.length;
    if (reassignments.length > 0) {
      console.log(`[CZ Loop] auto-reassigned ${reassignments.length} task(s)`);
    }
  } catch (e) {
    console.error('[CZ Loop] auto-reassign failed:', e);
  }

  // 4. Shadow-eval tick
  try {
    const { results } = await schedulerFetch<{ results: Array<{ id: string; state: string }> }>(
      '/api/cz/shadow/tick',
      { method: 'POST' },
    );
    result.shadow_ticks = results;
    const autoPromoted = results.filter((r) => r.state === 'auto_promoted');
    const escalated    = results.filter((r) => r.state === 'human_review');
    for (const r of autoPromoted) {
      await notifySlack(
        `🟢 CZ shadow-eval auto-promoted a prompt mutation (shadow_eval=${r.id.slice(0,8)}). ` +
        `Every 5th auto-promotion is flagged for audit — check the CZ dashboard.`,
      );
    }
    for (const r of escalated) {
      const reason = await systemQuery<{ escalation_reason: string | null }>(
        'SELECT escalation_reason FROM cz_shadow_evals WHERE id=$1', [r.id],
      );
      const msg = `🟡 CZ shadow-eval ${r.id.slice(0,8)} escalated: ${reason[0]?.escalation_reason ?? 'unknown'}`;
      result.escalations.push(msg);
      await notifySlack(msg);
    }
  } catch (e) {
    console.error('[CZ Loop] shadow tick failed:', e);
  }

  // 5. Scheduled test runs
  if (opts.trigger === 'nightly') {
    // Nightly: full run. This seeds the drift chart and catches regressions.
    try {
      const r = await schedulerFetch<{ batch_id: string }>(
        '/api/cz/runs',
        { method: 'POST', body: { mode: 'full', triggered_by: 'auto:scheduler' } },
      );
      result.runs_queued.push({ batch_id: r.batch_id, mode: 'full', reason: 'nightly full run' });
    } catch (e) {
      console.error('[CZ Loop] nightly full run failed to queue:', e);
    }
  } else if (opts.trigger === 'interval') {
    // Interval: critical run IF there are currently-failing P0s AND there
    // hasn't been a critical/full run in the last interval window.
    const recent = await systemQuery<{ n: number }>(`
      SELECT COUNT(*)::int AS n FROM cz_runs
        WHERE trigger_type IN ('critical','full')
          AND started_at > NOW() - INTERVAL '30 minutes'
    `);
    if ((recent[0]?.n ?? 0) === 0 && convergence.p0_pass_rate < 1) {
      try {
        const r = await schedulerFetch<{ batch_id: string }>(
          '/api/cz/runs',
          { method: 'POST', body: { mode: 'critical', triggered_by: 'auto:scheduler' } },
        );
        result.runs_queued.push({ batch_id: r.batch_id, mode: 'critical', reason: 'interval critical (P0 failing)' });
      } catch (e) {
        console.error('[CZ Loop] interval critical run failed to queue:', e);
      }
    }
  }

  // 6. Stuck-task escalation — surface the worst recurring failure with a
  // pre-built fix brief so a human can just act on it.
  if (convergence.state === 'stuck' && convergence.stuck_tasks.length > 0) {
    const worst = convergence.stuck_tasks[0];
    const msg =
      `🔴 CZ loop stuck on task #${worst.task_number}: tag "${worst.tag}" ` +
      `has fired ${worst.attempts} times with no pass-rate improvement. ` +
      `Prompt mutations are not fixing this — likely needs code change, ` +
      `task redefinition, or role reassignment. ` +
      `https://dashboard.glyphor.io/governance/cz?task=${worst.task_id}`;
    result.escalations.push(msg);
    await notifySlack(msg);
  }

  console.log(`[CZ Loop] tick complete — state=${convergence.state}, ` +
    `reassigned=${result.reassignments}, shadow_ticks=${result.shadow_ticks.length}, ` +
    `runs_queued=${result.runs_queued.length}, escalations=${result.escalations.length}`);
  return result;
}

// ── Notifications ────────────────────────────────────────

async function notifySlack(message: string): Promise<void> {
  // Wire to your Slack integration. For now, log — the ops team can see
  // Cloud Run logs. Replace with your actual slackPost helper when ready.
  const channel = (await systemQuery<{ value_json: string }>(
    "SELECT value_json FROM cz_automation_config WHERE key='slack_escalation_channel'",
  ))[0]?.value_json ?? '#cz-automation';
  console.log(`[CZ Loop → Slack ${channel}] ${message}`);
  // TODO: replace with your slack integration, e.g.:
  // await slackPost({ channel, text: message });
}

// ── State transition dedupe ──────────────────────────────

/**
 * Emit a Slack notification exactly once per state transition. Uses a
 * tiny marker row in cz_automation_config (key='last_convergence_state').
 */
async function maybeEmitStateTransition(
  state: 'green' | 'converging' | 'stuck',
  ctx: { pass_rate: number; p0_pass_rate: number; trend_7d: number },
): Promise<void> {
  const last = await systemQuery<{ value_json: unknown }>(
    "SELECT value_json FROM cz_automation_config WHERE key='last_convergence_state'",
  );
  const lastState = last[0]?.value_json as string | undefined;
  if (lastState === state) return;

  await systemQuery(`
    INSERT INTO cz_automation_config (key, value_json, updated_by)
      VALUES ('last_convergence_state', $1::jsonb, 'cz_loop')
      ON CONFLICT (key) DO UPDATE SET value_json=$1::jsonb, updated_at=NOW(), updated_by='cz_loop'
  `, [JSON.stringify(state)]);

  const icon = state === 'green' ? '🟢' : state === 'stuck' ? '🔴' : '🟡';
  await notifySlack(
    `${icon} CZ protocol state: ${lastState ?? 'unknown'} → ${state}. ` +
    `pass_rate=${(ctx.pass_rate * 100).toFixed(1)}%, ` +
    `p0=${(ctx.p0_pass_rate * 100).toFixed(1)}%, ` +
    `trend 7d=${ctx.trend_7d >= 0 ? '+' : ''}${(ctx.trend_7d * 100).toFixed(1)} pts`,
  );
}
