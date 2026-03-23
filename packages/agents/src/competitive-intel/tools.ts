/**
 * Competitive Intel (Daniel Ortiz) — Tools
 * Reports to Elena Vasquez (CPO). Market & competitor intelligence.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { searchWeb, searchNews } from '@glyphor/integrations';

async function resolveKnowledgeLiveRefs(content: string): Promise<string> {
  if (!content.includes('{')) return content;
  const refs = await systemQuery<{ key: string; cached_value: string | null }>(
    'SELECT key, cached_value FROM knowledge_live_refs',
  );
  if (!refs || refs.length === 0) return content;
  const refMap = new Map(refs.map(r => [r.key, r.cached_value ?? '—']));
  return content.replace(/\{(\w+)\}/g, (_match, key: string) => refMap.get(key) ?? _match);
}

export function createCompetitiveIntelTools(_memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'get_competitor_intelligence',
      description:
        'Returns merged competitive context: the curated `competitive_landscape` section from company knowledge ' +
        'plus a fresh web scan for recent AI-agent competitor funding and launches. ' +
        'Prefer this over ad-hoc searches when you need both org doctrine and current signal.',
      parameters: {
        skip_web_scan: {
          type: 'boolean',
          description: 'If true, only return company knowledge (no live web search).',
          required: false,
        },
      },
      async execute(params): Promise<ToolResult> {
        const skipWeb = params.skip_web_scan === true;
        const year = new Date().getFullYear();

        const rows = await systemQuery<{
          section: string;
          title: string;
          content: string;
          is_stale: boolean;
        }>(
          `SELECT section, title, content, is_stale
           FROM company_knowledge_base
           WHERE section = 'competitive_landscape' AND is_active = true AND is_stale = FALSE`,
        );

        let knowledge: {
          section: string;
          title: string;
          content: string;
          stale_warning: string | null;
        } | null = null;

        if (rows.length > 0) {
          const row = rows[0];
          knowledge = {
            section: row.section,
            title: row.title,
            content: await resolveKnowledgeLiveRefs(row.content),
            stale_warning: row.is_stale ? 'Section marked stale — verify before acting.' : null,
          };
        }

        let webResults: Awaited<ReturnType<typeof searchWeb>> | null = null;
        if (!skipWeb) {
          try {
            webResults = await searchWeb(
              `latest AI agent automation competitors funding launches ${year}`,
              { num: 10, timeRange: 'month' },
            );
          } catch (err) {
            return {
              success: false,
              error: `Web scan failed: ${err instanceof Error ? err.message : String(err)}`,
            };
          }
        }

        return {
          success: true,
          data: {
            company_knowledge: knowledge,
            web_results: webResults,
            web_query: skipWeb ? null : `latest AI agent automation competitors funding launches ${year}`,
          },
        };
      },
    },
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
        const results = await searchNews(params.query as string, { num: Number(params.limit) || 10 });
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
