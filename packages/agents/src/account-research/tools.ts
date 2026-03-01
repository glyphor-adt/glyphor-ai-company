/**
 * Account Research (Nathan Cole) — Tools
 * Reports to Rachel Kim (VP-Sales). Prospect and account intelligence.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createAccountResearchTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'search_company_info',
      description: 'Search for company information from Apollo enrichment data.',
      parameters: { company: { type: 'string', description: 'Company name or domain', required: true } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM company_research WHERE (name ILIKE $1 OR domain ILIKE $1) ORDER BY updated_at DESC LIMIT 5', [`%${params.company}%`]);
        return { success: true, data };
      },
    },
    {
      name: 'search_crunchbase',
      description: 'Search Crunchbase for company funding, leadership, and market data.',
      parameters: { company: { type: 'string', description: 'Company name', required: true } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM company_research WHERE source=$1 AND name ILIKE $2 ORDER BY updated_at DESC LIMIT 1', ['crunchbase', `%${params.company}%`]);
        return { success: true, data: data[0] ?? null };
      },
    },
    {
      name: 'analyze_tech_stack',
      description: 'Look up a company\'s technology stack from Wappalyzer data.',
      parameters: { domain: { type: 'string', description: 'Company domain (e.g. stripe.com)', required: true } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM company_research WHERE source=$1 AND domain=$2 ORDER BY updated_at DESC LIMIT 1', ['wappalyzer', params.domain]);
        return { success: true, data: data[0] ?? null };
      },
    },
    {
      name: 'search_linkedin_profiles',
      description: 'Search Apollo for relevant people at a target company (engineering leads, design directors).',
      parameters: { company: { type: 'string', description: 'Company name', required: true }, title: { type: 'string', description: 'Job title filter (e.g. "VP Engineering", "Design Director")' }, limit: { type: 'number', description: 'Max results (default 10)' } },
      async execute(params) {
        const limit = Number(params.limit) || 10;
        let sql = 'SELECT * FROM contact_research WHERE company ILIKE $1';
        const values: unknown[] = [`%${params.company}%`];
        if (params.title) { sql += ` AND title ILIKE $${values.length + 1}`; values.push(`%${params.title}%`); }
        sql += ` ORDER BY updated_at DESC LIMIT $${values.length + 1}`;
        values.push(limit);
        const data = await systemQuery(sql, values);
        return { success: true, data };
      },
    },
    {
      name: 'search_job_postings',
      description: 'Check cached job postings for hiring signals at a target company.',
      parameters: { company: { type: 'string', description: 'Company name', required: true }, keywords: { type: 'string', description: 'Keywords to filter (e.g. "design system", "frontend")' } },
      async execute(params) {
        let sql = 'SELECT * FROM company_research WHERE source=$1 AND name ILIKE $2';
        const values: unknown[] = ['jobs', `%${params.company}%`];
        if (params.keywords) { sql += ` AND content ILIKE $${values.length + 1}`; values.push(`%${params.keywords}%`); }
        sql += ' ORDER BY updated_at DESC LIMIT 20';
        const data = await systemQuery(sql, values);
        return { success: true, data };
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
