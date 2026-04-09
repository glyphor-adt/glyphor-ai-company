/**
 * Event Router — Maps incoming events to agent actions
 *
 * Receives events from Pub/Sub (scheduled jobs, webhooks, inter-agent messages)
 * and dispatches them to the appropriate agent runner with authority checks.
 */

import type {
  CompanyAgentRole,
  AgentExecutionResult,
  GlyphorEvent,
} from '@glyphor/agent-runtime';
import { GlyphorEventBus, getSubscribers } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { checkAuthority } from './authorityGates.js';
import { DecisionQueue } from './decisionQueue.js';

export interface IncomingEvent {
  source: 'scheduler' | 'webhook' | 'agent' | 'manual' | 'event';
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
  status?: string;
  error?: string;
  /** Structured action receipts from the agent run (tool calls + results). */
  actions?: Array<{ tool: string; params: Record<string, unknown>; result: 'success' | 'error'; output: string; timestamp: string }>;
  /** Dashboard chat only — iframe preview URLs from web pipeline tools. */
  dashboardChatEmbeds?: Array<{ kind: 'iframe_preview'; url: string; label?: string }>;
  /** Populated when worker executes an agent run (scheduler maps these to agent_runs). */
  totalTurns?: number;
  totalFilesWritten?: number;
  totalMemoryKeysWritten?: number;
  elapsedMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  cachedInputTokens?: number;
  cost?: number;
}

export interface CascadePreview {
  summary: string;
  simulationId?: string;
  recommendation?: string;
}

export type CascadePreviewBuilder = (input: {
  agentRole: CompanyAgentRole;
  task: string;
  tier: 'yellow' | 'red';
  action: string;
  payload: Record<string, unknown>;
}) => Promise<CascadePreview | null>;

export type AgentExecutor = (
  agentRole: CompanyAgentRole,
  task: string,
  payload: Record<string, unknown>,
) => Promise<AgentExecutionResult | void>;

export class EventRouter {
  private readonly executor: AgentExecutor;
  private readonly decisionQueue: DecisionQueue;
  private glyphorEventBus?: GlyphorEventBus;
  private cascadePreviewBuilder?: CascadePreviewBuilder;

  constructor(executor: AgentExecutor, decisionQueue: DecisionQueue) {
    this.executor = executor;
    this.decisionQueue = decisionQueue;
  }

  setGlyphorEventBus(bus: GlyphorEventBus): void {
    this.glyphorEventBus = bus;
  }

  setCascadePreviewBuilder(builder: CascadePreviewBuilder): void {
    this.cascadePreviewBuilder = builder;
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

    // Block scheduler and external wake paths for inactive/retired/deleted agents.
    // Agent-to-agent events are left unchanged to avoid interrupting internal handoffs.
    if (event.source !== 'agent') {
      const [agent] = await systemQuery<{ status: string }>(
        'SELECT status FROM company_agents WHERE role = $1 LIMIT 1',
        [event.agentRole],
      );
      if (!agent) {
        return {
          routed: false,
          action: 'rejected',
          agentRole: event.agentRole,
          task: event.task,
          reason: `Agent role not found: ${event.agentRole}`,
        };
      }
      if (agent.status !== 'active') {
        return {
          routed: false,
          action: 'rejected',
          agentRole: event.agentRole,
          task: event.task,
          reason: `Agent ${event.agentRole} is ${agent.status}`,
        };
      }
    }

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
          status: result?.status,
          error: result?.error ?? result?.abortReason,
          actions: result?.actions,
          dashboardChatEmbeds: result?.dashboardChatEmbeds,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[EventRouter] Execution failed: ${message}`);
        return {
          routed: false,
          action: 'rejected',
          agentRole: event.agentRole,
          task: event.task,
          error: message,
          reason: `Execution error: ${message}`,
        };
      }
    }

    if (auth.requiresApproval) {
      // Yellow or Red — queue for approval
      // Build human-readable title & summary instead of raw slugs / JSON
      const prettyTask = event.task.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const prettyRole = event.agentRole.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const title = `${prettyRole}: ${prettyTask}`;

      // Extract the human-readable message from the payload if present
      let summary: string;
      const rawMsg = event.payload?.message as string | undefined;
      if (rawMsg) {
        // Strip the "Founder: " prefix and "Respond directly..." boilerplate
        summary = rawMsg
          .replace(/^Founder:\s*/i, '')
          .replace(/\n\n?Respond directly to the founder\..*$/s, '')
          .trim();
      } else {
        summary = auth.reason ?? `${prettyRole} wants to perform: ${prettyTask}`;
      }

      let decisionReasoning = auth.reason ?? '';
      let decisionData: Record<string, unknown> | undefined = event.payload?.directiveAssignmentId
        ? { directiveAssignmentId: event.payload.directiveAssignmentId }
        : undefined;

      if (this.cascadePreviewBuilder) {
        try {
          const approvalTier = auth.tier === 'red' ? 'red' : 'yellow';
          const preview = await this.cascadePreviewBuilder({
            agentRole: event.agentRole,
            task: event.task,
            tier: approvalTier,
            action: summary,
            payload: event.payload,
          });
          if (preview?.summary) {
            summary = `${summary}\n\nCascade preview: ${preview.summary}`;
            decisionReasoning = [
              auth.reason,
              preview.recommendation ? `Cascade recommendation: ${preview.recommendation.replace(/_/g, ' ')}.` : null,
              preview.simulationId ? `Cascade simulation: ${preview.simulationId}.` : null,
            ].filter(Boolean).join(' ');
            decisionData = {
              ...(decisionData ?? {}),
              cascadePreview: preview.summary,
              cascadeSimulationId: preview.simulationId,
              cascadeRecommendation: preview.recommendation,
            };
          }
        } catch (err) {
          console.warn('[EventRouter] Failed to build cascade preview:', (err as Error).message);
        }
      }

      await this.decisionQueue.submit({
        id: `${event.agentRole}-${event.task}-${Date.now()}`,
        proposedBy: event.agentRole,
        title,
        summary,
        tier: auth.tier,
        status: 'pending',
        assignedTo: auth.assignTo ?? [],
        reasoning: decisionReasoning,
        data: decisionData,
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

  /**
   * Handle a GlyphorEvent from the persistent event bus.
   * Looks up subscribers, determines which agents to wake,
   * and routes to each one.
   */
  async handleGlyphorEvent(
    event: GlyphorEvent,
    agentLastRuns: Map<CompanyAgentRole, Date | null>,
  ): Promise<RouteResult[]> {
    const results: RouteResult[] = [];

    const agentsToWake = this.glyphorEventBus
      ? await this.glyphorEventBus.getAgentsToWake(event, agentLastRuns)
      : getSubscribers(event.type).filter((r) => r !== event.source);

    console.log(
      `[EventRouter] GlyphorEvent ${event.type} from ${event.source} → waking [${agentsToWake.join(', ')}]`,
    );

    for (const agentRole of agentsToWake) {
      const task = `event_${event.type.replace('.', '_')}`;
      const result = await this.route({
        source: 'event',
        agentRole,
        task,
        payload: {
          ...event.payload,
          eventType: event.type,
          eventSource: event.source,
          eventPriority: event.priority,
          correlationId: event.correlationId,
        },
        correlationId: event.correlationId,
        timestamp: event.timestamp,
      });
      results.push(result);

      // Mark event as processed by this agent
      if (this.glyphorEventBus) {
        await this.glyphorEventBus.markProcessed(event.id, agentRole);
      }
    }

    return results;
  }
}
