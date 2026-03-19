/**
 * Facebook Tools — Shared tools for agents to manage Facebook Page content
 *
 * Tools:
 *   publish_facebook_post   — Publish a text post (with optional link) to the Facebook Page
 *   schedule_facebook_post  — Schedule a post for a future date/time
 *   get_facebook_posts      — List recent page posts
 *   get_facebook_insights   — Get page-level analytics (impressions, reach, fans)
 *   get_facebook_post_performance — Get engagement metrics for a specific post
 *   get_facebook_audience   — Get audience demographics (age, gender, location)
 *   check_facebook_status   — Verify Facebook integration is configured and working
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import {
  createPagePost,
  schedulePagePost,
  getPagePosts,
  getPageInsights,
  getPostInsights,
  getAudienceDemographics,
  checkFacebookHealth,
} from '@glyphor/integrations';

export function createFacebookTools(): ToolDefinition[] {
  return [
    {
      name: 'publish_facebook_post',
      description:
        'Publish a post to the Glyphor Facebook Page. Only publish approved content. ' +
        'YELLOW authority — requires prior CMO or founder approval for brand-facing posts.',
      parameters: {
        message: {
          type: 'string',
          description: 'Post text content',
          required: true,
        },
        link: {
          type: 'string',
          description: 'Optional URL to include (generates a link preview)',
          required: false,
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const result = await createPagePost(
            params.message as string,
            params.link as string | undefined,
          );
          return {
            success: true,
            data: {
              postId: result.postId,
              message: 'Post published to Facebook Page.',
            },
          };
        } catch (err) {
          return { success: false, error: `Facebook publish failed: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'schedule_facebook_post',
      description:
        'Schedule a post for future publication on the Glyphor Facebook Page. ' +
        'The scheduled_at time must be at least 10 minutes in the future and within 6 months.',
      parameters: {
        message: {
          type: 'string',
          description: 'Post text content',
          required: true,
        },
        scheduled_at: {
          type: 'string',
          description: 'ISO 8601 datetime for when to publish (e.g. "2026-03-25T14:00:00Z")',
          required: true,
        },
        link: {
          type: 'string',
          description: 'Optional URL to include',
          required: false,
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const scheduledDate = new Date(params.scheduled_at as string);
          if (isNaN(scheduledDate.getTime())) {
            return { success: false, error: 'Invalid scheduled_at date. Use ISO 8601 format.' };
          }

          const minTime = Date.now() + 10 * 60_000;
          if (scheduledDate.getTime() < minTime) {
            return { success: false, error: 'Scheduled time must be at least 10 minutes in the future.' };
          }

          const result = await schedulePagePost(
            params.message as string,
            scheduledDate,
            params.link as string | undefined,
          );
          return {
            success: true,
            data: {
              postId: result.postId,
              scheduledAt: params.scheduled_at,
              message: 'Post scheduled on Facebook Page.',
            },
          };
        } catch (err) {
          return { success: false, error: `Facebook schedule failed: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'get_facebook_posts',
      description: 'Get recent posts from the Glyphor Facebook Page.',
      parameters: {
        limit: {
          type: 'number',
          description: 'Number of posts to retrieve (default: 10, max: 100)',
          required: false,
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const limit = Math.min(Math.max((params.limit as number) || 10, 1), 100);
          const posts = await getPagePosts(limit);
          return { success: true, data: { posts, count: posts.length } };
        } catch (err) {
          return { success: false, error: `Failed to fetch posts: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'get_facebook_insights',
      description:
        'Get page-level analytics: impressions, engaged users, page fans, and page views. ' +
        'Use this to track overall Facebook performance.',
      parameters: {
        period: {
          type: 'string',
          description: 'Aggregation period',
          required: false,
          enum: ['day', 'week', 'days_28'],
        },
        limit: {
          type: 'number',
          description: 'Number of data points (default: 7)',
          required: false,
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const period = (params.period as 'day' | 'week' | 'days_28') || 'day';
          const limit = (params.limit as number) || 7;
          const insights = await getPageInsights(undefined, period, limit);
          return { success: true, data: insights };
        } catch (err) {
          return { success: false, error: `Failed to fetch insights: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'get_facebook_post_performance',
      description: 'Get engagement metrics for a specific Facebook post — impressions, reach, reactions, clicks.',
      parameters: {
        post_id: {
          type: 'string',
          description: 'Facebook post ID',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const insights = await getPostInsights(params.post_id as string);
          return { success: true, data: insights };
        } catch (err) {
          return { success: false, error: `Failed to fetch post insights: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'get_facebook_audience',
      description: 'Get audience demographics for the Facebook Page — age, gender, top cities, top countries.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        try {
          const demographics = await getAudienceDemographics();
          return { success: true, data: demographics };
        } catch (err) {
          return { success: false, error: `Failed to fetch demographics: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'check_facebook_status',
      description: 'Check whether the Facebook integration is configured and the credentials are valid.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        const health = await checkFacebookHealth();
        return { success: health.valid, data: health };
      },
    },
  ];
}
