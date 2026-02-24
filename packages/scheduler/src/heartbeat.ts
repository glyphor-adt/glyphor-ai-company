/**
 * Heartbeat Manager — Lightweight periodic agent check-ins
 *
 * Every 10 minutes (triggered by Cloud Scheduler → POST /heartbeat),
 * checks each agent for pending work. NOT a Gemini call — just DB queries.
 * Only wakes agents that actually have work pending.
 *
 * Agent tiers determine check frequency:
 * - High:   every cycle (10 min)  — chief-of-staff, cto, ops
 * - Medium: every 2nd cycle (20 min) — other executives
 * - Low:    every 3rd cycle (30 min) — sub-team members
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompanyAgentRole, AgentExecutionResult } from '@glyphor/agent-runtime';
import { EXECUTIVE_ROLES, SUB_TEAM_ROLES } from '@glyphor/agent-runtime';
import { executeWorkLoop } from '@glyphor/agent-runtime';
import type { WakeRouter } from './wakeRouter.js';
import { buildWaves, dispatchWaves } from './parallelDispatch.js';
import type { WaveAgent } from './parallelDispatch.js';

type AgentExecutorFn = (
  agentRole: CompanyAgentRole,
  task: string,
  payload: Record<string, unknown>,
) => Promise<AgentExecutionResult | void>;

export interface HeartbeatResult {
  cycle: number;
  checked: number;
  woken: number;
  agents: { role: string; reason: string }[];
}

/** Agents checked every heartbeat cycle (10 min) */
const HIGH_TIER: CompanyAgentRole[] = ['chief-of-staff', 'cto', 'ops'];

/** Agents checked every 2nd cycle (20 min) */
const MEDIUM_TIER: CompanyAgentRole[] = EXECUTIVE_ROLES.filter(
  r => !HIGH_TIER.includes(r),
);

/** Agents checked every 3rd cycle (30 min) */
const LOW_TIER: CompanyAgentRole[] = SUB_TEAM_ROLES as CompanyAgentRole[];

/** Minimum minutes since last run before a heartbeat can wake an agent */
const MIN_RUN_GAP_MS = 5 * 60 * 1000;

export class HeartbeatManager {
  private supabase: SupabaseClient;
  private executor: AgentExecutorFn;
  private wakeRouter: WakeRouter;
  private cycle = 0;

  constructor(
    supabase: SupabaseClient,
    executor: AgentExecutorFn,
    wakeRouter: WakeRouter,
  ) {
    this.supabase = supabase;
    this.executor = executor;
    this.wakeRouter = wakeRouter;
  }

  /**
   * Run a single heartbeat cycle. Called by POST /heartbeat.
   */
  async runHeartbeat(): Promise<HeartbeatResult> {
    this.cycle++;
    const agentsToCheck = this.getAgentsForCycle(this.cycle);

    // Batch fetch last run times for all agents being checked
    const lastRuns = await this.getLastRunTimes(agentsToCheck);

    // ── Phase 1: SCAN — check all agents for work (fast DB reads) ──
    const wakeList: WaveAgent[] = [];

    for (const agentRole of agentsToCheck) {
      // Skip if agent ran recently
      const lastRun = lastRuns.get(agentRole);
      if (lastRun && Date.now() - lastRun.getTime() < MIN_RUN_GAP_MS) continue;

      const needs = await this.checkAgentNeeds(agentRole);
      if (needs.shouldWake) {
        const dispatchTask = (needs.context.task as string) || 'heartbeat_response';

        // Look up assignment dependency info for wave ordering
        let assignmentId: string | undefined;
        let dependsOn: string[] | undefined;
        if (dispatchTask === 'work_loop' && needs.context.message) {
          const match = (needs.context.message as string).match(/assignment_id="([^"]+)"/);
          if (match) {
            assignmentId = match[1];
            const { data: assignment } = await this.supabase
              .from('work_assignments')
              .select('depends_on')
              .eq('id', assignmentId)
              .single();
            if (assignment?.depends_on?.length) {
              dependsOn = assignment.depends_on as string[];
            }
          }
        }

        wakeList.push({
          role: agentRole,
          task: dispatchTask,
          context: {
            wake_reason: needs.reason,
            priority: 'heartbeat',
            ...needs.context,
          },
          assignmentId,
          dependsOn,
        });
      }
    }

