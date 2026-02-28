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
import { EXECUTIVE_ROLES, SUB_TEAM_ROLES, getRedisCache, CACHE_KEYS, CACHE_TTL } from '@glyphor/agent-runtime';
import { executeWorkLoop } from '@glyphor/agent-runtime';
import type { WakeRouter } from './wakeRouter.js';
import { buildWaves, dispatchWaves } from './parallelDispatch.js';
import type { WaveAgent } from './parallelDispatch.js';
import { checkAgentInboxes } from './inboxCheck.js';
import { processNewChangeRequests, syncChangeRequestProgress } from './changeRequestHandler.js';

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

    // ── Phase 0: REAP — mark stale "running" rows as failed ──
    await this.reapStaleRuns();

    // ── Phase 0b: CHANGE REQUESTS — process founder requests → Copilot ──
    try {
      const newlyProcessed = await processNewChangeRequests(this.supabase);
      const synced = await syncChangeRequestProgress(this.supabase);
      if (newlyProcessed || synced) {
        console.log(`[Heartbeat] Change requests: ${newlyProcessed} new → Copilot, ${synced} progress updates`);
      }
    } catch (err) {
      console.warn(`[Heartbeat] Change request processing failed:`, (err as Error).message);
    }

    const allAgentsForCycle = this.getAgentsForCycle(this.cycle);

    // Filter out paused / inactive / retired agents before doing any work
    const agentsToCheck = await this.filterActiveAgents(allAgentsForCycle);

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

    // ── Phase 1b: INBOX — check M365 mailboxes for unread email ──
    // Runs every 2nd cycle (~20 min) to avoid excessive Graph API calls.
    if (this.cycle % 2 === 0) {
      // Pre-fetch recent aborts for abort cooldown checks
      const ABORT_COOLDOWN_MS = 30 * 60 * 1000;
      const recentAborts = new Map<string, Date>();
      try {
        const { data: aborts } = await this.supabase
          .from('agent_runs')
          .select('agent_id, completed_at')
          .eq('status', 'aborted')
          .gte('completed_at', new Date(Date.now() - ABORT_COOLDOWN_MS).toISOString())
          .order('completed_at', { ascending: false });
        for (const row of aborts ?? []) {
          if (!recentAborts.has(row.agent_id)) {
            recentAborts.set(row.agent_id, new Date(row.completed_at));
          }
        }
      } catch { /* table may not exist */ }

      try {
        const inbox = await checkAgentInboxes();
        for (const agent of inbox.withMail) {
          // Skip if this agent is already in the wake list
          if (wakeList.some(w => w.role === agent.role)) continue;
          // Skip if agent ran recently
          const lastRun = lastRuns.get(agent.role);
          if (lastRun && Date.now() - lastRun.getTime() < MIN_RUN_GAP_MS) continue;
          // Skip if agent was recently aborted (prevents inbox→abort→inbox loop)
          const lastAbort = recentAborts.get(agent.role);
          if (lastAbort && Date.now() - lastAbort.getTime() < ABORT_COOLDOWN_MS) {
            console.log(`[Heartbeat] Skipping inbox wake for ${agent.role}: abort cooldown (${Math.round((ABORT_COOLDOWN_MS - (Date.now() - lastAbort.getTime())) / 60_000)}min remaining)`);
            continue;
          }

          const subjectList = agent.subjects.slice(0, 3).join(', ');
          wakeList.push({
            role: agent.role,
            task: 'on_demand',
            context: {
              wake_reason: 'unread_email',
              priority: 'heartbeat',
              message: `You have ${agent.count} unread email(s) in your inbox. Subjects: ${subjectList}. Use read_inbox to review and respond as appropriate.`,
            },
          });
        }
        if (inbox.errors.length > 0) {
          console.warn(`[Heartbeat] Inbox check errors: ${inbox.errors.join('; ')}`);
        }
        if (inbox.withMail.length > 0) {
          console.log(`[Heartbeat] Inbox check: ${inbox.withMail.map(a => `${a.role}(${a.count})`).join(', ')}`);
        }
      } catch (err) {
        console.warn(`[Heartbeat] Inbox check failed:`, (err as Error).message);
      }
    }

    if (wakeList.length === 0) {
      return { cycle: this.cycle, checked: agentsToCheck.length, woken: 0, agents: [] };
    }

    // ── Phase 2: RESOLVE — build dependency-ordered waves ──
    const waves = buildWaves(wakeList);

    // Pre-cache wave context for agents about to be dispatched
    await this.preCacheWaveContext(wakeList);

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

    // Check 1.5 (CoS only): Detect new directives needing orchestration
    // Runs every heartbeat cycle (~10 min) so Sarah picks up directives in near real-time
    if (agentRole === 'chief-of-staff') {
      try {
        const { data: activeDirectives } = await this.supabase
          .from('founder_directives')
          .select('id, title, work_assignments(id)')
          .eq('status', 'active');

        const newDirectives = (activeDirectives ?? []).filter(
          (d: any) => !d.work_assignments || d.work_assignments.length === 0,
        );

        if (newDirectives.length > 0) {
          // Idempotency guard: skip if Sarah already ran orchestrate in the last 15 min
          const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
          const { data: recentRun } = await this.supabase
            .from('agent_runs')
            .select('id')
            .eq('agent_id', 'chief-of-staff')
            .like('run_id', 'cos-orchestrate-%')
            .gte('started_at', fifteenMinAgo)
            .limit(1);

          if (recentRun && recentRun.length > 0) {
            console.log('[Heartbeat] CoS: Skipping directive wake — orchestrate ran within 15 min');
          } else {
            console.log(
              `[Heartbeat] CoS: ${newDirectives.length} new directive(s) detected: ` +
              newDirectives.map((d: any) => `"${d.title}"`).join(', '),
            );
            return {
              shouldWake: true,
              reason: `new_directives:${newDirectives.length}`,
              context: {
                task: 'orchestrate',
                message: `${newDirectives.length} new directive(s) need orchestration: ${newDirectives.map((d: any) => `"${d.title}"`).join(', ')}. Run your orchestration protocol to break them into work assignments and dispatch to agents.`,
              },
            };
          }
        }
      } catch (err) {
        console.warn('[Heartbeat] CoS directive check failed:', (err as Error).message);
      }
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
   * Mark agent_runs stuck in "running" for >10 minutes as "failed".
   * Prevents stale rows from permanently blocking future dispatches.
   */
  private async reapStaleRuns(): Promise<void> {
    const STALE_THRESHOLD_MS = 10 * 60 * 1000;
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
    try {
      const { data } = await this.supabase
        .from('agent_runs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error: 'reaped: stuck in running state for >10 minutes',
        })
        .eq('status', 'running')
        .lt('created_at', cutoff)
        .select('id, agent_id');

      if (data && data.length > 0) {
        const agents = data.map((r: { agent_id: string }) => r.agent_id);
        console.log(`[Heartbeat] Reaped ${data.length} stale running rows: [${agents.join(', ')}]`);
      }
    } catch (err) {
      console.warn('[Heartbeat] Failed to reap stale runs:', (err as Error).message);
    }
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
   * Remove agents whose status is not 'active' so the heartbeat
   * respects pause / inactive / retired / under-review states.
   */
  private async filterActiveAgents(agents: CompanyAgentRole[]): Promise<CompanyAgentRole[]> {
    try {
      const { data } = await this.supabase
        .from('company_agents')
        .select('role, status')
        .in('role', agents)
        .eq('status', 'active');

      const activeRoles = new Set((data ?? []).map((r: { role: string }) => r.role));
      const skipped = agents.filter(a => !activeRoles.has(a));
      if (skipped.length > 0) {
        console.log(`[Heartbeat] Skipping non-active agents: [${skipped.join(', ')}]`);
      }
      return agents.filter(a => activeRoles.has(a));
    } catch (err) {
      console.warn('[Heartbeat] Failed to filter active agents, proceeding with all:', (err as Error).message);
      return agents;
    }
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

  /**
   * Pre-cache frequently-needed context for agents about to be dispatched.
   * Warms Redis with wave metadata so agent runs hit cache instead of DB.
   */
  private async preCacheWaveContext(wakeList: WaveAgent[]): Promise<void> {
    const cache = getRedisCache();
    try {
      // Cache the wave metadata (which agents are running and why)
      await cache.set(
        CACHE_KEYS.wave(this.cycle),
        {
          cycle: this.cycle,
          agents: wakeList.map(w => ({ role: w.role, task: w.task, reason: w.context.wake_reason })),
          cachedAt: Date.now(),
        },
        CACHE_TTL.wave,
      );
    } catch (err) {
      console.warn('[Heartbeat] Pre-cache wave context failed:', (err as Error).message);
    }
  }
}
