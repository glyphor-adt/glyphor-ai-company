/**
 * Content Creator (Tyler Reed) — Tools
 * Reports to Maya Patel (CMO). Content drafting and performance analysis.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';

export function createContentCreatorTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'draft_blog_post',
      description: 'Create a blog post draft in Ghost CMS. Draft is NOT published — requires CMO approval.',
      parameters: { title: { type: 'string', description: 'Blog post title', required: true }, content: { type: 'string', description: 'Full blog post content in HTML or Markdown', required: true }, tags: { type: 'string', description: 'Comma-separated tags' }, metaDescription: { type: 'string', description: 'SEO meta description (max 160 chars)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('content_drafts').insert({ type: 'blog_post', title: params.title, content: params.content, tags: params.tags || null, meta_description: params.metaDescription || null, status: 'draft', author: 'content-creator', created_at: new Date().toISOString() });
        return { success: true, message: `Draft "${params.title}" saved. Awaiting CMO review.` };
      },
    },
    {
      name: 'draft_social_post',
      description: 'Draft a social media post for review. Not published until approved.',
      parameters: { platform: { type: 'string', description: 'Platform: twitter, linkedin, threads', required: true }, content: { type: 'string', description: 'Post content', required: true }, mediaUrl: { type: 'string', description: 'Optional media URL' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('content_drafts').insert({ type: 'social_post', platform: params.platform, content: params.content, media_url: params.mediaUrl || null, status: 'draft', author: 'content-creator', created_at: new Date().toISOString() });
        return { success: true, message: `Social draft for ${params.platform} saved. Awaiting review.` };
      },
    },
    {
      name: 'draft_case_study',
      description: 'Draft a customer case study outline.',
      parameters: { customerName: { type: 'string', description: 'Customer/company name', required: true }, problem: { type: 'string', description: 'Problem statement', required: true }, solution: { type: 'string', description: 'How Glyphor solved it', required: true }, results: { type: 'string', description: 'Quantified results', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const content = `# Case Study: ${params.customerName}\n\n## Problem\n${params.problem}\n\n## Solution\n${params.solution}\n\n## Results\n${params.results}`;
        await supabase.from('content_drafts').insert({ type: 'case_study', title: `Case Study: ${params.customerName}`, content, status: 'draft', author: 'content-creator', created_at: new Date().toISOString() });
        return { success: true, message: `Case study draft for ${params.customerName} saved.` };
      },
    },
    {
      name: 'draft_email',
      description: 'Draft an email campaign for review.',
      parameters: { subject: { type: 'string', description: 'Email subject line', required: true }, body: { type: 'string', description: 'Email body content (HTML)', required: true }, campaign: { type: 'string', description: 'Campaign type: onboarding, feature_launch, re_engagement, newsletter' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('content_drafts').insert({ type: 'email', title: params.subject, content: params.body, campaign_type: params.campaign || 'general', status: 'draft', author: 'content-creator', created_at: new Date().toISOString() });
        return { success: true, message: `Email draft "${params.subject}" saved. Awaiting review.` };
      },
    },
    {
      name: 'query_content_performance',
      description: 'Query performance metrics for published content (views, engagement, conversions).',
      parameters: { contentType: { type: 'string', description: 'Type: blog, social, email, all', required: true }, period: { type: 'string', description: 'Time period: 7d, 30d, 90d' }, sortBy: { type: 'string', description: 'Sort by: views, engagement, conversions' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('content_metrics').select('*').order(params.sortBy || 'views', { ascending: false }).limit(20);
        if (params.contentType !== 'all') { query = query.eq('content_type', params.contentType); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_top_performing_content',
      description: 'Get the top performing content pieces to identify winning formats and topics.',
      parameters: { limit: { type: 'number', description: 'Number of results (default 10)' }, metric: { type: 'string', description: 'Metric to rank by: views, shares, conversions' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('content_metrics').select('*').order(params.metric || 'views', { ascending: false }).limit(params.limit || 10);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('agent_activities').insert({ agent_role: 'content-creator', activity_type: 'content_creation', summary: params.summary, details: params.details || null, created_at: new Date().toISOString() });
        return { success: true };
      },
    },
  ];
}
