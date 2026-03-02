/**
 * Competitive Intel (Daniel Ortiz) — Tools
 * Reports to Elena Vasquez (CPO). Market & competitor intelligence.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { searchWeb, searchNews } from '@glyphor/integrations';

export function createCompetitiveIntelTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'search_competitor_updates',
      description: 'Search the web for recent competitor product updates, releases, and announcements.',
      parameters: { competitor: { type: 'string', description: 'Competitor name or product', required: true }, limit: { type: 'number', description: 'Max results (default 10)' } },
      async execute(params) {
        const results = await searchWeb(`${params.competitor} product update release announcement`, { num: Number(params.limit) || 10, timeRange: 'month' });
        return { success: true, data: results };
      },
    },
    {
      name: 'search_competitor_news',
      description: 'Search recent news for competitor mentions, funding, launches, and strategic moves.',
      parameters: { query: { type: 'string', description: 'Search query', required: true }, limit: { type: 'number', description: 'Max results (default 10)' } },
      async execute(params) {
        const results = await searchNews(params.query, { num: Number(params.limit) || 10 });
        return { success: true, data: results };
      },
    },
    {
      name: 'search_product_launches',
      description: 'Search Product Hunt, Hacker News, and the web for competitor or category launches.',
      parameters: { query: { type: 'string', description: 'Search query', required: true } },
      async execute(params) {
        const results = await searchWeb(`${params.query} launch Product Hunt OR "Hacker News" OR announcement`, { num: 10, timeRange: 'month' });
        return { success: true, data: results };
      },
    },
    {
      name: 'fetch_pricing_intel',
      description: 'Research competitor pricing models, plans, and pricing page details.',
      parameters: { competitor: { type: 'string', description: 'Competitor name', required: true } },
      async execute(params) {
        const results = await searchWeb(`${params.competitor} pricing plans cost per seat enterprise`, { num: 8 });
        return { success: true, data: results };
      },
    },
    {
      name: 'query_competitor_tech_stack',
      description: 'Research a competitor\'s technology stack and infrastructure choices.',
      parameters: { domain: { type: 'string', description: 'Competitor domain (e.g. figma.com)', required: true } },
      async execute(params) {
        const results = await searchWeb(`${params.domain} technology stack built with infrastructure engineering blog`, { num: 8 });
        return { success: true, data: results };
      },
    },
    {
      name: 'check_job_postings',
      description: 'Search for competitor job postings to infer strategic direction and investment areas.',
      parameters: { company: { type: 'string', description: 'Company name', required: true }, keywords: { type: 'string', description: 'Optional filter keywords' } },
      async execute(params) {
        const kwPart = params.keywords ? ` ${params.keywords}` : '';
        const results = await searchWeb(`${params.company} hiring jobs careers${kwPart}`, { num: 10 });
        return { success: true, data: results };
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
