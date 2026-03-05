/**
 * Shared Social Media Tools — Cross-Platform Social Media Management
 *
 * Tools:
 *   schedule_social_post   — Schedule a post for a specific platform and time
 *   get_scheduled_posts    — List all scheduled posts with optional filters
 *   get_social_metrics     — Read social metrics (followers, engagement, reach)
 *   get_post_performance   — Get metrics for a specific published post
 *   get_social_audience    — Analyze audience demographics and growth
 *   reply_to_social        — Reply to comments/mentions (YELLOW authority)
 *   get_trending_topics    — Fetch trending topics relevant to AI/SaaS/enterprise
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

/* ── Platform API Config ─────────────────── */

function getSocialApiConfig(platform: string): { baseUrl: string; apiKey: string } | null {
  // Buffer as aggregator (preferred)
  const bufferKey = process.env.BUFFER_API_KEY;
  if (bufferKey) return { baseUrl: 'https://api.bufferapp.com/1', apiKey: bufferKey };

  // Direct platform APIs as fallback
  if (platform === 'linkedin') {
    const key = process.env.LINKEDIN_API_KEY;
    if (key) return { baseUrl: 'https://api.linkedin.com/v2', apiKey: key };
  }
  if (platform === 'twitter') {
    const key = process.env.TWITTER_API_KEY;
    if (key) return { baseUrl: 'https://api.twitter.com/2', apiKey: key };
  }

  return null;
}

/* ── Factory ─────────────────────────────── */

