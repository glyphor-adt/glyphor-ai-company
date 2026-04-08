/**
 * Dynamic Scheduler — Polls agent_schedules table for DB-defined cron jobs
 *
 * Runs alongside static SCHEDULED_JOBS from cronManager.
 * Checks every 60s for enabled schedules attached to active agents,
 * then fires matching jobs whose cron expression matches the current minute.
 *
 * shouldRun() gate: for high-churn tasks that poll a work queue, the gate
 * skips execution when there is no pending work — turning cron-polling into
 * effective event-driven behavior without changing the underlying cron setup.
 *
 * Gated tasks and their "meaningful work" definition:
 *   chief-of-staff / orchestrate   — active founder_directives with pending/dispatched assignments
 *   cmo / process_assignments       — pending or dispatched work_assignments assigned to 'cmo'
 */

import { systemQuery } from '@glyphor/shared/db';
import { isCanonicalKeepRole } from '@glyphor/shared';
import type { CompanyAgentRole, AgentExecutionResult } from '@glyphor/agent-runtime';

// ---------------------------------------------------------------------------
// shouldRun gate
// ---------------------------------------------------------------------------

interface ShouldRunResult {
  run: boolean;
  reason?: string; // populated only when run = false
}

/**
 * Returns { run: false, reason } when a task has a gating rule and no
 * meaningful work is found.  Defaults to { run: true } for any task that
 * is not explicitly gated — preserving current behaviour for everything else.
 */
async function shouldRun(agentId: string, task: string): Promise<ShouldRunResult> {
  try {
    // --- Gate 1: chief-of-staff / orchestrate ----------------------------
    // Skip when there are no active directives that still have pending or
    // dispatched assignments.  If every active directive is fully completed
    // (or there are simply no active directives), there is nothing to orchestrate.
    if (agentId === 'chief-of-staff' && task === 'orchestrate') {
      const rows = await systemQuery<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt
           FROM work_assignments wa
           JOIN founder_directives fd ON fd.id = wa.directive_id
          WHERE fd.status = 'active'
            AND wa.status IN ('pending', 'dispatched')`,
        [],
      );
      const pending = parseInt(rows?.[0]?.cnt ?? '0', 10);
      if (pending === 0) {
        return { run: false, reason: 'no_pending_directive_work' };
      }
      return { run: true };
    }

    // --- Gate 2: cmo / process_assignments --------------------------------
    // Skip when there are no work_assignments waiting for the CMO.
    if (agentId === 'cmo' && task === 'process_assignments') {
      const rows = await systemQuery<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt
           FROM work_assignments
          WHERE assigned_to = 'cmo'
            AND status IN ('pending', 'dispatched')`,
        [],
      );
      const pending = parseInt(rows?.[0]?.cnt ?? '0', 10);
      if (pending === 0) {
        return { run: false, reason: 'no_pending_assignments' };
      }
      return { run: true };
    }

    // Default: no gate defined — always run
    return { run: true };
  } catch (err) {
    // Gate query failure must not block execution; log and allow the run.
    console.error(
      `[DynamicScheduler] shouldRun check failed for ${agentId}/${task} — defaulting to run:`,
      (err as Error).message,
    );
    return { run: true };
  }
}

interface DynamicScheduleRow {
  id: string;
  agent_id: string;
  cron_expression: string;
  task: string;
  payload: Record<string, unknown> | null;
  enabled: boolean;
}

type AgentExecutorFn = (
  agentRole: CompanyAgentRole,
  task: string,
  payload: Record<string, unknown>,
) => Promise<AgentExecutionResult | void>;

function isLiveRuntimeRole(role: string): role is CompanyAgentRole {
  return isCanonicalKeepRole(role);
}

// Returns true if the given cron expression matches the provided date.
// Supports standard 5-field cron: minute hour day-of-month month day-of-week
// Supports: wildcard, specific values, ranges (1-5), steps, and lists (1,3,5)
function cronMatchesNow(expression: string, now: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const fields = [
    now.getUTCMinutes(),
    now.getUTCHours(),
    now.getUTCDate(),
    now.getUTCMonth() + 1,
    now.getUTCDay(),
  ];

  return parts.every((part, i) => fieldMatches(part, fields[i]));
}

