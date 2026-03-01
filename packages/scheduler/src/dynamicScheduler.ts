/**
 * Dynamic Scheduler — Polls agent_schedules table for DB-defined cron jobs
 *
 * Runs alongside static SCHEDULED_JOBS from cronManager.
 * Checks every 60s for enabled schedules attached to active agents,
 * then fires matching jobs whose cron expression matches the current minute.
 */

import { systemQuery } from '@glyphor/shared/db';
import type { CompanyAgentRole, AgentExecutionResult } from '@glyphor/agent-runtime';

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
  private supabase: SupabaseClient;
  private executor: AgentExecutorFn;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastCheckMinute = -1;

  constructor(supabase: SupabaseClient, executor: AgentExecutorFn) {
    this.supabase = supabase;
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
      const { data: schedules, error } = await this.supabase
        .from('agent_schedules')
        .select('id, agent_id, cron_expression, task, payload, enabled')
        .eq('enabled', true);

      if (error) {
        console.error('[DynamicScheduler] Failed to fetch schedules:', error.message);
        return;
      }

      if (!schedules || schedules.length === 0) return;

      // Filter to schedules whose cron matches now
      const matching = (schedules as DynamicScheduleRow[]).filter(
        (s) => cronMatchesNow(s.cron_expression, now),
      );

      if (matching.length === 0) return;

      // Verify agents are still active
      // agent_schedules.agent_id stores the role string (e.g. 'chief-of-staff'),
      // so we must query company_agents.role, not .id (which is a UUID).
      const agentIds = [...new Set(matching.map((s) => s.agent_id))];
      const { data: agents } = await this.supabase
        .from('company_agents')
        .select('id, role, status')
        .in('role', agentIds)
        .eq('status', 'active');

      const activeAgentMap = new Map(
        (agents ?? []).map((a: { id: string; role: string }) => [a.role, a.role as CompanyAgentRole]),
      );

      for (const schedule of matching) {
        const role = activeAgentMap.get(schedule.agent_id);
        if (!role) continue;

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
