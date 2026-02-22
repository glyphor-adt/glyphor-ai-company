/**
 * Account Research (Nathan Cole) — Tools
 * Reports to Rachel Kim (VP-Sales). Prospect and account intelligence.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';

export function createAccountResearchTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'search_company_info',
      description: 'Search for company information from Apollo enrichment data.',
      parameters: { company: { type: 'string', description: 'Company name or domain', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('company_research').select('*').or(`name.ilike.%${params.company}%,domain.ilike.%${params.company}%`).order('updated_at', { ascending: false }).limit(5);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'search_crunchbase',
      description: 'Search Crunchbase for company funding, leadership, and market data.',
      parameters: { company: { type: 'string', description: 'Company name', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('company_research').select('*').eq('source', 'crunchbase').ilike('name', `%${params.company}%`).order('updated_at', { ascending: false }).limit(1);
        return { success: true, data: data?.[0] || null };
      },
    },
    {
      name: 'analyze_tech_stack',
      description: 'Look up a company\'s technology stack from Wappalyzer data.',
      parameters: { domain: { type: 'string', description: 'Company domain (e.g. stripe.com)', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('company_research').select('*').eq('source', 'wappalyzer').eq('domain', params.domain).order('updated_at', { ascending: false }).limit(1);
        return { success: true, data: data?.[0] || null };
      },
    },
    {
      name: 'search_linkedin_profiles',
      description: 'Search Apollo for relevant people at a target company (engineering leads, design directors).',
      parameters: { company: { type: 'string', description: 'Company name', required: true }, title: { type: 'string', description: 'Job title filter (e.g. "VP Engineering", "Design Director")' }, limit: { type: 'number', description: 'Max results (default 10)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('contact_research').select('*').ilike('company', `%${params.company}%`).order('updated_at', { ascending: false }).limit(params.limit || 10);
        if (params.title) { query = query.ilike('title', `%${params.title}%`); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'search_job_postings',
      description: 'Check cached job postings for hiring signals at a target company.',
      parameters: { company: { type: 'string', description: 'Company name', required: true }, keywords: { type: 'string', description: 'Keywords to filter (e.g. "design system", "frontend")' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('company_research').select('*').eq('source', 'jobs').ilike('name', `%${params.company}%`).order('updated_at', { ascending: false }).limit(20);
        if (params.keywords) { query = query.ilike('content', `%${params.keywords}%`); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'estimate_dev_spend',
      description: 'Estimate a company\'s developer tooling spend based on team size and tech stack.',
      parameters: { company: { type: 'string', description: 'Company name', required: true }, teamSize: { type: 'number', description: 'Engineering team size estimate' }, techStack: { type: 'string', description: 'Known technologies (comma-separated)' } },
      async execute(params) {
        // Heuristic: average dev spends $500-2000/year on tools
        const size = params.teamSize || 50;
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
        const supabase = memory.getSupabaseClient();
        await supabase.from('account_dossiers').insert({ company: params.company, domain: params.domain || null, summary: params.summary, opportunity_estimate: params.opportunity || null, buying_signals: params.buyingSignals || null, compiled_by: 'account-research', created_at: new Date().toISOString() });
        return { success: true, message: `Dossier for ${params.company} saved.` };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('agent_activities').insert({ agent_role: 'account-research', activity_type: 'account_research', summary: params.summary, details: params.details || null, created_at: new Date().toISOString() });
        return { success: true };
      },
    },
  ];
}
