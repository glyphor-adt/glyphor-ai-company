/**
 * Social Media Manager (Kai Johnson) — Tools
 * Reports to Maya Brooks (CMO). Social media scheduling and analytics.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { createSocialMediaTools } from '../shared/socialMediaTools.js';
import { createAllPulseTools } from '../shared/pulseTools.js';
import { createFacebookTools } from '../shared/facebookTools.js';
import { createLinkedInTools } from '../shared/linkedinTools.js';

export function createSocialMediaManagerTools(memory: CompanyMemoryStore): ToolDefinition[] {
  const sharedScheduleTool = createSocialMediaTools().find((tool) => tool.name === 'schedule_social_post');

  return [
    {
      name: 'schedule_social_post',
      description: 'Schedule a pre-approved social media post. Only schedule content that has been reviewed.',
      parameters: {
        draft_id: { type: 'string', description: 'Optional approved content draft UUID' },
        platform: { type: 'string', description: 'Platform: twitter, linkedin, instagram' },
        text: { type: 'string', description: 'Post text' },
        scheduledAt: { type: 'string', description: 'ISO 8601 datetime to publish', required: true },
        mediaUrl: { type: 'string', description: 'Optional media URL' },
        profileId: { type: 'string', description: 'Optional Buffer/social profile identifier' },
        approvedBy: { type: 'string', description: 'Optional approver override' },
        decisionId: { type: 'string', description: 'Optional linked approval decision UUID' },
        initiativeId: { type: 'string', description: 'Optional initiative UUID' },
        directiveId: { type: 'string', description: 'Optional directive UUID' },
        assignmentId: { type: 'string', description: 'Optional assignment UUID' },
        metadata: { type: 'object', description: 'Optional structured publish metadata' },
        maxRetries: { type: 'number', description: 'Optional maximum publish retries' },
      },
      async execute(params, ctx): Promise<ToolResult> {
        if (!sharedScheduleTool) {
          return { success: false, error: 'Shared schedule_social_post tool is unavailable.' };
        }

        return sharedScheduleTool.execute(
          {
            draft_id: params.draft_id,
            platform: params.platform,
            text: params.text,
            scheduled_at: params.scheduledAt,
            media_url: params.mediaUrl,
            profile_id: params.profileId,
            approved_by: params.approvedBy,
            decision_id: params.decisionId,
            initiative_id: params.initiativeId,
            directive_id: params.directiveId,
            assignment_id: params.assignmentId,
            metadata: params.metadata,
            max_retries: params.maxRetries,
          },
          ctx,
        );
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
    ...createAllPulseTools(memory),

    // ── Facebook / Meta Page tools ──
    ...createFacebookTools(),

    // ── LinkedIn Organization tools ──
    ...createLinkedInTools(),
  ];
}
