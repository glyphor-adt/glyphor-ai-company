/**
 * Glyphor Event Bus — Persistent Inter-Agent Communication
 *
 * Persists events to Supabase (queryable history) and optionally
 * publishes to GCP Pub/Sub (durability + push delivery).
 *
 * Separate from the in-process EventBus which handles lifecycle events
 * (agent_started, tool_call, etc.) within a single run.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CompanyAgentRole,
  GlyphorEvent,
  GlyphorEventType,
  EventPriority,
} from './types.js';
import { getSubscribers } from './subscriptions.js';

export interface GlyphorEventBusConfig {
  supabase: SupabaseClient;
  pubsubPublisher?: {
    publish: (data: Buffer) => Promise<string>;
  };
}

export class GlyphorEventBus {
  private readonly supabase: SupabaseClient;
  private readonly publisher?: GlyphorEventBusConfig['pubsubPublisher'];

  constructor(config: GlyphorEventBusConfig) {
    this.supabase = config.supabase;
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

    // Persist to Supabase
    const { data, error } = await this.supabase
      .from('events')
      .insert({
        type: event.type,
        source: event.source,
        timestamp: event.timestamp,
        payload: event.payload,
        priority: event.priority,
        correlation_id: event.correlationId ?? null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[GlyphorEventBus] Failed to persist event:', error.message);
      throw new Error(`Event persistence failed: ${error.message}`);
    }

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
    let query = this.supabase
      .from('events')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(options?.limit ?? 50);

    if (options?.types && options.types.length > 0) {
      query = query.in('type', options.types);
    }

    if (options?.since) {
      query = query.gte('timestamp', options.since);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Event query failed: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
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
    await this.supabase.rpc('array_append_unique', {
      table_name: 'events',
      row_id: eventId,
      column_name: 'processed_by',
      new_value: agentRole,
    }).then(({ error }) => {
      // Fallback if RPC doesn't exist
      if (error) {
        return this.supabase
          .from('events')
          .select('processed_by')
          .eq('id', eventId)
          .single()
          .then(({ data }) => {
            const current = (data?.processed_by as string[]) ?? [];
            if (!current.includes(agentRole)) {
              return this.supabase
                .from('events')
                .update({ processed_by: [...current, agentRole] })
                .eq('id', eventId);
            }
          });
      }
    });
  }
}
