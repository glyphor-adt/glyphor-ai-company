/**
 * Event Router — Maps incoming events to agent actions
 *
 * Receives events from Pub/Sub (scheduled jobs, webhooks, inter-agent messages)
 * and dispatches them to the appropriate agent runner with authority checks.
 */

import type { CompanyAgentRole, AgentExecutionResult } from '@glyphor/agent-runtime';
import { checkAuthority } from './authorityGates.js';
import { DecisionQueue } from './decisionQueue.js';

export interface IncomingEvent {
  source: 'scheduler' | 'webhook' | 'agent' | 'manual';
  agentRole: CompanyAgentRole;
  task: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  timestamp?: string;
}

export interface RouteResult {
  routed: boolean;
  action: 'executed' | 'queued_for_approval' | 'rejected';
  agentRole: CompanyAgentRole;
  task: string;
  reason?: string;
  output?: string | null;
}

export type AgentExecutor = (
  agentRole: CompanyAgentRole,
  task: string,
  payload: Record<string, unknown>,
) => Promise<AgentExecutionResult | void>;

export class EventRouter {
  private readonly executor: AgentExecutor;
  private readonly decisionQueue: DecisionQueue;

  constructor(executor: AgentExecutor, decisionQueue: DecisionQueue) {
    this.executor = executor;
    this.decisionQueue = decisionQueue;
  }

  /**
   * Route an incoming event to the appropriate agent.
   * Checks authority gates before execution.
   */
  async route(event: IncomingEvent): Promise<RouteResult> {
    const ts = event.timestamp ?? new Date().toISOString();
    console.log(
      `[EventRouter] ${ts} Routing ${event.source}/${event.agentRole}/${event.task}`,
    );

    // Check authority for this action
    const auth = checkAuthority(event.agentRole, event.task);

    if (auth.allowed) {
      // Green tier — execute directly
      try {
        const result = await this.executor(event.agentRole, event.task, event.payload);
        return {
          routed: true,
          action: 'executed',
          agentRole: event.agentRole,
          task: event.task,
          output: result?.output ?? null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[EventRouter] Execution failed: ${message}`);
        return {
          routed: false,
          action: 'rejected',
          agentRole: event.agentRole,
          task: event.task,
          reason: `Execution error: ${message}`,
        };
      }
    }

    if (auth.requiresApproval) {
      // Yellow or Red — queue for approval
      await this.decisionQueue.submit({
        id: `${event.agentRole}-${event.task}-${Date.now()}`,
        proposedBy: event.agentRole,
        title: `${event.agentRole}: ${event.task}`,
        summary: JSON.stringify(event.payload),
        tier: auth.tier,
        status: 'pending',
        assignedTo: auth.assignTo ?? [],
        reasoning: auth.reason ?? '',
        createdAt: new Date().toISOString(),
      });

      return {
        routed: true,
        action: 'queued_for_approval',
        agentRole: event.agentRole,
        task: event.task,
        reason: auth.reason,
      };
    }

    return {
      routed: false,
      action: 'rejected',
      agentRole: event.agentRole,
      task: event.task,
      reason: auth.reason ?? 'Authority check failed',
    };
  }

  /**
   * Handle a Cloud Scheduler Pub/Sub message.
   */
  async handleSchedulerMessage(
    messageData: string,
  ): Promise<RouteResult> {
    const parsed = JSON.parse(messageData) as {
      agentRole: CompanyAgentRole;
      task: string;
      payload: Record<string, unknown>;
    };

    return this.route({
      source: 'scheduler',
      agentRole: parsed.agentRole,
      task: parsed.task,
      payload: parsed.payload ?? {},
    });
  }

  /**
   * Handle an inter-agent event (one agent triggering another).
   */
  async handleAgentEvent(
    fromAgent: CompanyAgentRole,
    toAgent: CompanyAgentRole,
    task: string,
    payload: Record<string, unknown>,
  ): Promise<RouteResult> {
    return this.route({
      source: 'agent',
      agentRole: toAgent,
      task,
      payload: { ...payload, triggeredBy: fromAgent },
    });
  }
}
