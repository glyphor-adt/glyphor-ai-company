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
import type { WakeRouter } from './wakeRouter.js';

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

/** Stagger delay between agent wakes to avoid thundering herd (ms) */
const WAKE_STAGGER_MS = 2_000;

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
    const wakeList: { role: CompanyAgentRole; reason: string; context: Record<string, unknown> }[] = [];

    // Batch fetch last run times for all agents being checked
    const lastRuns = await this.getLastRunTimes(agentsToCheck);

    for (const agentRole of agentsToCheck) {
      // Skip if agent ran recently
      const lastRun = lastRuns.get(agentRole);
      if (lastRun && Date.now() - lastRun.getTime() < MIN_RUN_GAP_MS) continue;

      const needs = await this.checkAgentNeeds(agentRole);
      if (needs.shouldWake) {
        wakeList.push({ role: agentRole, reason: needs.reason, context: needs.context });
      }
    }

    // Wake agents with staggering
    const wokenAgents: { role: string; reason: string }[] = [];
    for (let i = 0; i < wakeList.length; i++) {
      const { role, reason, context } = wakeList[i];

      if (i > 0) {
        await this.sleep(WAKE_STAGGER_MS);
      }

      try {
        console.log(`[Heartbeat] Waking ${role} — reason: ${reason}`);
        await this.executor(role, 'heartbeat_response', {
          wake_reason: reason,
          priority: 'heartbeat',
          ...context,
        });
        wokenAgents.push({ role, reason });
      } catch (err) {
        console.error(`[Heartbeat] Failed to wake ${role}:`, (err as Error).message);
      }
    }

    const result: HeartbeatResult = {
      cycle: this.cycle,
      checked: agentsToCheck.length,
      woken: wokenAgents.length,
      agents: wokenAgents,
    };

    if (wokenAgents.length > 0) {
      console.log(
        `[Heartbeat] Cycle ${this.cycle}: checked ${agentsToCheck.length}, ` +
        `woke ${wokenAgents.length} agents: [${wokenAgents.map(a => a.role).join(', ')}]`,
      );
    }

    return result;
  }

  /**
   * Check what an agent needs — pure DB queries, no model calls.
   */
  private async checkAgentNeeds(agentRole: CompanyAgentRole): Promise<{
    shouldWake: boolean;
    reason: string;
    context: Record<string, unknown>;
  }> {
    // Check 1: Unread urgent messages
    const { count: urgentMsgs } = await this.supabase
      .from('agent_messages')
      .select('*', { count: 'exact', head: true })
      .eq('to_agent', agentRole)
      .eq('status', 'pending')
      .eq('priority', 'urgent');

    if (urgentMsgs && urgentMsgs > 0) {
      return { shouldWake: true, reason: 'urgent_messages', context: { count: urgentMsgs } };
    }

    // Check 2: Batch pending messages (wake if 3+ normal messages waiting)
    const { count: normalMsgs } = await this.supabase
      .from('agent_messages')
      .select('*', { count: 'exact', head: true })
      .eq('to_agent', agentRole)
      .eq('status', 'pending');

    if (normalMsgs && normalMsgs >= 3) {
      return { shouldWake: true, reason: 'pending_messages', context: { count: normalMsgs } };
    }

    // Check 3: Queued reactive wakes from WakeRouter
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

    // Check 4: Knowledge inbox items (batch — wake if 5+ pending)
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
