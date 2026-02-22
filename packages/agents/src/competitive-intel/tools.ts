/**
 * Competitive Intel (Daniel Ortiz) — Tools
 * Reports to Elena Vasquez (CPO). Market & competitor intelligence.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';

export function createCompetitiveIntelTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'fetch_github_releases',
      description: 'Fetch recent releases from a public GitHub repository to track competitor product updates.',
      parameters: { owner: { type: 'string', description: 'GitHub org or user', required: true }, repo: { type: 'string', description: 'Repository name', required: true }, limit: { type: 'number', description: 'Max releases to fetch (default 5)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('competitive_intel').select('*').eq('source', 'github').eq('subject', `${params.owner}/${params.repo}`).order('created_at', { ascending: false }).limit(Number(params.limit) || 5);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'search_hacker_news',
      description: 'Search Hacker News for mentions of competitors or relevant topics.',
      parameters: { query: { type: 'string', description: 'Search query', required: true }, limit: { type: 'number', description: 'Max results (default 10)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('competitive_intel').select('*').eq('source', 'hackernews').ilike('content', `%${params.query}%`).order('created_at', { ascending: false }).limit(Number(params.limit) || 10);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'search_product_hunt',
      description: 'Search Product Hunt for competitor launches and trending products.',
      parameters: { query: { type: 'string', description: 'Search query', required: true }, days: { type: 'number', description: 'Look back N days (default 30)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const since = new Date(Date.now() - (Number(params.days) || 30) * 86400000).toISOString();
        const { data } = await supabase.from('competitive_intel').select('*').eq('source', 'producthunt').ilike('content', `%${params.query}%`).gte('created_at', since).order('created_at', { ascending: false });
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'fetch_pricing_pages',
      description: 'Retrieve cached competitor pricing page snapshots for comparison.',
      parameters: { competitor: { type: 'string', description: 'Competitor name', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('competitive_intel').select('*').eq('source', 'pricing').ilike('subject', `%${params.competitor}%`).order('created_at', { ascending: false }).limit(1);
        return { success: true, data: data?.[0] || null };
      },
    },
    {
      name: 'query_competitor_tech_stack',
      description: 'Look up a competitor\'s technology stack from cached Wappalyzer data.',
      parameters: { domain: { type: 'string', description: 'Competitor domain (e.g. figma.com)', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('competitive_intel').select('*').eq('source', 'wappalyzer').eq('subject', params.domain).order('created_at', { ascending: false }).limit(1);
        return { success: true, data: data?.[0] || null };
      },
    },
    {
      name: 'check_job_postings',
      description: 'Check cached competitor job postings to infer strategic direction.',
      parameters: { company: { type: 'string', description: 'Company name', required: true }, keywords: { type: 'string', description: 'Optional filter keywords' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('competitive_intel').select('*').eq('source', 'jobs').ilike('subject', `%${params.company}%`).order('created_at', { ascending: false }).limit(20);
        if (params.keywords) { query = query.ilike('content', `%${params.keywords}%`); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'store_intel',
      description: 'Store a new competitive intelligence finding in the database.',
      parameters: { source: { type: 'string', description: 'Source (github, hackernews, producthunt, pricing, etc.)', required: true }, subject: { type: 'string', description: 'Subject company or product', required: true }, content: { type: 'string', description: 'Intel content/summary', required: true }, urgency: { type: 'string', description: 'green, yellow, or red' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { error } = await supabase.from('competitive_intel').insert({ source: params.source, subject: params.subject, content: params.content, urgency: params.urgency || 'green', agent: 'competitive-intel', created_at: new Date().toISOString() });
        if (error) return { success: false, error: error.message };
        return { success: true, message: 'Intel stored.' };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('agent_activities').insert({ agent_role: 'competitive-intel', activity_type: 'intel_scan', summary: params.summary, details: params.details || null, created_at: new Date().toISOString() });
        return { success: true };
      },
    },
  ];
}
