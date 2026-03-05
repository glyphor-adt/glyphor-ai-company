import type { Pool } from 'pg';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
  };
  handler: (pool: Pool, params: Record<string, unknown>) => Promise<unknown[]>;
}

function clampLimit(raw: unknown, defaultVal = 50, max = 200): number {
  const n = typeof raw === 'number' ? raw : Number(raw ?? defaultVal);
  return Math.min(Math.max(1, Math.floor(n)), max);
}

export const tools: ToolDefinition[] = [
  // ── Infrastructure Metrics ───────────────────────────────
  {
    name: 'query_infrastructure_metrics',
    description: 'Query platform infrastructure metrics — utilization, latency, requests, errors, and cache hit rates by provider and service.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Filter by provider (gcp, supabase, vercel).' },
        service: { type: 'string', description: 'Filter by service name.' },
        metric_type: { type: 'string', description: 'Filter by metric type (utilization, latency, requests, errors, cache_hit_rate).' },
        since: { type: 'string', description: 'Only return records after this ISO-8601 timestamp.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.provider) { values.push(params.provider); conditions.push(`provider = $${values.length}`); }
      if (params.service) { values.push(params.service); conditions.push(`service = $${values.length}`); }
      if (params.metric_type) { values.push(params.metric_type); conditions.push(`metric_type = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`recorded_at >= $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM infrastructure_metrics ${where} ORDER BY recorded_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Incidents ────────────────────────────────────────────
  {
    name: 'query_incidents',
    description: 'Query system incidents, filtered by severity, status, or affected agents.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: { type: 'string', description: 'Filter by severity (low, medium, high, critical).' },
        status: { type: 'string', description: 'Filter by status (open, resolved, investigating).' },
        since: { type: 'string', description: 'Only return incidents created after this ISO-8601 timestamp.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.severity) { values.push(params.severity); conditions.push(`severity = $${values.length}`); }
      if (params.status) { values.push(params.status); conditions.push(`status = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`created_at >= $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM incidents ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Agent Runs ───────────────────────────────────────────
  {
    name: 'query_agent_runs',
    description: 'Query agent execution runs — task status, duration, token usage, and errors.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Filter by agent ID / role.' },
        status: { type: 'string', description: 'Filter by run status (running, completed, failed).' },
        since: { type: 'string', description: 'Only return runs after this ISO-8601 timestamp.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.agent_id) { values.push(params.agent_id); conditions.push(`agent_id = $${values.length}`); }
      if (params.status) { values.push(params.status); conditions.push(`status = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`created_at >= $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM agent_runs ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Data Sync Status ─────────────────────────────────────
  {
    name: 'query_data_sync_status',
    description: 'Query the current data synchronization status and health for all integrations.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by sync status (ok, failing, stale).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.status) { values.push(params.status); conditions.push(`status = $${values.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM data_sync_status ${where} ORDER BY updated_at DESC`, values);
      return rows;
    },
  },

  // ── Analytics Events ─────────────────────────────────────
  {
    name: 'query_analytics_events',
    description: 'Query user acquisition and product engagement events (signups, activations, template usage, drop-offs).',
    inputSchema: {
      type: 'object',
      properties: {
        event_type: { type: 'string', description: 'Filter by event type (signup, profile_complete, first_build, activated, onboarding_drop_off, template_used).' },
        channel: { type: 'string', description: 'Filter by acquisition channel.' },
        since: { type: 'string', description: 'Only return events after this ISO-8601 timestamp.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.event_type) { values.push(params.event_type); conditions.push(`event_type = $${values.length}`); }
      if (params.channel) { values.push(params.channel); conditions.push(`channel = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`created_at >= $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM analytics_events ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },
];