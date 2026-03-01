/**
 * Competitive Intel (Daniel Ortiz) — Tools
 * Reports to Elena Vasquez (CPO). Market & competitor intelligence.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createCompetitiveIntelTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'fetch_github_releases',
      description: 'Fetch recent releases from a public GitHub repository to track competitor product updates.',
      parameters: { owner: { type: 'string', description: 'GitHub org or user', required: true }, repo: { type: 'string', description: 'Repository name', required: true }, limit: { type: 'number', description: 'Max releases to fetch (default 5)' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM competitive_intel WHERE source=$1 AND subject=$2 ORDER BY created_at DESC LIMIT $3', ['github', `${params.owner}/${params.repo}`, Number(params.limit) || 5]);
        return { success: true, data };
      },
    },
    {
      name: 'search_hacker_news',
      description: 'Search Hacker News for mentions of competitors or relevant topics.',
      parameters: { query: { type: 'string', description: 'Search query', required: true }, limit: { type: 'number', description: 'Max results (default 10)' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM competitive_intel WHERE source=$1 AND content ILIKE $2 ORDER BY created_at DESC LIMIT $3', ['hackernews', `%${params.query}%`, Number(params.limit) || 10]);
        return { success: true, data };
      },
    },
    {
      name: 'search_product_hunt',
      description: 'Search Product Hunt for competitor launches and trending products.',
      parameters: { query: { type: 'string', description: 'Search query', required: true }, days: { type: 'number', description: 'Look back N days (default 30)' } },
      async execute(params) {
        const since = new Date(Date.now() - (Number(params.days) || 30) * 86400000).toISOString();
        const data = await systemQuery('SELECT * FROM competitive_intel WHERE source=$1 AND content ILIKE $2 AND created_at >= $3 ORDER BY created_at DESC', ['producthunt', `%${params.query}%`, since]);
        return { success: true, data };
      },
    },
    {
      name: 'fetch_pricing_pages',
      description: 'Retrieve cached competitor pricing page snapshots for comparison.',
      parameters: { competitor: { type: 'string', description: 'Competitor name', required: true } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM competitive_intel WHERE source=$1 AND subject ILIKE $2 ORDER BY created_at DESC LIMIT 1', ['pricing', `%${params.competitor}%`]);
        return { success: true, data: data[0] ?? null };
      },
    },
    {
      name: 'query_competitor_tech_stack',
      description: 'Look up a competitor\'s technology stack from cached Wappalyzer data.',
      parameters: { domain: { type: 'string', description: 'Competitor domain (e.g. figma.com)', required: true } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM competitive_intel WHERE source=$1 AND subject=$2 ORDER BY created_at DESC LIMIT 1', ['wappalyzer', params.domain]);
        return { success: true, data: data[0] ?? null };
      },
    },
    {
      name: 'check_job_postings',
      description: 'Check cached competitor job postings to infer strategic direction.',
      parameters: { company: { type: 'string', description: 'Company name', required: true }, keywords: { type: 'string', description: 'Optional filter keywords' } },
      async execute(params) {
        let sql = 'SELECT * FROM competitive_intel WHERE source=$1 AND subject ILIKE $2';
        const values: unknown[] = ['jobs', `%${params.company}%`];
        if (params.keywords) { sql += ` AND content ILIKE $${values.length + 1}`; values.push(`%${params.keywords}%`); }
        sql += ' ORDER BY created_at DESC LIMIT 20';
        const data = await systemQuery(sql, values);
        return { success: true, data };
      },
    },
    {
      name: 'store_intel',
      description: 'Store a new competitive intelligence finding in the database.',
      parameters: { source: { type: 'string', description: 'Source (github, hackernews, producthunt, pricing, etc.)', required: true }, subject: { type: 'string', description: 'Subject company or product', required: true }, content: { type: 'string', description: 'Intel content/summary', required: true }, urgency: { type: 'string', description: 'green, yellow, or red' } },
      async execute(params) {
        try {
          await systemQuery('INSERT INTO competitive_intel (source, subject, content, urgency, agent, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [params.source, params.subject, params.content, params.urgency || 'green', 'competitive-intel', new Date().toISOString()]);
          return { success: true, message: 'Intel stored.' };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        await systemQuery('INSERT INTO agent_activities (agent_role, activity_type, summary, details, created_at) VALUES ($1, $2, $3, $4, $5)', ['competitive-intel', 'intel_scan', params.summary, params.details || null, new Date().toISOString()]);
        return { success: true };
      },
    },
  ];
}
