/**
 * SEO Analyst (Lisa Chen) — Tools
 * Reports to Maya Patel (CMO). Search engine optimization and keyword strategy.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';

export function createSeoAnalystTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'query_seo_rankings',
      description: 'Query current keyword rankings and position changes.',
      parameters: { period: { type: 'string', description: 'Time period: 7d, 30d, 90d', required: true }, keyword: { type: 'string', description: 'Filter by specific keyword (optional)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('seo_data').select('*').eq('metric_type', 'ranking').order('recorded_at', { ascending: false }).limit(50);
        if (params.keyword) { query = query.ilike('keyword', `%${params.keyword}%`); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_keyword_data',
      description: 'Get keyword research data including volume, difficulty, and CPC from Ahrefs.',
      parameters: { keyword: { type: 'string', description: 'Keyword to research', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('seo_data').select('*').eq('metric_type', 'keyword_research').ilike('keyword', `%${params.keyword}%`).order('recorded_at', { ascending: false }).limit(10);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'discover_keywords',
      description: 'Discover new keyword opportunities based on a seed topic.',
      parameters: { seed: { type: 'string', description: 'Seed topic or keyword', required: true }, limit: { type: 'number', description: 'Max results (default 20)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('seo_data').select('*').eq('metric_type', 'keyword_discovery').ilike('seed_topic', `%${params.seed}%`).order('search_volume', { ascending: false }).limit(params.limit || 20);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_competitor_rankings',
      description: 'Compare keyword rankings against competitors.',
      parameters: { competitor: { type: 'string', description: 'Competitor domain', required: true }, limit: { type: 'number', description: 'Max results (default 20)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('seo_data').select('*').eq('metric_type', 'competitor_ranking').eq('competitor_domain', params.competitor).order('search_volume', { ascending: false }).limit(params.limit || 20);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_backlinks',
      description: 'Query backlink profile data including new and lost links.',
      parameters: { period: { type: 'string', description: 'Time period', required: true }, type: { type: 'string', description: 'Filter: new, lost, all' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('seo_data').select('*').eq('metric_type', 'backlinks').order('recorded_at', { ascending: false }).limit(50);
        if (params.type && params.type !== 'all') { query = query.eq('link_type', params.type); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_search_console',
      description: 'Query Google Search Console data: impressions, clicks, CTR, position.',
      parameters: { period: { type: 'string', description: 'Time period', required: true }, dimension: { type: 'string', description: 'Dimension: query, page, device, country' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('seo_data').select('*').eq('metric_type', 'search_console').eq('dimension', params.dimension || 'query').order('clicks', { ascending: false }).limit(50);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'analyze_content_seo',
      description: 'Analyze a content piece for SEO optimization opportunities.',
      parameters: { url: { type: 'string', description: 'Content URL or slug', required: true }, targetKeyword: { type: 'string', description: 'Target keyword to optimize for' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('seo_data').select('*').eq('metric_type', 'content_audit').eq('url', params.url).order('recorded_at', { ascending: false }).limit(1);
        return { success: true, data: data?.[0] || null, targetKeyword: params.targetKeyword };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('agent_activities').insert({ agent_role: 'seo-analyst', activity_type: 'seo_analysis', summary: params.summary, details: params.details || null, created_at: new Date().toISOString() });
        return { success: true };
      },
    },
  ];
}
