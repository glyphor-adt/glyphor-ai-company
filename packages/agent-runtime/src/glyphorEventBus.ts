/**
 * Glyphor Event Bus — Persistent Inter-Agent Communication
 *
 * Persists events to Supabase (queryable history) and optionally
 * publishes to GCP Pub/Sub (durability + push delivery).
 *
 * Separate from the in-process EventBus which handles lifecycle events
 * (agent_started, tool_call, etc.) within a single run.
 */

import { systemQuery } from '@glyphor/shared/db';
import type {
  CompanyAgentRole,
  GlyphorEvent,
  GlyphorEventType,
  EventPriority,
} from './types.js';
import { getSubscribers } from './subscriptions.js';

export interface GlyphorEventBusConfig {
  pubsubPublisher?: {
    publish: (data: Buffer) => Promise<string>;
  };
}

export class GlyphorEventBus {
  private readonly publisher?: GlyphorEventBusConfig['pubsubPublisher'];

  constructor(config: GlyphorEventBusConfig) {
    this.publisher = config.pubsubPublisher;
  }

  /**
   * Emit a new event: persist to Supabase and optionally publish to Pub/Sub.
   */
  async emit(params: {
    type: GlyphorEventType;
    source: GlyphorEvent['source'];
    payload: Record<string, unknown>;
    priority?: EventPriority;
    correlationId?: string;
  }): Promise<GlyphorEvent> {
    const event: Omit<GlyphorEvent, 'id'> = {
      type: params.type,
      source: params.source,
      timestamp: new Date().toISOString(),
      payload: params.payload,
      priority: params.priority ?? 'normal',
      correlationId: params.correlationId,
    };

    // Persist to DB
    const [data] = await systemQuery<{ id: string }>(
      `INSERT INTO events (type, source, timestamp, payload, priority, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [event.type, event.source, event.timestamp, JSON.stringify(event.payload), event.priority, event.correlationId ?? null],
    );

    const fullEvent: GlyphorEvent = { ...event, id: data.id };

    // Publish to Pub/Sub for push delivery
    if (this.publisher) {
      try {
        await this.publisher.publish(Buffer.from(JSON.stringify(fullEvent)));
      } catch (pubsubError) {
        console.error('[GlyphorEventBus] Pub/Sub publish failed:', pubsubError);
        // Don't throw — event is already persisted
      }
    }

    console.log(
      `[GlyphorEventBus] Emitted ${event.type} from ${event.source} (${event.priority})`,
    );

    return fullEvent;
  }

  /**
   * Query recent events, optionally filtered by type.
   */
  async getRecentEvents(options?: {
    types?: GlyphorEventType[];
    since?: string;
    limit?: number;
  }): Promise<GlyphorEvent[]> {
    let query = 'SELECT * FROM events';
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (options?.types && options.types.length > 0) {
      conditions.push(`type = ANY($${paramIdx++})`);
      params.push(options.types);
    }

    if (options?.since) {
      conditions.push(`timestamp >= $${paramIdx++}`);
      params.push(options.since);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY timestamp DESC LIMIT $${paramIdx}`;
    params.push(options?.limit ?? 50);

    const data = await systemQuery<Record<string, unknown>>(query, params);

    return data.map((row) => ({
      id: row.id,
      type: row.type as GlyphorEventType,
      source: row.source as GlyphorEvent['source'],
      timestamp: row.timestamp,
      payload: row.payload ?? {},
      priority: row.priority as EventPriority,
      correlationId: row.correlation_id ?? undefined,
    }));
  }

  /**
   * Determine which agents should be woken for an event.
   * Critical/high priority always wake. Normal priority only if agent
   * hasn't run in the last hour.
   */
  async getAgentsToWake(
    event: GlyphorEvent,
    agentLastRuns: Map<CompanyAgentRole, Date | null>,
  ): Promise<CompanyAgentRole[]> {
    const subscribers = getSubscribers(event.type);

    // Don't wake the agent that emitted the event
    const candidates = subscribers.filter(
      (role) => role !== event.source,
    );

    if (event.priority === 'critical' || event.priority === 'high') {
      return candidates;
    }

    // Normal/low priority — only wake if agent hasn't run recently
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    return candidates.filter((role) => {
      const lastRun = agentLastRuns.get(role);
      return !lastRun || lastRun < oneHourAgo;
    });
  }

  /**
   * Mark an event as processed by a specific agent.
   */
  async markProcessed(eventId: string, agentRole: CompanyAgentRole): Promise<void> {
    try {
      await systemQuery(
        'SELECT * FROM array_append_unique($1, $2, $3, $4)',
        ['events', eventId, 'processed_by', agentRole],
      );
    } catch {
      // Fallback if RPC doesn't exist
      const [data] = await systemQuery<{ processed_by: string[] }>(
        'SELECT processed_by FROM events WHERE id = $1 LIMIT 1',
        [eventId],
      );

      const current = data?.processed_by ?? [];
      if (!current.includes(agentRole)) {
        await systemQuery(
          'UPDATE events SET processed_by = $1 WHERE id = $2',
          [JSON.stringify([...current, agentRole]), eventId],
        );
      }
    }
  }
}
