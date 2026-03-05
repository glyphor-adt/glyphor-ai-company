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
  // ── Content Drafts ───────────────────────────────────────
  {
    name: 'query_content_drafts',
    description: 'Query content drafts filtered by type, status, platform, or author.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by content type (blog_post, social_post, case_study, email).' },
        status: { type: 'string', description: 'Filter by draft status (draft, approved, published, rejected).' },
        platform: { type: 'string', description: 'Filter by platform (twitter, linkedin, threads).' },
        author: { type: 'string', description: 'Filter by author agent role.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.type) { values.push(params.type); conditions.push(`type = $${values.length}`); }
      if (params.status) { values.push(params.status); conditions.push(`status = $${values.length}`); }
      if (params.platform) { values.push(params.platform); conditions.push(`platform = $${values.length}`); }
      if (params.author) { values.push(params.author); conditions.push(`author = $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM content_drafts ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Content Metrics ──────────────────────────────────────
  {
    name: 'query_content_metrics',
    description: 'Query content performance metrics (views, shares, engagement, conversions) by type and platform.',
    inputSchema: {
      type: 'object',
      properties: {
        content_type: { type: 'string', description: 'Filter by content type (blog, social, email).' },
        platform: { type: 'string', description: 'Filter by platform.' },
        since: { type: 'string', description: 'Only return records after this ISO-8601 timestamp.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.content_type) { values.push(params.content_type); conditions.push(`content_type = $${values.length}`); }
      if (params.platform) { values.push(params.platform); conditions.push(`platform = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`recorded_at >= $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM content_metrics ${where} ORDER BY recorded_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── SEO Data ─────────────────────────────────────────────
  {
    name: 'query_seo_data',
    description: 'Query SEO data including rankings, keyword research, backlinks, and search console metrics.',
    inputSchema: {
      type: 'object',
      properties: {
        metric_type: { type: 'string', description: 'Filter by metric type (ranking, keyword_research, keyword_discovery, competitor_ranking, backlinks, search_console, content_audit).' },
        keyword: { type: 'string', description: 'Filter by keyword (substring match).' },
        url: { type: 'string', description: 'Filter by page URL (exact match).' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.metric_type) { values.push(params.metric_type); conditions.push(`metric_type = $${values.length}`); }
      if (params.keyword) { values.push(`%${params.keyword}%`); conditions.push(`keyword ILIKE $${values.length}`); }
      if (params.url) { values.push(params.url); conditions.push(`url = $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM seo_data ${where} ORDER BY recorded_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Scheduled Posts ──────────────────────────────────────
  {
    name: 'query_scheduled_posts',
    description: 'Query social media posts scheduled for publication, filtered by platform or status.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Filter by platform (twitter, linkedin, threads).' },
        status: { type: 'string', description: 'Filter by status (queued, published, failed, cancelled).' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.platform) { values.push(params.platform); conditions.push(`platform = $${values.length}`); }
      if (params.status) { values.push(params.status); conditions.push(`status = $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM scheduled_posts ${where} ORDER BY scheduled_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Social Metrics ───────────────────────────────────────
  {
    name: 'query_social_metrics',
    description: 'Query social media metrics — aggregate stats, post performance, optimal times, demographics, and mentions.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Filter by platform (twitter, linkedin, threads).' },
        metric_type: { type: 'string', description: 'Filter by metric type (aggregate, post_performance, optimal_times, demographics, mention).' },
        since: { type: 'string', description: 'Only return records after this ISO-8601 timestamp.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.platform) { values.push(params.platform); conditions.push(`platform = $${values.length}`); }
      if (params.metric_type) { values.push(params.metric_type); conditions.push(`metric_type = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`recorded_at >= $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM social_metrics ${where} ORDER BY recorded_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Email Metrics ────────────────────────────────────────
  {
    name: 'query_email_metrics',
    description: 'Query email campaign performance metrics (sends, opens, clicks, unsubscribes, bounce rates).',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_type: { type: 'string', description: 'Filter by campaign type (onboarding, feature_launch, re_engagement, newsletter).' },
        since: { type: 'string', description: 'Only return records after this ISO-8601 timestamp.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.campaign_type) { values.push(params.campaign_type); conditions.push(`campaign_type = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`recorded_at >= $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM email_metrics ${where} ORDER BY recorded_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Experiment Designs ───────────────────────────────────
  {
    name: 'query_experiment_designs',
    description: 'Query A/B test and experiment design proposals, filtered by status or agent.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status (proposed, approved, running, completed, rejected).' },
        agent: { type: 'string', description: 'Filter by proposing agent role.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.status) { values.push(params.status); conditions.push(`status = $${values.length}`); }
      if (params.agent) { values.push(params.agent); conditions.push(`agent = $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM experiment_designs ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },
];