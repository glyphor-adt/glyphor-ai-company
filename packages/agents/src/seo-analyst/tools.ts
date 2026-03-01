/**
 * SEO Analyst (Lisa Chen) — Tools
 * Reports to Maya Brooks (CMO). Search engine optimization and keyword strategy.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createSeoAnalystTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_seo_rankings',
      description: 'Query current keyword rankings and position changes.',
      parameters: { period: { type: 'string', description: 'Time period: 7d, 30d, 90d', required: true }, keyword: { type: 'string', description: 'Filter by specific keyword (optional)' } },
      async execute(params) {
        const conditions = ['metric_type=$1'];
        const values: unknown[] = ['ranking'];
        if (params.keyword) { conditions.push(`keyword ILIKE $${values.length + 1}`); values.push(`%${params.keyword}%`); }
        const data = await systemQuery(`SELECT * FROM seo_data WHERE ${conditions.join(' AND ')} ORDER BY recorded_at DESC LIMIT 50`, values);
        return { success: true, data };
      },
    },
    {
      name: 'query_keyword_data',
      description: 'Get keyword research data including volume, difficulty, and CPC from Ahrefs.',
      parameters: { keyword: { type: 'string', description: 'Keyword to research', required: true } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM seo_data WHERE metric_type=$1 AND keyword ILIKE $2 ORDER BY recorded_at DESC LIMIT 10', ['keyword_research', `%${params.keyword}%`]);
        return { success: true, data };
      },
    },
    {
      name: 'discover_keywords',
      description: 'Discover new keyword opportunities based on a seed topic.',
      parameters: { seed: { type: 'string', description: 'Seed topic or keyword', required: true }, limit: { type: 'number', description: 'Max results (default 20)' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM seo_data WHERE metric_type=$1 AND seed_topic ILIKE $2 ORDER BY search_volume DESC LIMIT $3', ['keyword_discovery', `%${params.seed}%`, Number(params.limit) || 20]);
        return { success: true, data };
      },
    },
    {
      name: 'query_competitor_rankings',
      description: 'Compare keyword rankings against competitors.',
      parameters: { competitor: { type: 'string', description: 'Competitor domain', required: true }, limit: { type: 'number', description: 'Max results (default 20)' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM seo_data WHERE metric_type=$1 AND competitor_domain=$2 ORDER BY search_volume DESC LIMIT $3', ['competitor_ranking', params.competitor, Number(params.limit) || 20]);
        return { success: true, data };
      },
    },
    {
      name: 'query_backlinks',
      description: 'Query backlink profile data including new and lost links.',
      parameters: { period: { type: 'string', description: 'Time period', required: true }, type: { type: 'string', description: 'Filter: new, lost, all' } },
      async execute(params) {
        const conditions = ['metric_type=$1'];
        const values: unknown[] = ['backlinks'];
        if (params.type && params.type !== 'all') { conditions.push(`link_type=$${values.length + 1}`); values.push(params.type); }
        const data = await systemQuery(`SELECT * FROM seo_data WHERE ${conditions.join(' AND ')} ORDER BY recorded_at DESC LIMIT 50`, values);
        return { success: true, data };
      },
    },
    {
      name: 'query_search_console',
      description: 'Query Google Search Console data: impressions, clicks, CTR, position.',
      parameters: { period: { type: 'string', description: 'Time period', required: true }, dimension: { type: 'string', description: 'Dimension: query, page, device, country' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM seo_data WHERE metric_type=$1 AND dimension=$2 ORDER BY clicks DESC LIMIT 50', ['search_console', params.dimension || 'query']);
        return { success: true, data };
      },
    },
    {
      name: 'analyze_content_seo',
      description: 'Analyze a content piece for SEO optimization opportunities.',
      parameters: { url: { type: 'string', description: 'Content URL or slug', required: true }, targetKeyword: { type: 'string', description: 'Target keyword to optimize for' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM seo_data WHERE metric_type=$1 AND url=$2 ORDER BY recorded_at DESC LIMIT 1', ['content_audit', params.url]);
        return { success: true, data: data[0] ?? null, targetKeyword: params.targetKeyword };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        await systemQuery('INSERT INTO agent_activities (agent_role, activity_type, summary, details, created_at) VALUES ($1, $2, $3, $4, $5)', ['seo-analyst', 'seo_analysis', params.summary, params.details || null, new Date().toISOString()]);
        return { success: true };
      },
    },
  ];
}
