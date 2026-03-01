/**
 * Social Media Manager (Kai Johnson) — Tools
 * Reports to Maya Brooks (CMO). Social media scheduling and analytics.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { PulseClient } from '@glyphor/integrations';

function getPulseClient(): PulseClient | null {
  try { return PulseClient.fromEnv(); } catch { return null; }
}

export function createSocialMediaManagerTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'schedule_social_post',
      description: 'Schedule a pre-approved post via Buffer. Only schedule content that has been reviewed.',
      parameters: { profileId: { type: 'string', description: 'Buffer profile ID', required: true }, text: { type: 'string', description: 'Post text', required: true }, scheduledAt: { type: 'string', description: 'ISO 8601 datetime to publish' }, mediaUrl: { type: 'string', description: 'Optional media URL' } },
      async execute(params) {
        await systemQuery('INSERT INTO scheduled_posts (profile_id, text, scheduled_at, media_url, status, agent, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [params.profileId, params.text, params.scheduledAt || null, params.mediaUrl || null, 'queued', 'social-media-manager', new Date().toISOString()]);
        return { success: true, message: 'Post queued for scheduling via Buffer.' };
      },
    },
    {
      name: 'query_social_metrics',
      description: 'Query aggregate social media metrics: followers, engagement rate, reach.',
      parameters: { platform: { type: 'string', description: 'Platform: twitter, linkedin, all', required: true }, period: { type: 'string', description: 'Time period: 7d, 30d, 90d' } },
      async execute(params) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        if (params.platform !== 'all') { conditions.push(`platform=$${values.length + 1}`); values.push(params.platform); }
        const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
        const data = await systemQuery(`SELECT * FROM social_metrics${where} ORDER BY recorded_at DESC LIMIT 30`, values);
        return { success: true, data };
      },
    },
    {
      name: 'query_post_performance',
      description: 'Get performance data for individual published posts.',
      parameters: { platform: { type: 'string', description: 'Platform filter (optional)' }, sortBy: { type: 'string', description: 'Sort by: engagement, impressions, clicks' }, limit: { type: 'number', description: 'Max results (default 20)' } },
      async execute(params) {
        const conditions = ['metric_type=$1'];
        const values: unknown[] = ['post_performance'];
        if (params.platform) { conditions.push(`platform=$${values.length + 1}`); values.push(params.platform); }
        const sortCol = ['engagement', 'impressions', 'clicks'].includes(String(params.sortBy)) ? String(params.sortBy) : 'engagement';
        const data = await systemQuery(`SELECT * FROM social_metrics WHERE ${conditions.join(' AND ')} ORDER BY ${sortCol} DESC LIMIT $${values.length + 1}`, [...values, Number(params.limit) || 20]);
        return { success: true, data };
      },
    },
    {
      name: 'query_optimal_times',
      description: 'Get optimal posting times based on historical engagement data.',
      parameters: { platform: { type: 'string', description: 'Platform: twitter, linkedin', required: true } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM social_metrics WHERE metric_type=$1 AND platform=$2 ORDER BY recorded_at DESC LIMIT 1', ['optimal_times', params.platform]);
        return { success: true, data: data[0] ?? null };
      },
    },
    {
      name: 'query_audience_demographics',
      description: 'Get audience demographic data: location, industry, job titles.',
      parameters: { platform: { type: 'string', description: 'Platform: twitter, linkedin, all', required: true } },
      async execute(params) {
        const conditions = ['metric_type=$1'];
        const values: unknown[] = ['demographics'];
        if (params.platform !== 'all') { conditions.push(`platform=$${values.length + 1}`); values.push(params.platform); }
        const data = await systemQuery(`SELECT * FROM social_metrics WHERE ${conditions.join(' AND ')} ORDER BY recorded_at DESC LIMIT 5`, values);
        return { success: true, data };
      },
    },
    {
      name: 'monitor_mentions',
      description: 'Check recent brand mentions and relevant conversations.',
      parameters: { query: { type: 'string', description: 'Search term (default: "glyphor")' }, limit: { type: 'number', description: 'Max results (default 20)' } },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM social_metrics WHERE metric_type=$1 AND content ILIKE $2 ORDER BY recorded_at DESC LIMIT $3', ['mention', `%${params.query || 'glyphor'}%`, Number(params.limit) || 20]);
        return { success: true, data };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        await systemQuery('INSERT INTO agent_activities (agent_role, activity_type, summary, details, created_at) VALUES ($1, $2, $3, $4, $5)', ['social-media-manager', 'social_media', params.summary, params.details || null, new Date().toISOString()]);
        return { success: true };
      },
    },

    // ── Pulse Creative Studio tools (MCP) ──

    {
      name: 'pulse_generate_post_image',
      description: 'Generate an image for a social media post using Pulse. Always generate visuals for scheduled posts — we dogfood our own product.',
      parameters: {
        prompt: { type: 'string', description: 'Image prompt describing the visual', required: true },
        platform: { type: 'string', description: 'Target platform (affects aspect ratio)', required: true, enum: ['twitter', 'linkedin', 'instagram', 'tiktok'] },
        style: { type: 'string', description: 'Visual style hint to include in the prompt' },
      },
      async execute(params) {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const ratioMap: Record<string, '1:1' | '16:9' | '9:16'> = { twitter: '16:9', linkedin: '16:9', instagram: '1:1', tiktok: '9:16' };
        const image = await pulse.generateConceptImage({
          prompt: params.prompt as string,
          aspect_ratio: ratioMap[params.platform as string] || '1:1',
          style: params.style as string,
        });
        return { success: true, data: { url: image.url, imageId: image.id, platform: params.platform }, message: `Image generated for ${params.platform}: ${image.url}` };
      },
    },

    {
      name: 'pulse_generate_short_video',
      description: 'Generate a short-form video clip for social media using Pulse. Use for Reels, TikToks, LinkedIn video.',
      parameters: {
        prompt: { type: 'string', description: 'Video prompt', required: true },
        platform: { type: 'string', description: 'Target platform', required: true, enum: ['tiktok', 'instagram', 'linkedin', 'twitter'] },
        model: { type: 'string', description: 'Video model', enum: ['veo-3.1', 'kling'] },
      },
      async execute(params) {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const verticalPlatforms = ['tiktok', 'instagram'];
        const video = await pulse.generateVideo({
          prompt: params.prompt as string,
          model: (params.model as 'veo-3.1' | 'kling') ?? 'kling',
          aspect_ratio: verticalPlatforms.includes(params.platform as string) ? '9:16' : '16:9',
        });
        return { success: true, data: { videoId: video.id, status: video.status, url: video.url, platform: params.platform }, message: `Video generated for ${params.platform}: ${video.url ?? 'processing...'}` };
      },
    },

    {
      name: 'pulse_poll_video_status',
      description: 'Check the generation status of a Pulse video. Video generation is async — poll until completed.',
      parameters: {
        video_id: { type: 'string', description: 'Video ID to check', required: true },
      },
      async execute(params) {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const status = await pulse.pollVideoStatus({ video_id: params.video_id as string });
        return { success: true, data: status };
      },
    },
  ];
}
