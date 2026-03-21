/**
 * SEO Analyst (Lisa Chen) — Tools
 * Reports to Maya Brooks (CMO). Search engine optimization and keyword strategy.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { searchWeb } from '@glyphor/integrations';

export function createSeoAnalystTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_seo_rankings',
      description: 'Search the web for current keyword ranking data and position changes for glyphor.com.',
      parameters: { keyword: { type: 'string', description: 'Keyword to check rankings for', required: true } },
      async execute(params) {
        const results = await searchWeb(`glyphor.com "${params.keyword}" site ranking position`, { num: 8 });
        return { success: true, data: results };
      },
    },
    {
      name: 'query_keyword_data',
      description: 'Research keyword volume, difficulty, and competition via web search.',
      parameters: { keyword: { type: 'string', description: 'Keyword to research', required: true } },
      async execute(params) {
        const q = `Keyword research for "${params.keyword}": search volume, keyword difficulty, CPC, competition, and search intent. Cite authoritative SEO and publisher sources.`;
        const results = await searchWeb(q, { num: 8 });
        return { success: true, data: results };
      },
    },
    {
      name: 'discover_keywords',
      description: 'Discover new keyword opportunities based on a seed topic.',
      parameters: { seed: { type: 'string', description: 'Seed topic or keyword', required: true }, limit: { type: 'number', description: 'Max results (default 10)' } },
      async execute(params) {
        const q = `Keyword discovery for seed topic "${params.seed}": related keywords, long-tail variants, question-based keywords, and content opportunities (blogs, landing pages).`;
        const results = await searchWeb(q, { num: Number(params.limit) || 10 });
        return { success: true, data: results };
      },
    },
    {
      name: 'query_competitor_rankings',
      description: 'Research competitor SEO rankings and organic keyword positions.',
      parameters: { competitor: { type: 'string', description: 'Competitor domain', required: true }, limit: { type: 'number', description: 'Max results (default 10)' } },
      async execute(params) {
        const results = await searchWeb(`${params.competitor} top organic keywords rankings SEO`, { num: Number(params.limit) || 10 });
        return { success: true, data: results };
      },
    },
    {
      name: 'query_backlinks',
      description: 'Research backlink profile data — referring domains, domain authority, link quality.',
      parameters: { domain: { type: 'string', description: 'Domain to check (default: glyphor.com)' } },
      async execute(params) {
        const target = params.domain || 'glyphor.com';
        const results = await searchWeb(`${target} backlinks referring domains domain authority`, { num: 8 });
        return { success: true, data: results };
      },
    },
    {
      name: 'analyze_content_seo',
      description: 'Research SEO best practices and optimization opportunities for a given topic or URL.',
      parameters: { url: { type: 'string', description: 'Content URL or topic', required: true }, targetKeyword: { type: 'string', description: 'Target keyword to optimize for' } },
      async execute(params) {
        const kwPart = params.targetKeyword ? ` "${params.targetKeyword}"` : '';
        const results = await searchWeb(`${params.url}${kwPart} SEO optimization analysis`, { num: 8 });
        return { success: true, data: results, targetKeyword: params.targetKeyword };
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
