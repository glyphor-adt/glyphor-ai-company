/**
 * Content Creator (Tyler Reed) — Tools
 * Reports to Maya Brooks (CMO). Content drafting and performance analysis.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { PulseClient } from '@glyphor/integrations';
import { createAllPulseTools } from '../shared/pulseTools.js';
import { createFacebookTools } from '../shared/facebookTools.js';
import { createLinkedInTools } from '../shared/linkedinTools.js';

function getPulseClientOrThrow(): PulseClient {
  return PulseClient.fromEnv();
}

export function createContentCreatorTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'draft_blog_post',
      description: 'Create a blog post draft. Draft is NOT published — requires CMO approval.',
      parameters: { title: { type: 'string', description: 'Blog post title', required: true }, content: { type: 'string', description: 'Full blog post content in HTML or Markdown', required: true }, tags: { type: 'string', description: 'Comma-separated tags' }, metaDescription: { type: 'string', description: 'SEO meta description (max 160 chars)' } },
      async execute(params) {
        try {
        await systemQuery('INSERT INTO content_drafts (type, title, content, tags, meta_description, status, author, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', ['blog_post', params.title, params.content, params.tags || null, params.metaDescription || null, 'draft', 'content-creator', new Date().toISOString()]);
        return { success: true, message: `Draft "${params.title}" saved. Awaiting CMO review.` };
        } catch (err) { return { success: false, error: (err as Error).message }; }
      },
    },
    {
      name: 'draft_social_post',
      description: 'Draft a social media post for review. Not published until approved.',
      parameters: { platform: { type: 'string', description: 'Platform: twitter, linkedin, threads', required: true }, content: { type: 'string', description: 'Post content', required: true }, mediaUrl: { type: 'string', description: 'Optional media URL' } },
      async execute(params) {
        try {
        await systemQuery('INSERT INTO content_drafts (type, platform, content, media_url, status, author, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', ['social_post', params.platform, params.content, params.mediaUrl || null, 'draft', 'content-creator', new Date().toISOString()]);
        return { success: true, message: `Social draft for ${params.platform} saved. Awaiting review.` };
        } catch (err) { return { success: false, error: (err as Error).message }; }
      },
    },
    {
      name: 'draft_case_study',
      description: 'Draft a customer case study outline.',
      parameters: { customerName: { type: 'string', description: 'Customer/company name', required: true }, problem: { type: 'string', description: 'Problem statement', required: true }, solution: { type: 'string', description: 'How Glyphor solved it', required: true }, results: { type: 'string', description: 'Quantified results', required: true } },
      async execute(params) {
        try {
        const content = `# Case Study: ${params.customerName}\n\n## Problem\n${params.problem}\n\n## Solution\n${params.solution}\n\n## Results\n${params.results}`;
        await systemQuery('INSERT INTO content_drafts (type, title, content, status, author, created_at) VALUES ($1, $2, $3, $4, $5, $6)', ['case_study', `Case Study: ${params.customerName}`, content, 'draft', 'content-creator', new Date().toISOString()]);
        return { success: true, message: `Case study draft for ${params.customerName} saved.` };
        } catch (err) { return { success: false, error: (err as Error).message }; }
      },
    },
    {
      name: 'draft_email',
      description: 'Draft an email campaign for review. Write the body in plain professional prose or clean HTML — NEVER use markdown formatting.',
      parameters: { subject: { type: 'string', description: 'Email subject line', required: true }, body: { type: 'string', description: 'Email body content in plain prose or HTML. Do NOT use markdown syntax.', required: true }, campaign: { type: 'string', description: 'Campaign type: onboarding, feature_launch, re_engagement, newsletter' } },
      async execute(params) {
        try {
        await systemQuery('INSERT INTO content_drafts (type, title, content, campaign_type, status, author, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', ['email', params.subject, params.body, params.campaign || 'general', 'draft', 'content-creator', new Date().toISOString()]);
        return { success: true, message: `Email draft "${params.subject}" saved. Awaiting review.` };
        } catch (err) { return { success: false, error: (err as Error).message }; }
      },
    },
    {
      name: 'query_content_performance',
      description: 'Query performance metrics for published content (views, engagement, conversions).',
      parameters: { contentType: { type: 'string', description: 'Type: blog, social, email, all', required: true }, period: { type: 'string', description: 'Time period: 7d, 30d, 90d' }, sortBy: { type: 'string', description: 'Sort by: views, engagement, conversions' } },
      async execute(params) {
        try {
        const ALLOWED_SORT = ['views', 'engagement', 'conversions'];
        const sortCol = ALLOWED_SORT.includes(String(params.sortBy)) ? String(params.sortBy) : 'views';
        let sql = 'SELECT * FROM content_metrics';
        const values: unknown[] = [];
        if (params.contentType !== 'all') { values.push(params.contentType); sql += ` WHERE content_type=$${values.length}`; }
        sql += ` ORDER BY ${sortCol} DESC LIMIT 20`;
        const data = await systemQuery(sql, values);
        return { success: true, data };
        } catch (err) { return { success: false, error: (err as Error).message }; }
      },
    },
    {
      name: 'query_top_performing_content',
      description: 'Get the top performing content pieces to identify winning formats and topics.',
      parameters: { limit: { type: 'number', description: 'Number of results (default 10)' }, metric: { type: 'string', description: 'Metric to rank by: views, shares, conversions' } },
      async execute(params) {
        try {
        const ALLOWED_SORT = ['views', 'shares', 'conversions'];
        const sortCol = ALLOWED_SORT.includes(String(params.metric)) ? String(params.metric) : 'views';
        const data = await systemQuery(`SELECT * FROM content_metrics ORDER BY ${sortCol} DESC LIMIT $1`, [Number(params.limit) || 10]);
        return { success: true, data };
        } catch (err) { return { success: false, error: (err as Error).message }; }
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

    // ── Workflow alias tools (Veo + ElevenLabs wrappers) ──

    {
      name: 'generate_video',
      description: 'Generate a video clip (Veo wrapper) using prompt and optional source image.',
      parameters: {
        prompt: { type: 'string', description: 'Video prompt describing the desired content', required: true },
        model: { type: 'string', description: 'Video model', enum: ['veo-3.1', 'veo-3.0'] },
        aspect_ratio: { type: 'string', description: 'Aspect ratio', enum: ['16:9', '9:16', '1:1'] },
        source_image_url: { type: 'string', description: 'Optional image URL for image-to-video generation' },
      },
      async execute(params) {
        try {
          const pulse = getPulseClientOrThrow();
          const video = await pulse.generateVideo({
            prompt: params.prompt as string,
            model: (params.model as 'veo-3.1' | 'veo-3.0' | undefined) ?? 'veo-3.1',
            aspect_ratio: params.aspect_ratio as '16:9' | '9:16' | '1:1',
            source_image_url: params.source_image_url as string | undefined,
          });
          return { success: true, data: { videoId: video.id, status: video.status, url: video.url } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'poll_video_status',
      description: 'Poll generation status for a video until complete or failed.',
      parameters: {
        video_id: { type: 'string', description: 'Video ID to check status for', required: true },
      },
      async execute(params) {
        try {
          const pulse = getPulseClientOrThrow();
          const status = await pulse.pollVideoStatus({ video_id: params.video_id as string });
          return { success: true, data: status };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'generate_voiceover',
      description: 'Generate voiceover narration audio (ElevenLabs wrapper) from text.',
      parameters: {
        text: { type: 'string', description: 'Narration text to convert to speech', required: true },
        voice: { type: 'string', description: 'Optional voice preset' },
      },
      async execute(params) {
        try {
          const pulse = getPulseClientOrThrow();
          const result = await pulse.callAndParse('text_to_speech', {
            text: params.text,
            voice: params.voice,
          });
          return { success: true, data: result };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'generate_music',
      description: 'Generate background music from a text prompt.',
      parameters: {
        prompt: { type: 'string', description: 'Music brief (genre, mood, tempo)', required: true },
        duration: { type: 'number', description: 'Optional target duration in seconds' },
      },
      async execute(params) {
        try {
          const pulse = getPulseClientOrThrow();
          const result = await pulse.callAndParse('generate_music', {
            prompt: params.prompt,
            duration: params.duration,
          });
          return { success: true, data: result };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'generate_sfx',
      description: 'Generate a sound effect from a short text prompt.',
      parameters: {
        prompt: { type: 'string', description: 'Sound effect prompt', required: true },
        duration: { type: 'number', description: 'Optional duration in seconds (max 22)' },
      },
      async execute(params) {
        try {
          const pulse = getPulseClientOrThrow();
          const result = await pulse.callAndParse('generate_sound_effect', {
            prompt: params.prompt,
            duration: params.duration,
          });
          return { success: true, data: result };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
    {
      name: 'enhance_video_prompt',
      description: 'Enhance a rough video prompt into a cinematic Veo-ready prompt.',
      parameters: {
        prompt: { type: 'string', description: 'Raw video prompt to enhance', required: true },
      },
      async execute(params) {
        try {
          const pulse = getPulseClientOrThrow();
          const enhanced = await pulse.callAndGetText('enhance_video_prompt', {
            prompt: params.prompt,
          });
          return { success: true, data: { enhancedPrompt: enhanced } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    // ── Pulse Creative Studio tools (MCP) ──
    ...createAllPulseTools(memory),

    // ── Facebook / Meta Page tools ──
    ...createFacebookTools(),

    // ── LinkedIn Organization tools ──
    ...createLinkedInTools(),
  ];
}