    if (wakeList.length === 0) {
      return { cycle: this.cycle, checked: agentsToCheck.length, woken: 0, agents: [] };
    }

    // ── Phase 2: RESOLVE — build dependency-ordered waves ──
    const waves = buildWaves(wakeList);

    console.log(
      `[Heartbeat] Cycle ${this.cycle}: checked ${agentsToCheck.length}, ` +
      `found ${wakeList.length} agents with work → ${waves.length} wave(s): ` +
      waves.map((w, i) => `W${i + 1}=[${w.map(a => a.role).join(', ')}]`).join(' → '),
    );

    // ── Phase 3: DISPATCH — parallel wave execution ──
    const dispatchResult = await dispatchWaves(waves, this.executor, this.supabase);

    const wokenAgents = dispatchResult.dispatched.map(role => {
      const agent = wakeList.find(a => a.role === role);
      return { role, reason: (agent?.context.wake_reason as string) ?? 'heartbeat' };
    });

    return {
      cycle: this.cycle,
      checked: agentsToCheck.length,
      woken: wokenAgents.length,
      agents: wokenAgents,
    };
  }

  /**
   * Check what an agent needs — pure DB queries, no model calls.
   * Uses the universal work loop for priority-ordered work detection.
   */
  private async checkAgentNeeds(agentRole: CompanyAgentRole): Promise<{
    shouldWake: boolean;
    reason: string;
    context: Record<string, unknown>;
  }> {
    // Check 1: Queued reactive wakes from WakeRouter (event-driven, highest precedence)
    const queuedWakes = await this.wakeRouter.drainQueue(agentRole);
    if (queuedWakes.length > 0) {
      return {
        shouldWake: true,
        reason: 'queued_wake',
        context: {
          queued_tasks: queuedWakes.map(w => ({ task: w.task, reason: w.reason })),
        },
      };
    }

    // Check 2: Universal work loop (P1-P5 priority stack)
    try {
      const workResult = await executeWorkLoop(agentRole, this.supabase);
      if (workResult.shouldRun) {
        return {
          shouldWake: true,
          reason: workResult.reason ?? 'work_loop',
          context: {
            task: workResult.task ?? 'work_loop',
            contextTier: workResult.contextTier ?? 'standard',
            priority: workResult.priority,
            message: workResult.message,
          },
        };
      }
    } catch (err) {
      console.warn(`[Heartbeat] Work loop check failed for ${agentRole}:`, (err as Error).message);
    }

    // Check 3: Knowledge inbox items (batch — wake if 5+ pending)
    try {
      const { count: inboxItems } = await this.supabase
        .from('knowledge_inbox')
        .select('*', { count: 'exact', head: true })
        .eq('target_agent', agentRole)
        .eq('status', 'pending');

      if (inboxItems && inboxItems >= 5) {
        return { shouldWake: true, reason: 'knowledge_inbox', context: { count: inboxItems } };
      }
    } catch {
      // knowledge_inbox table may not exist yet — skip silently
    }

    return { shouldWake: false, reason: '', context: {} };
  }

  /**
   * Determine which agents to check based on the current cycle.
   */
  private getAgentsForCycle(cycle: number): CompanyAgentRole[] {
    const agents: CompanyAgentRole[] = [...HIGH_TIER];
    if (cycle % 2 === 0) agents.push(...MEDIUM_TIER);
    if (cycle % 3 === 0) agents.push(...LOW_TIER);
    return agents;
  }

  /**
   * Batch-fetch last_run_at for a set of agents.
   */
  private async getLastRunTimes(agents: CompanyAgentRole[]): Promise<Map<CompanyAgentRole, Date | null>> {
    const result = new Map<CompanyAgentRole, Date | null>();
    try {
      const { data } = await this.supabase
        .from('company_agents')
        .select('role, last_run_at')
        .in('role', agents);

      for (const row of data ?? []) {
        result.set(
          row.role as CompanyAgentRole,
          row.last_run_at ? new Date(row.last_run_at) : null,
        );
      }
    } catch (err) {
      console.warn('[Heartbeat] Failed to fetch last run times:', (err as Error).message);
    }
    return result;
  }
}
