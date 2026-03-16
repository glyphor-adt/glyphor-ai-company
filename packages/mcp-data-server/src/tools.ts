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
  // ── Content ──────────────────────────────────────────────
  {
    name: 'query_content_drafts',
    description: 'Query content drafts, optionally filtered by status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by draft status (e.g. draft, published, review).' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.status) { values.push(params.status); conditions.push(`status = $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM content_drafts ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },
  {
    name: 'query_content_metrics',
    description: 'Query content performance metrics, optionally filtered by content_id.',
    inputSchema: {
      type: 'object',
      properties: {
        content_id: { type: 'string', description: 'Filter by specific content ID.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.content_id) { values.push(params.content_id); conditions.push(`content_id = $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM content_metrics ${where} ORDER BY recorded_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── SEO ──────────────────────────────────────────────────
  {
    name: 'query_seo_data',
    description: 'Query SEO data, optionally filtered by URL.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Filter by page URL (exact match).' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.url) { values.push(params.url); conditions.push(`url = $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM seo_data ${where} ORDER BY recorded_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Finance ──────────────────────────────────────────────
  {
    name: 'query_financials',
    description: 'Query financial metrics, optionally filtered by metric type.',
    inputSchema: {
      type: 'object',
      properties: {
        metric_type: { type: 'string', description: 'Filter by metric type (e.g. revenue, expense, profit).' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.metric_type) { values.push(params.metric_type); conditions.push(`metric_type = $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM financials ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },
  {
    name: 'query_company_vitals',
    description: 'Query the latest company vitals snapshot.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async handler(pool) {
      const { rows } = await pool.query(`SELECT * FROM company_vitals ORDER BY updated_at DESC LIMIT 1`);
      return rows;
    },
  },

  // ── Analytics ────────────────────────────────────────────
  {
    name: 'query_analytics_events',
    description: 'Query analytics events, optionally filtered by event type and date.',
    inputSchema: {
      type: 'object',
      properties: {
        event_type: { type: 'string', description: 'Filter by event type.' },
        since: { type: 'string', description: 'Only return events after this ISO-8601 timestamp.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.event_type) { values.push(params.event_type); conditions.push(`event_type = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`created_at >= $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM analytics_events ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Support ──────────────────────────────────────────────
  {
    name: 'query_support_tickets',
    description: 'Query support tickets, optionally filtered by status and priority.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by ticket status (e.g. open, closed, pending).' },
        priority: { type: 'string', description: 'Filter by priority (e.g. low, medium, high, critical).' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.status) { values.push(params.status); conditions.push(`status = $${values.length}`); }
      if (params.priority) { values.push(params.priority); conditions.push(`priority = $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM support_tickets ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Research ─────────────────────────────────────────────
  {
    name: 'query_company_research',
    description: 'Query company research entries, optionally filtered by topic.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Filter by research topic (substring match).' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.topic) { values.push(`%${params.topic}%`); conditions.push(`topic ILIKE $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM company_research ${where} ORDER BY updated_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Agents ───────────────────────────────────────────────
  {
    name: 'query_agent_runs',
    description: 'Query agent execution runs, optionally filtered by agent role and date.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_role: { type: 'string', description: 'Filter by agent role.' },
        since: { type: 'string', description: 'Only return runs after this ISO-8601 timestamp.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.agent_role) { values.push(params.agent_role); conditions.push(`agent_role = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`created_at >= $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM agent_runs ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },
  {
    name: 'query_agent_activities',
    description: 'Query agent activity log entries, optionally filtered by agent role and activity type.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_role: { type: 'string', description: 'Filter by agent role.' },
        activity_type: { type: 'string', description: 'Filter by activity type.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.agent_role) { values.push(params.agent_role); conditions.push(`agent_role = $${values.length}`); }
      if (params.activity_type) { values.push(params.activity_type); conditions.push(`activity_type = $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Operations ───────────────────────────────────────────
  {
    name: 'query_incidents',
    description: 'Query incidents, optionally filtered by severity and status.',
    inputSchema: {
      type: 'object',
      properties: {
        severity: { type: 'string', description: 'Filter by severity (e.g. low, medium, high, critical).' },
        status: { type: 'string', description: 'Filter by incident status (e.g. open, resolved, investigating).' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.severity) { values.push(params.severity); conditions.push(`severity = $${values.length}`); }
      if (params.status) { values.push(params.status); conditions.push(`status = $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM incidents ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },
  {
    name: 'query_data_sync_status',
    description: 'Query the current data synchronization status for all integrations.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async handler(pool) {
      const { rows } = await pool.query(`SELECT * FROM data_sync_status ORDER BY updated_at DESC`);
      return rows;
    },
  },
];