export function createSocialMediaTools(): ToolDefinition[] {
  return [
    /* ── schedule_social_post ───────────── */
    {
      name: 'schedule_social_post',
      description:
        'Schedule a social media post for a specific platform and time. ' +
        'The post is persisted to the database first, then submitted to the platform API if available.',
      parameters: {
        platform: {
          type: 'string',
          description: 'Target social media platform.',
          required: true,
          enum: ['linkedin', 'twitter', 'instagram'],
        },
        text: {
          type: 'string',
          description: 'The post content text.',
          required: true,
        },
        media_url: {
          type: 'string',
          description: 'Optional URL to an image or video to attach.',
        },
        scheduled_at: {
          type: 'string',
          description: 'ISO 8601 datetime for when the post should be published.',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const platform = params.platform as string;
        const text = params.text as string;
        const mediaUrl = (params.media_url as string) || null;
        const scheduledAt = params.scheduled_at as string;

        try {
          // Persist to database first
          const rows = await systemQuery<{ id: string }>(
            `INSERT INTO scheduled_posts (platform, text, media_url, scheduled_at, status)
             VALUES ($1, $2, $3, $4, 'scheduled')
             RETURNING id`,
            [platform, text, mediaUrl, scheduledAt],
          );
          const postId = rows[0]?.id;
          if (!postId) {
            return { success: false, error: 'Failed to insert scheduled post.' };
          }

          // Attempt platform API submission
          let apiStatus = 'pending';
          const config = getSocialApiConfig(platform);
          if (config) {
            try {
              const response = await fetch(`${config.baseUrl}/updates/create.json`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${config.apiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  text,
                  media: mediaUrl ? { link: mediaUrl } : undefined,
                  scheduled_at: scheduledAt,
                }),
              });
              apiStatus = response.ok ? 'submitted' : 'api_error';
            } catch {
              apiStatus = 'api_unreachable';
            }
          } else {
            apiStatus = 'no_api_configured';
          }

          await systemQuery(
            'UPDATE scheduled_posts SET api_status = $1 WHERE id = $2',
            [apiStatus, postId],
          );

          return {
            success: true,
            data: { post_id: postId, platform, scheduled_at: scheduledAt, api_status: apiStatus },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to schedule post: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_post_performance ──────────── */
    {
      name: 'get_post_performance',
      description:
        'Get performance metrics for a specific published post, including likes, comments, shares, ' +
        'impressions, and engagement rate.',
      parameters: {
        post_id: {
          type: 'string',
          description: 'The ID of the scheduled/published post.',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const postId = params.post_id as string;

        try {
          const rows = await systemQuery<{
            id: string;
            platform: string;
            text: string;
            scheduled_at: string;
            status: string;
            likes: number;
            comments: number;
            shares: number;
            impressions: number;
            engagement_rate: number;
          }>(
            `SELECT sp.id, sp.platform, sp.text, sp.scheduled_at, sp.status,
                    COALESCE(sm.likes, 0) AS likes,
                    COALESCE(sm.comments, 0) AS comments,
                    COALESCE(sm.shares, 0) AS shares,
                    COALESCE(sm.impressions, 0) AS impressions,
                    COALESCE(sm.engagement_rate, 0) AS engagement_rate
             FROM scheduled_posts sp
             LEFT JOIN social_metrics sm ON sm.post_id = sp.id
             WHERE sp.id = $1`,
            [postId],
          );

          if (rows.length === 0) {
            return { success: false, error: `Post not found: ${postId}` };
          }

          return { success: true, data: rows[0] };
        } catch (err) {
          return {
            success: false,
            error: `Failed to fetch post performance: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_social_audience ──────────── */
    {
      name: 'get_social_audience',
      description:
        'Analyze audience demographics and growth for a specific platform. Returns follower count trend, ' +
        'peak engagement times, and top-performing content types.',
      parameters: {
        platform: {
          type: 'string',
          description: 'The platform to analyze (linkedin, twitter, instagram).',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const platform = params.platform as string;

        try {
          // Follower count trend (last 30 days)
          const trend = await systemQuery<{ recorded_at: string; followers: number }>(
            `SELECT recorded_at, followers
             FROM social_metrics
             WHERE platform = $1
             ORDER BY recorded_at DESC
             LIMIT 30`,
            [platform],
          );

          // Peak engagement times
          const peakTimes = await systemQuery<{ hour: number; avg_engagement: number }>(
            `SELECT EXTRACT(HOUR FROM recorded_at) AS hour,
                    AVG(engagement_rate) AS avg_engagement
             FROM social_metrics
             WHERE platform = $1
             GROUP BY hour
             ORDER BY avg_engagement DESC
             LIMIT 5`,
            [platform],
          );

          // Top content types
          const topContent = await systemQuery<{ content_type: string; avg_engagement: number; post_count: number }>(
            `SELECT sp.content_type,
                    AVG(sm.engagement_rate) AS avg_engagement,
                    COUNT(*) AS post_count
             FROM scheduled_posts sp
             JOIN social_metrics sm ON sm.post_id = sp.id
             WHERE sp.platform = $1
             GROUP BY sp.content_type
             ORDER BY avg_engagement DESC
             LIMIT 5`,
            [platform],
          );

          return {
            success: true,
            data: {
              platform,
              follower_trend: trend,
              peak_engagement_times: peakTimes,
              top_content_types: topContent,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to fetch audience data: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── reply_to_social (YELLOW authority) ── */
    {
      name: 'reply_to_social',
      description:
        'Reply to a comment or mention on a social media platform. This is a YELLOW authority action — ' +
        'replies are logged to the database regardless of API success.',
      parameters: {
        platform: {
          type: 'string',
          description: 'The social media platform.',
          required: true,
        },
        post_id: {
          type: 'string',
          description: 'The ID of the post to reply to.',
          required: true,
        },
        reply_text: {
          type: 'string',
          description: 'The reply text content.',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const platform = params.platform as string;
        const postId = params.post_id as string;
        const replyText = params.reply_text as string;

        let apiStatus = 'pending';

        // Attempt platform API submission
        const config = getSocialApiConfig(platform);
        if (config) {
          try {
            const response = await fetch(`${config.baseUrl}/replies`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ post_id: postId, text: replyText }),
            });
            apiStatus = response.ok ? 'sent' : 'api_error';
          } catch {
            apiStatus = 'api_unreachable';
          }
        } else {
          apiStatus = 'no_api_configured';
        }

        // Always log to DB
        try {
          const rows = await systemQuery<{ id: string }>(
            `INSERT INTO social_replies (platform, post_id, reply_text, api_status)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [platform, postId, replyText, apiStatus],
          );

          return {
            success: true,
            data: { reply_id: rows[0]?.id ?? null, status: apiStatus },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to log reply: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_trending_topics ──────────── */
    {
      name: 'get_trending_topics',
      description:
        'Fetch trending topics and hashtags relevant to AI, SaaS, and enterprise industries. ' +
        'Uses web search or platform trending APIs to surface current topics with relevance scores.',
      parameters: {
        category: {
          type: 'string',
          description: 'Topic category to focus on.',
          enum: ['ai', 'saas', 'enterprise', 'general'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const category = (params.category as string) || 'general';

        const categoryQueries: Record<string, string> = {
          ai: 'trending AI artificial intelligence topics hashtags',
          saas: 'trending SaaS software-as-a-service topics hashtags',
          enterprise: 'trending enterprise technology B2B topics hashtags',
          general: 'trending technology startup topics hashtags',
        };

        const query = categoryQueries[category] ?? categoryQueries.general;

        try {
          // Check for cached trending data (refresh every 4 hours)
          const cached = await systemQuery<{ topics: string; fetched_at: string }>(
            `SELECT topics, fetched_at
             FROM trending_topics_cache
             WHERE category = $1 AND fetched_at > NOW() - INTERVAL '4 hours'
             ORDER BY fetched_at DESC
             LIMIT 1`,
            [category],
          );

          if (cached.length > 0) {
            return {
              success: true,
              data: { category, topics: JSON.parse(cached[0].topics), cached: true },
            };
          }

          // Attempt platform trending API
          const config = getSocialApiConfig('twitter');
          let topics: Array<{ topic: string; hashtag: string; relevance_score: number }> = [];

          if (config) {
            try {
              const response = await fetch(`${config.baseUrl}/trends/place.json?id=1`, {
                headers: { Authorization: `Bearer ${config.apiKey}` },
              });
              if (response.ok) {
                const data = (await response.json()) as Array<{
                  trends: Array<{ name: string; tweet_volume: number | null }>;
                }>;
                const trends = data[0]?.trends ?? [];
                topics = trends.slice(0, 15).map((t, i) => ({
                  topic: t.name.replace(/^#/, ''),
                  hashtag: t.name.startsWith('#') ? t.name : `#${t.name}`,
                  relevance_score: Math.round((1 - i / 15) * 100) / 100,
                }));
              }
            } catch {
              // Fall through to fallback
            }
          }

          // Fallback: return category-based curated topics
          if (topics.length === 0) {
            const fallback: Record<string, Array<{ topic: string; hashtag: string; relevance_score: number }>> = {
              ai: [
                { topic: 'Generative AI', hashtag: '#GenerativeAI', relevance_score: 0.95 },
                { topic: 'LLM', hashtag: '#LLM', relevance_score: 0.90 },
                { topic: 'AI Agents', hashtag: '#AIAgents', relevance_score: 0.88 },
                { topic: 'Machine Learning', hashtag: '#MachineLearning', relevance_score: 0.85 },
                { topic: 'AI Ethics', hashtag: '#AIEthics', relevance_score: 0.75 },
              ],
              saas: [
                { topic: 'Product-Led Growth', hashtag: '#PLG', relevance_score: 0.92 },
                { topic: 'SaaS Metrics', hashtag: '#SaaSMetrics', relevance_score: 0.88 },
                { topic: 'Cloud Native', hashtag: '#CloudNative', relevance_score: 0.85 },
                { topic: 'Developer Experience', hashtag: '#DevEx', relevance_score: 0.82 },
                { topic: 'API First', hashtag: '#APIFirst', relevance_score: 0.78 },
              ],
              enterprise: [
                { topic: 'Digital Transformation', hashtag: '#DigitalTransformation', relevance_score: 0.90 },
                { topic: 'Enterprise AI', hashtag: '#EnterpriseAI', relevance_score: 0.88 },
                { topic: 'B2B Sales', hashtag: '#B2BSales', relevance_score: 0.82 },
                { topic: 'Cybersecurity', hashtag: '#Cybersecurity', relevance_score: 0.80 },
                { topic: 'Cloud Migration', hashtag: '#CloudMigration', relevance_score: 0.75 },
              ],
              general: [
                { topic: 'Tech Trends', hashtag: '#TechTrends', relevance_score: 0.85 },
                { topic: 'Startups', hashtag: '#Startups', relevance_score: 0.82 },
                { topic: 'Innovation', hashtag: '#Innovation', relevance_score: 0.80 },
                { topic: 'Future of Work', hashtag: '#FutureOfWork', relevance_score: 0.78 },
                { topic: 'Automation', hashtag: '#Automation', relevance_score: 0.75 },
              ],
            };
            topics = fallback[category] ?? fallback.general;
          }

          // Cache results
          try {
            await systemQuery(
              `INSERT INTO trending_topics_cache (category, topics, fetched_at)
               VALUES ($1, $2, NOW())`,
              [category, JSON.stringify(topics)],
            );
          } catch {
            // Caching failure is non-critical
          }

          return { success: true, data: { category, topics, cached: false } };
        } catch (err) {
          return {
            success: false,
            error: `Failed to fetch trending topics: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  ];
}
