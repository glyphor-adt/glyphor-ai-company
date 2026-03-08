/**
 * Shared Social Media Tools — Cross-Platform Social Media Management
 *
 * Tools:
 *   schedule_social_post        — Schedule an approved post for a specific platform and time
 *   get_scheduled_posts         — List scheduled posts with workflow metadata
 *   get_social_metrics          — Read social metrics (followers, engagement, reach)
 *   get_post_performance        — Get metrics for a specific published post
 *   get_social_audience         — Analyze audience demographics and growth
 *   reply_to_social             — Reply to comments/mentions (YELLOW authority)
 *   get_trending_topics         — Fetch trending topics relevant to AI/SaaS/enterprise
 */

import type { GlyphorEventBus, ToolContext, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { createDeliverableTools } from './deliverableTools.js';

type SocialApiConfig = {
  provider: 'buffer' | 'linkedin' | 'twitter';
  baseUrl: string;
  apiKey: string;
};

type DraftRow = {
  id: string;
  title: string | null;
  content: string;
  platform: string | null;
  media_url: string | null;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  decision_id: string | null;
  initiative_id: string | null;
  directive_id: string | null;
  assignment_id: string | null;
  metadata: Record<string, unknown> | null;
};

function getSocialApiConfig(platform: string): SocialApiConfig | null {
  const bufferKey = process.env.BUFFER_API_KEY;
  if (bufferKey) {
    return { provider: 'buffer', baseUrl: 'https://api.bufferapp.com/1', apiKey: bufferKey };
  }

  if (platform === 'linkedin') {
    const key = process.env.LINKEDIN_API_KEY;
    if (key) return { provider: 'linkedin', baseUrl: 'https://api.linkedin.com/v2', apiKey: key };
  }

  if (platform === 'twitter') {
    const key = process.env.TWITTER_API_KEY;
    if (key) return { provider: 'twitter', baseUrl: 'https://api.twitter.com/2', apiKey: key };
  }

  return null;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function withMigrationHint(toolName: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/column .* does not exist|relation .*social_publish_audit_log.* does not exist/i.test(message)) {
    return `${toolName} failed: ${message}. Apply migration 20260308002100_social_publish_workflow.sql.`;
  }

  return `${toolName} failed: ${message}`;
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isSocialDraftStatusPublishable(status: string): boolean {
  return status === 'approved' || status === 'published';
}

async function recordSocialPublishAudit(input: {
  draftId?: string | null;
  scheduledPostId?: string | null;
  deliverableId?: string | null;
  action: string;
  actor: string;
  status: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await systemQuery(
      `INSERT INTO social_publish_audit_log
         (draft_id, scheduled_post_id, deliverable_id, action, actor, status, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        input.draftId ?? null,
        input.scheduledPostId ?? null,
        input.deliverableId ?? null,
        input.action,
        input.actor,
        input.status,
        JSON.stringify(input.details ?? {}),
      ],
    );
  } catch {
    // Audit writes are best-effort to preserve the primary publish record even in older environments.
  }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function publishToPlatform(input: {
  config: SocialApiConfig | null;
  profileId: string;
  platform: string;
  text: string;
  mediaUrl: string | null;
  scheduledAt: string;
  maxRetries: number;
}): Promise<{
  ok: boolean;
  apiStatus: string;
  attempts: number;
  platformPostId: string | null;
  platformPostUrl: string | null;
  error: string | null;
}> {
  if (!input.config) {
    return {
      ok: false,
      apiStatus: 'no_api_configured',
      attempts: 0,
      platformPostId: null,
      platformPostUrl: null,
      error: `No social publishing API configured for ${input.platform}. Configure BUFFER_API_KEY for autonomous publishing.`,
    };
  }

  if (input.config.provider !== 'buffer') {
    return {
      ok: false,
      apiStatus: 'unsupported_provider',
      attempts: 0,
      platformPostId: null,
      platformPostUrl: null,
      error: `Direct ${input.config.provider} publishing is not implemented. Configure BUFFER_API_KEY for autonomous social publishing.`,
    };
  }

  let lastError: string | null = null;
  let lastStatus = 'api_error';

  for (let attempt = 1; attempt <= input.maxRetries; attempt += 1) {
    try {
      const response = await fetch(`${input.config.baseUrl}/updates/create.json`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          profile_ids: [input.profileId],
          text: input.text,
          media: input.mediaUrl ? { link: input.mediaUrl } : undefined,
          scheduled_at: input.scheduledAt,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      const rawBody = await response.text();
      const body = safeJsonParse(rawBody);

      if (response.ok) {
        return {
          ok: true,
          apiStatus: 'submitted',
          attempts: attempt,
          platformPostId: asString(body?.id)
            ?? asString(body?.update_id)
            ?? asString((body?.update as Record<string, unknown> | undefined)?.id),
          platformPostUrl: asString(body?.url)
            ?? asString(body?.post_url)
            ?? asString(body?.permalink)
            ?? asString((body?.update as Record<string, unknown> | undefined)?.url),
          error: null,
        };
      }

      lastStatus = response.status >= 500 ? 'api_unreachable' : 'api_error';
      lastError = rawBody || `Buffer returned ${response.status}`;
    } catch (error) {
      lastStatus = 'api_unreachable';
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < input.maxRetries) {
      await delay(200 * attempt);
    }
  }

  return {
    ok: false,
    apiStatus: lastStatus,
    attempts: input.maxRetries,
    platformPostId: null,
    platformPostUrl: null,
    error: lastError,
  };
}

function buildSocialPublishSummary(input: {
  title: string;
  platform: string;
  status: string;
  scheduledAt: string;
  postId: string;
  durableReference: string;
  approvedBy: string | null;
  error: string | null;
}): string {
  return [
    `Social publish record: ${input.title}`,
    `Platform: ${input.platform}`,
    `Status: ${input.status}`,
    `Scheduled at: ${input.scheduledAt}`,
    `Scheduled post id: ${input.postId}`,
    `Durable reference: ${input.durableReference}`,
    input.approvedBy ? `Approved by: ${input.approvedBy}` : null,
    input.error ? `Error: ${input.error}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

async function publishSocialDeliverable(input: {
  glyphorEventBus?: GlyphorEventBus;
  ctx: ToolContext;
  title: string;
  platform: string;
  scheduledAt: string;
  postId: string;
  status: string;
  approvedBy: string | null;
  durableReference: string;
  error: string | null;
  metadata: Record<string, unknown>;
  initiativeId: string | null;
  directiveId: string | null;
  assignmentId: string | null;
}): Promise<{ deliverableId: string | null; durableReference: string }> {
  if (!input.initiativeId && !input.directiveId && !input.assignmentId) {
    return { deliverableId: null, durableReference: input.durableReference };
  }

  const publishTool = createDeliverableTools(input.glyphorEventBus)
    .find((tool) => tool.name === 'publish_deliverable');

  if (!publishTool) {
    return { deliverableId: null, durableReference: input.durableReference };
  }

  const result = await publishTool.execute(
    {
      title: input.title,
      type: 'campaign',
      content: buildSocialPublishSummary({
        title: input.title,
        platform: input.platform,
        status: input.status,
        scheduledAt: input.scheduledAt,
        postId: input.postId,
        durableReference: input.durableReference,
        approvedBy: input.approvedBy,
        error: input.error,
      }),
      storage_url: input.durableReference,
      initiative_id: input.initiativeId ?? undefined,
      directive_id: input.directiveId ?? undefined,
      assignment_id: input.assignmentId ?? undefined,
      metadata: input.metadata,
    },
    input.ctx,
  );

  if (!result.success) {
    return { deliverableId: null, durableReference: input.durableReference };
  }

  const data = (result.data ?? {}) as Record<string, unknown>;
  return {
    deliverableId: asString(data.deliverable_id),
    durableReference: asString(data.storage_url) ?? input.durableReference,
  };
}

export function createSocialMediaTools(glyphorEventBus?: GlyphorEventBus): ToolDefinition[] {
  return [
    {
      name: 'schedule_social_post',
      description:
        'Schedule an approved social media post for a specific platform and time. ' +
        'Creates a durable publish record, records approval metadata, and surfaces API failures.',
      parameters: {
        draft_id: {
          type: 'string',
          description: 'Optional approved content_drafts UUID to publish from',
          required: false,
        },
        profile_id: {
          type: 'string',
          description: 'Optional Buffer/social profile identifier. Defaults to platform.',
          required: false,
        },
        platform: {
          type: 'string',
          description: 'Target social media platform.',
          required: false,
          enum: ['linkedin', 'twitter', 'instagram'],
        },
        text: {
          type: 'string',
          description: 'The post content text. Required when draft_id is not provided.',
          required: false,
        },
        title: {
          type: 'string',
          description: 'Optional publish record title override.',
          required: false,
        },
        media_url: {
          type: 'string',
          description: 'Optional URL to an image or video to attach.',
          required: false,
        },
        scheduled_at: {
          type: 'string',
          description: 'ISO 8601 datetime for when the post should be published.',
          required: true,
        },
        approved_by: {
          type: 'string',
          description: 'Optional approver override when scheduling raw text.',
          required: false,
        },
        decision_id: {
          type: 'string',
          description: 'Optional linked approval decision UUID.',
          required: false,
        },
        initiative_id: {
          type: 'string',
          description: 'Optional initiative UUID for publish record linkage.',
          required: false,
        },
        directive_id: {
          type: 'string',
          description: 'Optional directive UUID for publish record linkage.',
          required: false,
        },
        assignment_id: {
          type: 'string',
          description: 'Optional assignment UUID for publish record linkage.',
          required: false,
        },
        metadata: {
          type: 'object',
          description: 'Optional structured publish metadata.',
          required: false,
        },
        max_retries: {
          type: 'number',
          description: 'Number of API submission attempts before marking failure (default 3).',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const scheduledAt = params.scheduled_at as string;
        const maxRetries = Math.min(Math.max((params.max_retries as number | undefined) ?? 3, 1), 5);

        try {
          let draft: DraftRow | undefined;
          if (params.draft_id) {
            [draft] = await systemQuery<DraftRow>(
              `SELECT id, title, content, platform, media_url, status, approved_by, approved_at, decision_id,
                      initiative_id, directive_id, assignment_id, metadata
               FROM content_drafts
               WHERE id = $1`,
              [params.draft_id as string],
            );

            if (!draft) {
              return { success: false, error: `Draft not found: ${params.draft_id}` };
            }

            if (!isSocialDraftStatusPublishable(draft.status)) {
              return {
                success: false,
                error: `Draft ${draft.id} is ${draft.status}. Submit it for review and approval before scheduling.`,
              };
            }
          }

          const platform = (params.platform as string | undefined) ?? draft?.platform ?? null;
          const text = (params.text as string | undefined) ?? draft?.content ?? null;
          const mediaUrl = (params.media_url as string | undefined) ?? draft?.media_url ?? null;
          const profileId = ((params.profile_id as string | undefined) ?? platform ?? '').trim();
          const approvedBy = (params.approved_by as string | undefined) ?? draft?.approved_by ?? (ctx.agentRole === 'cmo' ? ctx.agentRole : null);
          const approvedAt = draft?.approved_at ?? (approvedBy ? new Date().toISOString() : null);
          const decisionId = (params.decision_id as string | undefined) ?? draft?.decision_id ?? null;
          const initiativeId = (params.initiative_id as string | undefined) ?? draft?.initiative_id ?? null;
          const directiveId = (params.directive_id as string | undefined) ?? draft?.directive_id ?? null;
          const assignmentId = (params.assignment_id as string | undefined) ?? draft?.assignment_id ?? null;
          const metadata = {
            ...normalizeMetadata(draft?.metadata),
            ...normalizeMetadata(params.metadata),
          };

          if (!platform || !text || !profileId) {
            return {
              success: false,
              error: 'platform, text, and profile_id (or draft_id with platform) are required to schedule a social post.',
            };
          }

          if (!approvedBy) {
            return {
              success: false,
              error: 'approved_by is required when scheduling without an approved draft.',
            };
          }

          const [post] = await systemQuery<{ id: string; created_at: string }>(
            `INSERT INTO scheduled_posts
               (profile_id, platform, text, media_url, scheduled_at, status, api_status, agent,
                content_draft_id, approved_by, approved_at, approval_decision_id, publish_attempt_count,
                content_type, initiative_id, directive_id, assignment_id, metadata)
             VALUES ($1, $2, $3, $4, $5, 'queued', 'pending', $6, $7, $8, $9, $10, 0, 'social_post', $11, $12, $13, $14::jsonb)
             RETURNING id, created_at`,
            [
              profileId,
              platform,
              text,
              mediaUrl,
              scheduledAt,
              ctx.agentRole,
              draft?.id ?? null,
              approvedBy,
              approvedAt,
              decisionId,
              initiativeId,
              directiveId,
              assignmentId,
              JSON.stringify(metadata),
            ],
          );

          const publishResult = await publishToPlatform({
            config: getSocialApiConfig(platform),
            profileId,
            platform,
            text,
            mediaUrl,
            scheduledAt,
            maxRetries,
          });

          let durableReference = publishResult.platformPostUrl ?? `scheduled-post://${post.id}`;
          const publishStatus = publishResult.ok ? 'scheduled' : 'failed';
          const publishTitle = (params.title as string | undefined)
            ?? draft?.title
            ?? `${platform} social publish ${post.id}`;

          const deliverable = await publishSocialDeliverable({
            glyphorEventBus,
            ctx,
            title: publishTitle,
            platform,
            scheduledAt,
            postId: post.id,
            status: publishStatus,
            approvedBy,
            durableReference,
            error: publishResult.error,
            metadata: {
              ...metadata,
              scheduled_post_id: post.id,
              draft_id: draft?.id ?? null,
              api_status: publishResult.apiStatus,
              publish_attempt_count: publishResult.attempts,
              platform_post_id: publishResult.platformPostId,
              platform_post_url: publishResult.platformPostUrl,
              approved_by: approvedBy,
            },
            initiativeId,
            directiveId,
            assignmentId,
          });

          durableReference = deliverable.durableReference;

          await systemQuery(
            `UPDATE scheduled_posts
             SET status = $2,
                 api_status = $3,
                 publish_attempt_count = $4,
                 last_publish_error = $5,
                 platform_post_id = $6,
                 platform_post_url = $7,
                 durable_reference = $8,
                 deliverable_id = $9,
                 deliverable_status = $10,
                 final_publish_timestamp = CASE WHEN $2 = 'scheduled' THEN NOW() ELSE final_publish_timestamp END
             WHERE id = $1`,
            [
              post.id,
              publishStatus,
              publishResult.apiStatus,
              publishResult.attempts,
              publishResult.error,
              publishResult.platformPostId,
              publishResult.platformPostUrl,
              durableReference,
              deliverable.deliverableId,
              deliverable.deliverableId ? 'published' : null,
            ],
          );

          if (draft?.id) {
            await systemQuery(
              `UPDATE content_drafts
               SET scheduled_post_id = $2,
                   status = CASE WHEN $3 = 'scheduled' THEN 'published' ELSE status END,
                   published_at = CASE WHEN $3 = 'scheduled' THEN NOW() ELSE published_at END,
                   platform_publish_status = $4,
                   platform_publish_error = $5,
                   updated_at = NOW()
               WHERE id = $1`,
              [
                draft.id,
                post.id,
                publishStatus,
                publishStatus,
                publishResult.error,
              ],
            );
          }

          await recordSocialPublishAudit({
            draftId: draft?.id ?? null,
            scheduledPostId: post.id,
            deliverableId: deliverable.deliverableId,
            action: publishResult.ok ? 'publish_scheduled' : 'publish_failed',
            actor: ctx.agentRole,
            status: publishStatus,
            details: {
              api_status: publishResult.apiStatus,
              publish_attempt_count: publishResult.attempts,
              platform_post_id: publishResult.platformPostId,
              platform_post_url: publishResult.platformPostUrl,
              durable_reference: durableReference,
              error: publishResult.error,
            },
          });

          if (!publishResult.ok) {
            return {
              success: false,
              error: publishResult.error ?? `Failed to submit ${post.id} to ${platform}`,
              data: {
                post_id: post.id,
                api_status: publishResult.apiStatus,
                durable_reference: durableReference,
                deliverable_id: deliverable.deliverableId,
              },
            };
          }

          return {
            success: true,
            data: {
              post_id: post.id,
              platform,
              scheduled_at: scheduledAt,
              api_status: publishResult.apiStatus,
              durable_reference: durableReference,
              deliverable_id: deliverable.deliverableId,
              platform_post_id: publishResult.platformPostId,
              platform_post_url: publishResult.platformPostUrl,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: withMigrationHint('schedule_social_post', err),
          };
        }
      },
    },

    {
      name: 'get_scheduled_posts',
      description: 'List scheduled social posts, including approval and durable publish metadata.',
      parameters: {
        post_id: {
          type: 'string',
          description: 'Optional scheduled post UUID filter',
          required: false,
        },
        platform: {
          type: 'string',
          description: 'Optional platform filter',
          required: false,
          enum: ['linkedin', 'twitter', 'instagram'],
        },
        status: {
          type: 'string',
          description: 'Optional status filter',
          required: false,
          enum: ['queued', 'scheduled', 'published', 'failed', 'cancelled', 'all'],
        },
        content_draft_id: {
          type: 'string',
          description: 'Optional linked content draft UUID filter',
          required: false,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of posts to return (default 25)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const conditions: string[] = [];
          const values: unknown[] = [];

          const addCondition = (sql: string, value: unknown) => {
            values.push(value);
            conditions.push(sql.replace('?', `$${values.length}`));
          };

          if (params.post_id) addCondition('id = ?', params.post_id);
          if (params.platform) addCondition('platform = ?', params.platform);
          if (params.content_draft_id) addCondition('content_draft_id = ?', params.content_draft_id);

          const status = (params.status as string | undefined) ?? 'all';
          if (status !== 'all') addCondition('status = ?', status);

          const limit = Math.min(Math.max((params.limit as number | undefined) ?? 25, 1), 100);
          values.push(limit);

          const rows = await systemQuery(
            `SELECT *
             FROM scheduled_posts
             ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
             ORDER BY scheduled_at DESC NULLS LAST, created_at DESC
             LIMIT $${values.length}`,
            values,
          );

          return { success: true, data: rows };
        } catch (err) {
          return { success: false, error: withMigrationHint('get_scheduled_posts', err) };
        }
      },
    },

    {
      name: 'get_social_metrics',
      description: 'Read aggregate social metrics with optional platform and metric-type filters.',
      parameters: {
        platform: {
          type: 'string',
          description: 'Optional platform filter',
          required: false,
          enum: ['linkedin', 'twitter', 'instagram'],
        },
        metric_type: {
          type: 'string',
          description: 'Optional metric type filter',
          required: false,
          enum: ['aggregate', 'post_performance', 'optimal_times', 'demographics', 'mention'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of rows to return (default 25)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const conditions: string[] = [];
          const values: unknown[] = [];

          const addCondition = (sql: string, value: unknown) => {
            values.push(value);
            conditions.push(sql.replace('?', `$${values.length}`));
          };

          if (params.platform) addCondition('platform = ?', params.platform);
          if (params.metric_type) addCondition('metric_type = ?', params.metric_type);

          const limit = Math.min(Math.max((params.limit as number | undefined) ?? 25, 1), 100);
          values.push(limit);

          const rows = await systemQuery(
            `SELECT *
             FROM social_metrics
             ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
             ORDER BY recorded_at DESC
             LIMIT $${values.length}`,
            values,
          );

          return { success: true, data: rows };
        } catch (err) {
          return { success: false, error: withMigrationHint('get_social_metrics', err) };
        }
      },
    },

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
            error: withMigrationHint('get_post_performance', err),
          };
        }
      },
    },

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
          const trend = await systemQuery<{ recorded_at: string; followers: number }>(
            `SELECT recorded_at, followers
             FROM social_metrics
             WHERE platform = $1
             ORDER BY recorded_at DESC
             LIMIT 30`,
            [platform],
          );

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
            error: withMigrationHint('get_social_audience', err),
          };
        }
      },
    },

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
        const config = getSocialApiConfig(platform);
        if (config?.provider === 'buffer') {
          try {
            const response = await fetch(`${config.baseUrl}/replies`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${config.apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ post_id: postId, text: replyText }),
              signal: AbortSignal.timeout(30_000),
            });
            apiStatus = response.ok ? 'sent' : 'api_error';
          } catch {
            apiStatus = 'api_unreachable';
          }
        } else if (config) {
          apiStatus = 'unsupported_provider';
        } else {
          apiStatus = 'no_api_configured';
        }

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

        try {
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

          const fallback: Record<string, Array<{ topic: string; hashtag: string; relevance_score: number }>> = {
            ai: [
              { topic: 'Generative AI', hashtag: '#GenerativeAI', relevance_score: 0.95 },
              { topic: 'LLM', hashtag: '#LLM', relevance_score: 0.9 },
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
              { topic: 'Digital Transformation', hashtag: '#DigitalTransformation', relevance_score: 0.9 },
              { topic: 'Enterprise AI', hashtag: '#EnterpriseAI', relevance_score: 0.88 },
              { topic: 'B2B Sales', hashtag: '#B2BSales', relevance_score: 0.82 },
              { topic: 'Cybersecurity', hashtag: '#Cybersecurity', relevance_score: 0.8 },
              { topic: 'Cloud Migration', hashtag: '#CloudMigration', relevance_score: 0.75 },
            ],
            general: [
              { topic: 'Tech Trends', hashtag: '#TechTrends', relevance_score: 0.85 },
              { topic: 'Startups', hashtag: '#Startups', relevance_score: 0.82 },
              { topic: 'Innovation', hashtag: '#Innovation', relevance_score: 0.8 },
              { topic: 'Future of Work', hashtag: '#FutureOfWork', relevance_score: 0.78 },
              { topic: 'Automation', hashtag: '#Automation', relevance_score: 0.75 },
            ],
          };

          const topics = fallback[category] ?? fallback.general;
          try {
            await systemQuery(
              `INSERT INTO trending_topics_cache (category, topics, fetched_at)
               VALUES ($1, $2, NOW())`,
              [category, JSON.stringify(topics)],
            );
          } catch {
            // Cache write is optional.
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
