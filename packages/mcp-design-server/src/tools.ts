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
  // ── Design Reviews ───────────────────────────────────────
  {
    name: 'query_design_reviews',
    description: 'Query design reviews — screenshot comparisons, accessibility audits, brand audits, Lighthouse scores, and design critiques.',
    inputSchema: {
      type: 'object',
      properties: {
        review_type: { type: 'string', description: 'Filter by review type (screenshot_comparison, accessibility_audit, brand_audit, lighthouse, design_critique).' },
        status: { type: 'string', description: 'Filter by status (pending, passed, failed, needs_attention).' },
        url: { type: 'string', description: 'Filter by page URL (exact match).' },
        reviewer: { type: 'string', description: 'Filter by reviewer agent role.' },
        since: { type: 'string', description: 'Only return reviews after this ISO-8601 timestamp.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.review_type) { values.push(params.review_type); conditions.push(`review_type = $${values.length}`); }
      if (params.status) { values.push(params.status); conditions.push(`status = $${values.length}`); }
      if (params.url) { values.push(params.url); conditions.push(`url = $${values.length}`); }
      if (params.reviewer) { values.push(params.reviewer); conditions.push(`reviewer = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`created_at >= $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM design_reviews ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Design Assets ────────────────────────────────────────
  {
    name: 'query_design_assets',
    description: 'Query design assets — icons, illustrations, logos, photographs, and component previews.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_type: { type: 'string', description: 'Filter by asset type (icon, illustration, logo, photograph, component_preview).' },
        format: { type: 'string', description: 'Filter by file format (svg, png, webp, figma).' },
        name: { type: 'string', description: 'Search by asset name (substring match).' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (params.asset_type) { values.push(params.asset_type); conditions.push(`asset_type = $${values.length}`); }
      if (params.format) { values.push(params.format); conditions.push(`format = $${values.length}`); }
      if (params.name) { values.push(`%${params.name}%`); conditions.push(`name ILIKE $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(`SELECT * FROM design_assets ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Failed Reviews Summary ───────────────────────────────
  {
    name: 'query_failed_reviews',
    description: 'Get design reviews that failed or need attention, ordered by most recent.',
    inputSchema: {
      type: 'object',
      properties: {
        review_type: { type: 'string', description: 'Filter by review type.' },
        since: { type: 'string', description: 'Only return reviews after this ISO-8601 timestamp.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = ["status IN ('failed', 'needs_attention')"];
      const values: unknown[] = [];
      if (params.review_type) { values.push(params.review_type); conditions.push(`review_type = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`created_at >= $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = `WHERE ${conditions.join(' AND ')}`;
      const { rows } = await pool.query(`SELECT * FROM design_reviews ${where} ORDER BY created_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Figma-linked Assets ──────────────────────────────────
  {
    name: 'query_figma_assets',
    description: 'Query design assets that have Figma node references.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_type: { type: 'string', description: 'Filter by asset type.' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200).' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = ['figma_node_id IS NOT NULL'];
      const values: unknown[] = [];
      if (params.asset_type) { values.push(params.asset_type); conditions.push(`asset_type = $${values.length}`); }
      const limit = clampLimit(params.limit);
      values.push(limit);
      const where = `WHERE ${conditions.join(' AND ')}`;
      const { rows } = await pool.query(`SELECT * FROM design_assets ${where} ORDER BY updated_at DESC LIMIT $${values.length}`, values);
      return rows;
    },
  },

  // ── Review Score Summary ─────────────────────────────────
  {
    name: 'query_review_scores',
    description: 'Get average and latest review scores grouped by review type for a given URL or across all pages.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Filter by page URL.' },
        since: { type: 'string', description: 'Only include reviews after this ISO-8601 timestamp.' },
      },
    },
    async handler(pool, params) {
      const conditions: string[] = ['score IS NOT NULL'];
      const values: unknown[] = [];
      if (params.url) { values.push(params.url); conditions.push(`url = $${values.length}`); }
      if (params.since) { values.push(params.since); conditions.push(`created_at >= $${values.length}`); }
      const where = `WHERE ${conditions.join(' AND ')}`;
      const { rows } = await pool.query(
        `SELECT review_type, COUNT(*) as review_count, ROUND(AVG(score), 2) as avg_score, ROUND(MIN(score), 2) as min_score, ROUND(MAX(score), 2) as max_score FROM design_reviews ${where} GROUP BY review_type ORDER BY avg_score ASC`,
        values,
      );
      return rows;
    },
  },
];