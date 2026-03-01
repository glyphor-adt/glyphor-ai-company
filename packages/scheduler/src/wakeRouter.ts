/**
 * Wake Router — Event-driven agent wake dispatcher
 *
 * Matches incoming events against WAKE_RULES and either:
 * 1. Wakes agents immediately (POST /run equivalent)
 * 2. Queues wakes for the next heartbeat cycle
 *
 * Includes cooldown tracking to prevent duplicate wakes.
 */

import { systemQuery } from '@glyphor/shared/db';
import type { CompanyAgentRole, AgentExecutionResult } from '@glyphor/agent-runtime';
import { WAKE_RULES } from './wakeRules.js';
import type { WakeRule } from './wakeRules.js';

export interface WakeEvent {
  type: string;
  data: Record<string, unknown>;
  source: string;
}

export interface WakeResult {
  matched: number;
  woken: string[];
  queued: string[];
  skipped: string[];
}

type AgentExecutorFn = (
  agentRole: CompanyAgentRole,
  task: string,
  payload: Record<string, unknown>,
) => Promise<AgentExecutionResult | void>;

export class WakeRouter {
  private cooldowns = new Map<string, number>();
  private supabase: SupabaseClient;
  private executor: AgentExecutorFn;

  constructor(supabase: SupabaseClient, executor: AgentExecutorFn) {
    this.supabase = supabase;
    this.executor = executor;
  }

  /**
   * Process an event and wake matching agents.
   */
  async processEvent(event: WakeEvent): Promise<WakeResult> {
    const result: WakeResult = { matched: 0, woken: [], queued: [], skipped: [] };

    const matchingRules = WAKE_RULES.filter(rule => {
      if (rule.event !== event.type) return false;
      if (rule.condition && !this.evaluateCondition(rule.condition, event.data)) return false;
      return true;
    });

    result.matched = matchingRules.length;

    for (const rule of matchingRules) {
      const agents = this.resolveAgents(rule.wake, event.data);

      for (const agentRole of agents) {
        // Check cooldown
        const cooldownKey = `${agentRole}:${rule.event}`;
        const lastWake = this.cooldowns.get(cooldownKey) ?? 0;
        const cooldownMs = (rule.cooldown_min ?? 0) * 60 * 1000;

        if (Date.now() - lastWake < cooldownMs) {
          result.skipped.push(agentRole);
          continue;
        }

        if (rule.priority === 'immediate') {
          try {
            await this.wakeAgent(agentRole as CompanyAgentRole, rule.task, {
              wake_reason: rule.event,
              event_data: event.data,
              event_source: event.source,
              priority: 'reactive',
            });
            result.woken.push(agentRole);
            this.cooldowns.set(cooldownKey, Date.now());
          } catch (err) {
            console.error(`[WakeRouter] Failed to wake ${agentRole}:`, (err as Error).message);
            result.skipped.push(agentRole);
          }
        } else {
          // Queue for next heartbeat pickup
          await this.queueWake(agentRole as CompanyAgentRole, rule.task, rule.event, event.data);
          result.queued.push(agentRole);
          this.cooldowns.set(cooldownKey, Date.now());
        }
      }
    }

    if (result.woken.length > 0 || result.queued.length > 0) {
      console.log(
        `[WakeRouter] Event "${event.type}" from ${event.source}: ` +
        `woken=[${result.woken.join(',')}] queued=[${result.queued.join(',')}] skipped=[${result.skipped.join(',')}]`
      );
    }

    return result;
  }

  /**
   * Wake an agent immediately by running their task.
   */
  private async wakeAgent(
    role: CompanyAgentRole,
    task: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    console.log(`[WakeRouter] Waking ${role} for task "${task}" (reason: ${context.wake_reason})`);
    await this.executor(role, task, context);
  }

  /**
   * Queue a wake for the next heartbeat cycle.
   */
  private async queueWake(
    agentRole: CompanyAgentRole,
    task: string,
    reason: string,
    eventData: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('agent_wake_queue')
      .insert({
        agent_role: agentRole,
        task,
        reason,
        context: eventData,
        status: 'pending',
      });

    if (error) {
      console.error(`[WakeRouter] Failed to queue wake for ${agentRole}:`, error.message);
    }
  }

  /**
   * Evaluate a simple condition string against event data.
   * Uses predefined condition names for safety (no eval).
   */
  private evaluateCondition(condition: string, data: Record<string, unknown>): boolean {
    switch (condition) {
      case 'is_founder':
        return data.is_founder === true;
      case 'priority_urgent':
        return data.priority === 'urgent';
      case 'severity_critical':
        return data.severity === 'critical';
      case 'severity_warning_cost':
        return data.severity === 'warning' && data.category === 'cost';
      default:
        return false;
    }
  }

  /**
   * Resolve dynamic agent tokens ($target_agent, $to_agent, etc.)
   * to actual CompanyAgentRole values.
   */
  private resolveAgents(wake: (CompanyAgentRole | string)[], data: Record<string, unknown>): string[] {
    return wake
      .flatMap(w => {
        if (w === '$target_agent') return data.target_agent as string ?? [];
        if (w === '$to_agent') return data.to_agent as string ?? [];
        if (w === '$proposed_by') return data.proposed_by as string ?? [];
        if (w === '$action_item_owners') {
          const owners = data.action_item_owners;
          return Array.isArray(owners) ? owners as string[] : [];
        }
        return w;
      })
      .filter(Boolean);
  }

  /**
   * Drain pending queued wakes (called by HeartbeatManager).
   * Marks dispatched entries so they aren't re-processed.
   */
  async drainQueue(agentRole: CompanyAgentRole): Promise<{
    task: string;
    reason: string;
    context: Record<string, unknown>;
  }[]> {
    const { data: pending, error } = await this.supabase
      .from('agent_wake_queue')
      .select('id, task, reason, context')
      .eq('agent_role', agentRole)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(10);

    if (error || !pending?.length) return [];

    // Mark as dispatched
    const ids = pending.map(p => p.id);
    await this.supabase
      .from('agent_wake_queue')
      .update({ status: 'dispatched', dispatched_at: new Date().toISOString() })
      .in('id', ids);

    return pending.map(p => ({
      task: p.task,
      reason: p.reason,
      context: (p.context ?? {}) as Record<string, unknown>,
    }));
  }
}
