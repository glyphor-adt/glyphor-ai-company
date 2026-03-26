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
  // ── Stripe / Revenue ─────────────────────────────────────
  {
    name: 'query_stripe_data',
    description: 'Query Stripe revenue data including subscriptions, charges, refunds, MRR snapshots, and cohort analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        record_type: { type: 'string', description: 'Filter by record type (subscription, charge, refund, mrr_snapshot, cohort, attribution).' },
        product: { type: 'string', description: 'Filter by product name.' },
        status: { type: 'string', description: 'Filter by status.' },
        since: { type: 'string', description: 'Only return records after this ISO-8601 timestamp.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.record_type) { values.push(params.record_type); conditions.push(`record_type = $${values.length}`); }
      if (params.product) { values.push(params.product); conditions.push(`product = $${values.length}`); }
      if (params.status) { values.push(params.status); conditions.push(`status = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`recorded_at >= $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM stripe_data ${where} ORDER BY recorded_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── GCP Billing ──────────────────────────────────────────
  {
    name: 'query_gcp_billing',
    description: 'Query GCP billing data by service (cloud-run, cloud-storage, gemini, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Filter by GCP service name.' },
        since: { type: 'string', description: 'Only return records after this ISO-8601 timestamp.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.service) { values.push(params.service); conditions.push(`service = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`recorded_at >= $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM gcp_billing ${where} ORDER BY recorded_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Cost Metrics ─────────────────────────────────────────
  {
    name: 'query_cost_metrics',
    description: 'Query cost-per-unit metrics (per_build, per_api_call, per_user, per_agent_run).',
    inputSchema: {
      type: 'object',
      properties: {
        unit_type: { type: 'string', description: 'Filter by unit type (per_build, per_api_call, per_user, per_agent_run).' },
        period: { type: 'string', description: 'Filter by period.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.unit_type) { values.push(params.unit_type); conditions.push(`unit_type = $${values.length}`); }
      if (params.period) { values.push(params.period); conditions.push(`period = $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM cost_metrics ${where} ORDER BY recorded_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── API Billing ──────────────────────────────────────────
  {
    name: 'query_api_billing',
    description: 'Query external API costs (OpenAI, Anthropic, Kling, etc.) by provider and service.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Filter by API provider (openai, anthropic, kling).' },
        service: { type: 'string', description: 'Filter by model/service name (gpt-4o, claude-sonnet-4-20250514, etc.).' },
        product: { type: 'string', description: 'Filter by product (pulse, web-build, glyphor-ai-company).' },
        since: { type: 'string', description: 'Only return records after this ISO-8601 timestamp.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.provider) { values.push(params.provider); conditions.push(`provider = $${values.length}`); }
      if (params.service) { values.push(params.service); conditions.push(`service = $${values.length}`); }
      if (params.product) { values.push(params.product); conditions.push(`product = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`recorded_at >= $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM api_billing ${where} ORDER BY recorded_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Infrastructure Metrics ───────────────────────────────
  {
    name: 'query_infrastructure_costs',
    description: 'Query infrastructure utilization and cost metrics by provider and service.',
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

  // ── Financials ───────────────────────────────────────────
  {
    name: 'query_financials',
    description: 'Query financial metrics by product and metric type.',
    inputSchema: {
      type: 'object',
      properties: {
        product: { type: 'string', description: 'Filter by product name.' },
        metric: { type: 'string', description: 'Filter by metric name (e.g. revenue, expense, profit).' },
        since: { type: 'string', description: 'Only return records after this date (YYYY-MM-DD).' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.product) { values.push(params.product); conditions.push(`product = $${values.length}`); }
      if (params.metric) { values.push(params.metric); conditions.push(`metric = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`date >= $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM financials ${where} ORDER BY date DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Company Vitals ────────────────────────────────────────
  {
    name: 'query_company_vitals',
    description: 'Get the current company vitals snapshot including MRR, active users, and mood.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async handler(pool) {
      const { rows } = await pool.query(`SELECT * FROM company_vitals ORDER BY updated_at DESC LIMIT 1`);
      return rows;
    },
  },
];