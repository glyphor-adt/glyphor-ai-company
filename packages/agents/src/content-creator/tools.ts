/**
 * Content Creator (Tyler Reed) — Tools
 * Reports to Maya Brooks (CMO). Content drafting and performance analysis.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';
import { PulseClient } from '@glyphor/integrations';
import { systemQuery } from '@glyphor/shared/db';

function getPulseClient(): PulseClient | null {
  try { return PulseClient.fromEnv(); } catch { return null; }
}

export function createContentCreatorTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'draft_blog_post',
      description: 'Create a blog post draft. Draft is NOT published — requires CMO approval.',,
      parameters: { title: { type: 'string', description: 'Blog post title', required: true }, content: { type: 'string', description: 'Full blog post content in HTML or Markdown', required: true }, tags: { type: 'string', description: 'Comma-separated tags' }, metaDescription: { type: 'string', description: 'SEO meta description (max 160 chars)' } },
      async execute(params) {
        await systemQuery('INSERT INTO content_drafts (type, title, content, tags, meta_description, status, author, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', ['blog_post', params.title, params.content, params.tags || null, params.metaDescription || null, 'draft', 'content-creator', new Date().toISOString()]);
        return { success: true, message: `Draft "${params.title}" saved. Awaiting CMO review.` };
      },
    },
    {
      name: 'draft_social_post',
      description: 'Draft a social media post for review. Not published until approved.',
      parameters: { platform: { type: 'string', description: 'Platform: twitter, linkedin, threads', required: true }, content: { type: 'string', description: 'Post content', required: true }, mediaUrl: { type: 'string', description: 'Optional media URL' } },
      async execute(params) {
        await systemQuery('INSERT INTO content_drafts (type, platform, content, media_url, status, author, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', ['social_post', params.platform, params.content, params.mediaUrl || null, 'draft', 'content-creator', new Date().toISOString()]);
        return { success: true, message: `Social draft for ${params.platform} saved. Awaiting review.` };
      },
    },
    {
      name: 'draft_case_study',
      description: 'Draft a customer case study outline.',
      parameters: { customerName: { type: 'string', description: 'Customer/company name', required: true }, problem: { type: 'string', description: 'Problem statement', required: true }, solution: { type: 'string', description: 'How Glyphor solved it', required: true }, results: { type: 'string', description: 'Quantified results', required: true } },
      async execute(params) {
        const content = `# Case Study: ${params.customerName}\n\n## Problem\n${params.problem}\n\n## Solution\n${params.solution}\n\n## Results\n${params.results}`;
        await systemQuery('INSERT INTO content_drafts (type, title, content, status, author, created_at) VALUES ($1, $2, $3, $4, $5, $6)', ['case_study', `Case Study: ${params.customerName}`, content, 'draft', 'content-creator', new Date().toISOString()]);
        return { success: true, message: `Case study draft for ${params.customerName} saved.` };
      },
    },
    {
      name: 'draft_email',
      description: 'Draft an email campaign for review.',
      parameters: { subject: { type: 'string', description: 'Email subject line', required: true }, body: { type: 'string', description: 'Email body content (HTML)', required: true }, campaign: { type: 'string', description: 'Campaign type: onboarding, feature_launch, re_engagement, newsletter' } },
      async execute(params) {
        await systemQuery('INSERT INTO content_drafts (type, title, content, campaign_type, status, author, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', ['email', params.subject, params.body, params.campaign || 'general', 'draft', 'content-creator', new Date().toISOString()]);
        return { success: true, message: `Email draft "${params.subject}" saved. Awaiting review.` };
      },
    },
    {
      name: 'query_content_performance',
      description: 'Query performance metrics for published content (views, engagement, conversions).',
      parameters: { contentType: { type: 'string', description: 'Type: blog, social, email, all', required: true }, period: { type: 'string', description: 'Time period: 7d, 30d, 90d' }, sortBy: { type: 'string', description: 'Sort by: views, engagement, conversions' } },
      async execute(params) {
        const sortCol = String(params.sortBy || 'views');
        let sql = 'SELECT * FROM content_metrics';
        const values: unknown[] = [];
        if (params.contentType !== 'all') { values.push(params.contentType); sql += ` WHERE content_type=$${values.length}`; }
        sql += ` ORDER BY ${sortCol} DESC LIMIT 20`;
        const data = await systemQuery(sql, values);
        return { success: true, data };
      },
    },
    {
      name: 'query_top_performing_content',
      description: 'Get the top performing content pieces to identify winning formats and topics.',
      parameters: { limit: { type: 'number', description: 'Number of results (default 10)' }, metric: { type: 'string', description: 'Metric to rank by: views, shares, conversions' } },
      async execute(params) {
        const sortCol = String(params.metric || 'views');
        const data = await systemQuery(`SELECT * FROM content_metrics ORDER BY ${sortCol} DESC LIMIT $1`, [Number(params.limit) || 10]);
        return { success: true, data };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        await systemQuery('INSERT INTO agent_activities (agent_role, activity_type, summary, details, created_at) VALUES ($1, $2, $3, $4, $5)', ['content-creator', 'content_creation', params.summary, params.details || null, new Date().toISOString()]);
        return { success: true };
      },
    },

    // ── Pulse Creative Studio tools (MCP) ──

    {
      name: 'pulse_generate_hero_image',
      description: 'Generate a hero image for blog posts or case studies using Pulse. Always generate a hero image when drafting blog content.',
      parameters: {
        prompt: { type: 'string', description: 'Detailed image prompt for the hero image', required: true },
        aspect_ratio: { type: 'string', description: 'Aspect ratio: 16:9 (blog), 1:1 (social), 4:3', enum: ['16:9', '1:1', '4:3'] },
        style: { type: 'string', description: 'Visual style hint to include in the prompt' },
      },
      async execute(params) {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const image = await pulse.generateConceptImage({
          prompt: params.prompt as string,
          aspect_ratio: (params.aspect_ratio as '16:9' | '1:1' | '4:3') ?? '16:9',
          style: params.style as string,
        });
        return { success: true, data: { url: image.url, imageId: image.id }, message: `Hero image generated: ${image.url}` };
      },
    },

    {
      name: 'pulse_generate_social_graphic',
      description: 'Generate a social media graphic to accompany a social post draft. Always pair social post drafts with Pulse-generated visuals.',
      parameters: {
        prompt: { type: 'string', description: 'Image prompt for the social graphic', required: true },
        platform: { type: 'string', description: 'Target platform (affects aspect ratio)', required: true, enum: ['twitter', 'linkedin', 'instagram', 'tiktok'] },
      },
      async execute(params) {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const ratioMap: Record<string, '1:1' | '16:9' | '9:16'> = { twitter: '16:9', linkedin: '16:9', instagram: '1:1', tiktok: '9:16' };
        const image = await pulse.generateConceptImage({
          prompt: params.prompt as string,
          aspect_ratio: ratioMap[params.platform as string] || '1:1',
        });
        return { success: true, data: { url: image.url, imageId: image.id, platform: params.platform }, message: `Social graphic generated: ${image.url}` };
      },
    },

    {
      name: 'pulse_enhance_prompt',
      description: 'Enhance a rough image or video prompt into a production-ready prompt using Pulse AI. Use before generating visuals for better quality.',
      parameters: {
        prompt: { type: 'string', description: 'Rough prompt to enhance', required: true },
        medium: { type: 'string', description: 'Target medium: image or video', enum: ['image', 'video'] },
      },
      async execute(params) {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const enhanced = await pulse.enhancePrompt({
          prompt: params.prompt as string,
          medium: params.medium as 'image' | 'video',
        });
        return { success: true, data: { enhancedPrompt: enhanced } };
      },
    },
  ];
}
