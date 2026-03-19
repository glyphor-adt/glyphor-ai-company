/**
 * LinkedIn Tools — Shared tools for agents to manage the LinkedIn organization page
 *
 * Tools:
 *   publish_linkedin_post          — Create a text post (with optional article link)
 *   get_linkedin_posts             — List recent organization posts
 *   get_linkedin_post_analytics    — Get engagement metrics for a specific post
 *   get_linkedin_followers         — Get follower count and growth stats
 *   get_linkedin_page_stats        — Get page views and unique visitors
 *   get_linkedin_demographics      — Get follower demographics (industry, seniority, geo)
 *   check_linkedin_status          — Verify LinkedIn integration is configured and working
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import {
  createLinkedInPost,
  getLinkedInPosts,
  getLinkedInPostAnalytics,
  getLinkedInFollowerStats,
  getLinkedInPageStats,
  getLinkedInFollowerDemographics,
  checkLinkedInHealth,
} from '@glyphor/integrations';

export function createLinkedInTools(): ToolDefinition[] {
  return [
    {
      name: 'publish_linkedin_post',
      description:
        'Publish a post to the Glyphor LinkedIn organization page. Only publish approved content. ' +
        'YELLOW authority — requires prior CMO or founder approval for brand-facing posts.',
      parameters: {
        text: {
          type: 'string',
          description: 'Post text content (max 3000 chars)',
          required: true,
        },
        article_url: {
          type: 'string',
          description: 'Optional article URL to include (creates a link preview card)',
          required: false,
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const text = params.text as string;
          if (text.length > 3000) {
            return { success: false, error: 'LinkedIn posts are limited to 3000 characters.' };
          }
          const result = await createLinkedInPost(text, params.article_url as string | undefined);
          return {
            success: true,
            data: {
              postUrn: result.postUrn,
              message: 'Post published to LinkedIn organization page.',
            },
          };
        } catch (err) {
          return { success: false, error: `LinkedIn publish failed: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'get_linkedin_posts',
      description: 'Get recent posts from the Glyphor LinkedIn organization page.',
      parameters: {
        limit: {
          type: 'number',
          description: 'Number of posts to retrieve (default: 10, max: 50)',
          required: false,
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const limit = Math.min(Math.max((params.limit as number) || 10, 1), 50);
          const posts = await getLinkedInPosts(limit);
          return { success: true, data: { posts, count: posts.length } };
        } catch (err) {
          return { success: false, error: `Failed to fetch posts: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'get_linkedin_post_analytics',
      description: 'Get engagement metrics for a specific LinkedIn post — impressions, clicks, likes, comments, shares.',
      parameters: {
        post_urn: {
          type: 'string',
          description: 'LinkedIn post URN (e.g. "urn:li:share:1234567890")',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const analytics = await getLinkedInPostAnalytics(params.post_urn as string);
          return { success: true, data: analytics };
        } catch (err) {
          return { success: false, error: `Failed to fetch analytics: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'get_linkedin_followers',
      description: 'Get LinkedIn organization follower stats — total, organic, and paid follower counts.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        try {
          const stats = await getLinkedInFollowerStats();
          return { success: true, data: stats };
        } catch (err) {
          return { success: false, error: `Failed to fetch followers: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'get_linkedin_page_stats',
      description: 'Get LinkedIn organization page views and unique visitors.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        try {
          const stats = await getLinkedInPageStats();
          return { success: true, data: stats };
        } catch (err) {
          return { success: false, error: `Failed to fetch page stats: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'get_linkedin_demographics',
      description: 'Get LinkedIn follower demographics — industry, seniority, function, and geographic breakdown.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        try {
          const demographics = await getLinkedInFollowerDemographics();
          return { success: true, data: demographics };
        } catch (err) {
          return { success: false, error: `Failed to fetch demographics: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'check_linkedin_status',
      description: 'Check whether the LinkedIn integration is configured and the credentials are valid.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        const health = await checkLinkedInHealth();
        return { success: health.valid, data: health };
      },
    },
  ];
}
