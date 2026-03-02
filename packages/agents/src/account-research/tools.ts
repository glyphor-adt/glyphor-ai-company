/**
 * Account Research (Nathan Cole) — Tools
 * Reports to Rachel Kim (VP-Sales). Prospect and account intelligence.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { searchWeb, searchNews } from '@glyphor/integrations';

export function createAccountResearchTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'search_company_info',
      description: 'Search the web for company information — overview, products, team size, domain, industry.',
      parameters: { company: { type: 'string', description: 'Company name or domain', required: true } },
      async execute(params) {
        const results = await searchWeb(`${params.company} company overview products team size`, { num: 8 });
        return { success: true, data: results };
      },
    },
    {
      name: 'search_funding_data',
      description: 'Search the web for company funding rounds, investors, revenue estimates, and valuation.',
      parameters: { company: { type: 'string', description: 'Company name', required: true } },
      async execute(params) {
        const results = await searchWeb(`${params.company} funding round investors valuation revenue`, { num: 8 });
        return { success: true, data: results };
      },
    },
    {
      name: 'analyze_tech_stack',
      description: 'Search the web for a company\'s technology stack, tools, and infrastructure.',
      parameters: { domain: { type: 'string', description: 'Company domain (e.g. stripe.com)', required: true } },
      async execute(params) {
        const results = await searchWeb(`${params.domain} technology stack tools infrastructure built with`, { num: 8 });
        return { success: true, data: results };
      },
    },
    {
      name: 'search_key_people',
      description: 'Search the web for key people at a target company — leadership, engineering leads, design directors.',
      parameters: { company: { type: 'string', description: 'Company name', required: true }, title: { type: 'string', description: 'Job title filter (e.g. "VP Engineering", "Design Director")' } },
      async execute(params) {
        const titleQuery = params.title ? ` ${params.title}` : ' leadership team executives';
        const results = await searchWeb(`${params.company}${titleQuery} linkedin`, { num: 10 });
        return { success: true, data: results };
      },
    },
    {
      name: 'search_job_postings',
      description: 'Search the web for current job postings at a target company to identify hiring signals.',
      parameters: { company: { type: 'string', description: 'Company name', required: true }, keywords: { type: 'string', description: 'Keywords to filter (e.g. "design system", "frontend")' } },
      async execute(params) {
        const kwQuery = params.keywords ? ` ${params.keywords}` : '';
        const results = await searchWeb(`${params.company} hiring jobs open positions${kwQuery}`, { num: 10 });
        return { success: true, data: results };
      },
    },
    {
      name: 'estimate_dev_spend',
      description: 'Estimate a company\'s developer tooling spend based on team size and tech stack.',
      parameters: { company: { type: 'string', description: 'Company name', required: true }, teamSize: { type: 'number', description: 'Engineering team size estimate' }, techStack: { type: 'string', description: 'Known technologies (comma-separated)' } },
      async execute(params) {
        // Heuristic: average dev spends $500-2000/year on tools
        const size = Number(params.teamSize) || 50;
        const lowEstimate = size * 500;
        const highEstimate = size * 2000;
        return { success: true, data: { company: params.company, teamSize: size, annualSpendRange: { low: lowEstimate, high: highEstimate }, perDevRange: { low: 500, high: 2000 }, confidence: params.teamSize ? 'medium' : 'low' } };
      },
    },
    {
      name: 'compile_dossier',
      description: 'Save a compiled account dossier to the database for the sales team.',
      parameters: { company: { type: 'string', description: 'Company name', required: true }, domain: { type: 'string', description: 'Company domain' }, summary: { type: 'string', description: 'Dossier summary', required: true }, opportunity: { type: 'string', description: 'Estimated opportunity size' }, buyingSignals: { type: 'string', description: 'Key buying signals' } },
      async execute(params) {
        await systemQuery('INSERT INTO account_dossiers (company, domain, summary, opportunity_estimate, buying_signals, compiled_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [params.company, params.domain || null, params.summary, params.opportunity || null, params.buyingSignals || null, 'account-research', new Date().toISOString()]);
        return { success: true, message: `Dossier for ${params.company} saved.` };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        await systemQuery('INSERT INTO agent_activities (agent_role, activity_type, summary, details, created_at) VALUES ($1, $2, $3, $4, $5)', ['account-research', 'account_research', params.summary, params.details || null, new Date().toISOString()]);
        return { success: true };
      },
    },
  ];
}
