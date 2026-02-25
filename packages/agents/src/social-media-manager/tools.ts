/**
 * Social Media Manager (Kai Johnson) — Tools
 * Reports to Maya Brooks (CMO). Social media scheduling and analytics.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';
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
        const supabase = memory.getSupabaseClient();
        await supabase.from('scheduled_posts').insert({ profile_id: params.profileId, text: params.text, scheduled_at: params.scheduledAt || null, media_url: params.mediaUrl || null, status: 'queued', agent: 'social-media-manager', created_at: new Date().toISOString() });
        return { success: true, message: 'Post queued for scheduling via Buffer.' };
      },
    },
    {
      name: 'query_social_metrics',
      description: 'Query aggregate social media metrics: followers, engagement rate, reach.',
      parameters: { platform: { type: 'string', description: 'Platform: twitter, linkedin, all', required: true }, period: { type: 'string', description: 'Time period: 7d, 30d, 90d' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('social_metrics').select('*').order('recorded_at', { ascending: false }).limit(30);
        if (params.platform !== 'all') { query = query.eq('platform', params.platform); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_post_performance',
      description: 'Get performance data for individual published posts.',
      parameters: { platform: { type: 'string', description: 'Platform filter (optional)' }, sortBy: { type: 'string', description: 'Sort by: engagement, impressions, clicks' }, limit: { type: 'number', description: 'Max results (default 20)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('social_metrics').select('*').eq('metric_type', 'post_performance').order(String(params.sortBy || 'engagement'), { ascending: false }).limit(Number(params.limit) || 20);
        if (params.platform) { query = query.eq('platform', params.platform); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'query_optimal_times',
      description: 'Get optimal posting times based on historical engagement data.',
      parameters: { platform: { type: 'string', description: 'Platform: twitter, linkedin', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('social_metrics').select('*').eq('metric_type', 'optimal_times').eq('platform', params.platform).order('recorded_at', { ascending: false }).limit(1);
        return { success: true, data: data?.[0] || null };
      },
    },
    {
      name: 'query_audience_demographics',
      description: 'Get audience demographic data: location, industry, job titles.',
      parameters: { platform: { type: 'string', description: 'Platform: twitter, linkedin, all', required: true } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('social_metrics').select('*').eq('metric_type', 'demographics').order('recorded_at', { ascending: false }).limit(5);
        if (params.platform !== 'all') { query = query.eq('platform', params.platform); }
        const { data } = await query;
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'monitor_mentions',
      description: 'Check recent brand mentions and relevant conversations.',
      parameters: { query: { type: 'string', description: 'Search term (default: "glyphor")' }, limit: { type: 'number', description: 'Max results (default 20)' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('social_metrics').select('*').eq('metric_type', 'mention').ilike('content', `%${params.query || 'glyphor'}%`).order('recorded_at', { ascending: false }).limit(Number(params.limit) || 20);
        return { success: true, data: data || [] };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: { summary: { type: 'string', description: 'Activity summary', required: true }, details: { type: 'string', description: 'Detailed notes' } },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('agent_activities').insert({ agent_role: 'social-media-manager', activity_type: 'social_media', summary: params.summary, details: params.details || null, created_at: new Date().toISOString() });
        return { success: true };
      },
    },

    // ── Pulse Creative Studio tools ──

    {
      name: 'pulse_generate_post_image',
      description: 'Generate an image for a social media post using Pulse. Always generate visuals for scheduled posts — we dogfood our own product.',
      parameters: {
        prompt: { type: 'string', description: 'Image prompt describing the visual', required: true },
        platform: { type: 'string', description: 'Target platform (affects aspect ratio)', required: true, enum: ['twitter', 'linkedin', 'instagram', 'tiktok'] },
        style: { type: 'string', description: 'Visual style: photorealistic, illustration, minimalist, branded' },
      },
      async execute(params) {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const ratioMap: Record<string, '1:1' | '16:9' | '9:16'> = { twitter: '16:9', linkedin: '16:9', instagram: '1:1', tiktok: '9:16' };
        const asset = await pulse.generateImage({
          prompt: params.prompt as string,
          aspectRatio: ratioMap[params.platform as string] || '1:1',
          style: params.style as string,
          brandKit: 'glyphor',
        });
        return { success: true, data: { url: asset.url, assetId: asset.id, platform: params.platform }, message: `Image generated for ${params.platform}: ${asset.url}` };
      },
    },

    {
      name: 'pulse_generate_short_video',
      description: 'Generate a short-form video clip for social media using Pulse. Use for Reels, TikToks, LinkedIn video.',
      parameters: {
        prompt: { type: 'string', description: 'Video prompt', required: true },
        platform: { type: 'string', description: 'Target platform', required: true, enum: ['tiktok', 'instagram', 'linkedin', 'twitter'] },
        duration: { type: 'number', description: 'Duration in seconds (5 or 10)' },
      },
      async execute(params) {
        const pulse = getPulseClient();
        if (!pulse) return { success: false, error: 'Pulse not configured (PULSE_SERVICE_ROLE_KEY missing)' };
        const verticalPlatforms = ['tiktok', 'instagram'];
        const asset = await pulse.generateVideo({
          prompt: params.prompt as string,
          model: 'kling',
          duration: (params.duration as number) ?? 5,
          aspectRatio: verticalPlatforms.includes(params.platform as string) ? '9:16' : '16:9',
        });
        return { success: true, data: { url: asset.url, assetId: asset.id, platform: params.platform }, message: `Video generated for ${params.platform}: ${asset.url}` };
      },
    },
  ];
}