function fieldMatches(field: string, value: number): boolean {
  if (field === '*') return true;

  return field.split(',').some((segment) => {
    // Step: */5 or 1-10/2
    if (segment.includes('/')) {
      const [range, stepStr] = segment.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) return false;

      if (range === '*') return value % step === 0;

      if (range.includes('-')) {
        const [minStr, maxStr] = range.split('-');
        const min = parseInt(minStr, 10);
        const max = parseInt(maxStr, 10);
        return value >= min && value <= max && (value - min) % step === 0;
      }

      return false;
    }

    // Range: 1-5
    if (segment.includes('-')) {
      const [minStr, maxStr] = segment.split('-');
      return value >= parseInt(minStr, 10) && value <= parseInt(maxStr, 10);
    }

    // Exact value
    return parseInt(segment, 10) === value;
  });
}

export class DynamicScheduler {
  private executor: AgentExecutorFn;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastCheckMinute = -1;

  constructor(executor: AgentExecutorFn) {
    this.executor = executor;
  }

  /**
   * Start polling every 60 seconds.
   */
  start(): void {
    if (this.intervalId) return;
    console.log('[DynamicScheduler] Started polling for dynamic schedules');
    this.intervalId = setInterval(() => this.tick(), 60_000);
    // Run immediately on start
    this.tick();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[DynamicScheduler] Stopped');
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const currentMinute = now.getUTCHours() * 60 + now.getUTCMinutes();

    // Prevent double-firing in the same minute
    if (currentMinute === this.lastCheckMinute) return;
    this.lastCheckMinute = currentMinute;

    try {
      // Fetch enabled schedules for active agents
      const schedules = await systemQuery<DynamicScheduleRow>(
        'SELECT id, agent_id, cron_expression, task, payload, enabled FROM agent_schedules WHERE enabled = $1',
        [true],
      );

      if (!schedules || schedules.length === 0) return;

      const liveSchedules = schedules.filter((schedule) => isLiveRuntimeRole(schedule.agent_id));
      if (liveSchedules.length === 0) return;

      // Filter to schedules whose cron matches now
      const matching = liveSchedules.filter(
        (s) => cronMatchesNow(s.cron_expression, now),
      );

      if (matching.length === 0) return;

      // Verify agents are still active
      // agent_schedules.agent_id stores the role string (e.g. 'chief-of-staff'),
      // so we must query company_agents.role, not .id (which is a UUID).
      const agentIds = [...new Set(matching.map((s) => s.agent_id))].filter(isLiveRuntimeRole);
      if (agentIds.length === 0) return;
      const agents = await systemQuery<{ id: string; role: string; status: string }>(
        'SELECT id, role, status FROM company_agents WHERE role = ANY($1) AND status = $2',
        [agentIds, 'active'],
      );

      const activeAgentMap = new Map(
        (agents ?? []).map((a: { id: string; role: string }) => [a.role, a.role as CompanyAgentRole]),
      );

      for (const schedule of matching) {
        const role = activeAgentMap.get(schedule.agent_id);
        if (!role) continue;

        // Value gate: skip if this task has a pending-work rule and no work exists.
        const gate = await shouldRun(schedule.agent_id, schedule.task);
        if (!gate.run) {
          console.log(
            `[DynamicScheduler] Skipping ${schedule.agent_id}/${schedule.task}: ${gate.reason}`,
          );
          continue;
        }

        console.log(
          `[DynamicScheduler] Firing: ${schedule.agent_id}/${schedule.task} (${schedule.cron_expression})`,
        );

        try {
          await this.executor(role, schedule.task, schedule.payload ?? {});
        } catch (err) {
          console.error(
            `[DynamicScheduler] Error running ${schedule.agent_id}/${schedule.task}:`,
            (err as Error).message,
          );
        }
      }
    } catch (err) {
      console.error('[DynamicScheduler] Tick error:', (err as Error).message);
    }
  }
}
