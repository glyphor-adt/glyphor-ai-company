/**
 * Content Tools — Content creation, management, and publishing
 *
 * Tools:
 *   create_content_draft      — Create a new content draft
 *   update_content_draft      — Edit an existing draft
 *   get_content_drafts        — List drafts with filters
 *   submit_content_for_review — Move a draft into review
 *   approve_content_draft     — Approve a draft for distribution
 *   reject_content_draft      — Reject a draft with feedback
 *   publish_content           — Move a non-social draft to published status
 *   get_content_metrics       — Read content performance metrics
 *   get_content_calendar      — View content pipeline by status and date
 *   generate_content_image    — Generate image for content using DALL-E 3
 */

import type { CompanyAgentRole, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

const PRISM_STYLE_AUGMENT =
  'Use the Glyphor Prism brand palette: deep indigo (#1E1B4B), electric violet (#7C3AED), ' +
  'soft lavender (#C4B5FD), crisp white (#FFFFFF). Clean, modern, geometric style with subtle gradients.';

const CONTENT_APPROVERS = new Set<CompanyAgentRole>(['cmo', 'chief-of-staff']);

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

function normalizeContentType(type: string): string {
  switch (type) {
    case 'blog':
      return 'blog_post';
    case 'social':
      return 'social_post';
    default:
      return type;
  }
}

function isSocialDraftType(type: string | null | undefined): boolean {
  return type === 'social' || type === 'social_post';
}

function withMigrationHint(toolName: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/column .* does not exist|relation .*social_publish_audit_log.* does not exist/i.test(message)) {
    return `${toolName} failed: ${message}. Apply migration 20260308002100_social_publish_workflow.sql.`;
  }

  return `${toolName} failed: ${message}`;
}

async function recordSocialPublishAudit(input: {
  draftId: string;
  actor: string;
  action: string;
  status: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await systemQuery(
      `INSERT INTO social_publish_audit_log
         (draft_id, action, actor, status, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        input.draftId,
        input.action,
        input.actor,
        input.status,
        JSON.stringify(input.details ?? {}),
      ],
    );
  } catch {
    // Audit writes should not block the primary workflow if the table is not yet present.
  }
}

export function createContentTools(): ToolDefinition[] {
  return [
    {
      name: 'create_content_draft',
      description: 'Create a new content draft in the content_drafts table.',
      parameters: {
        type: {
          type: 'string',
          description: 'Content type',
          required: true,
          enum: ['blog', 'blog_post', 'social', 'social_post', 'email', 'landing_page', 'case_study', 'press_release'],
        },
        title: {
          type: 'string',
          description: 'Title of the content draft',
          required: false,
        },
        content: {
          type: 'string',
          description: 'Body content of the draft',
          required: true,
        },
        platform: {
          type: 'string',
          description: 'Target platform (e.g. twitter, linkedin, blog)',
          required: false,
        },
        tags: {
          type: 'string',
          description: 'Comma-separated tags for categorization',
          required: false,
        },
        meta_description: {
          type: 'string',
          description: 'SEO meta description',
          required: false,
        },
        media_url: {
          type: 'string',
          description: 'Optional media URL tied to the draft',
          required: false,
        },
        campaign_type: {
          type: 'string',
          description: 'Associated campaign type',
          required: false,
        },
        initiative_id: {
          type: 'string',
          description: 'Optional initiative UUID for autonomy workflow linkage',
          required: false,
        },
        directive_id: {
          type: 'string',
          description: 'Optional directive UUID for autonomy workflow linkage',
          required: false,
        },
        assignment_id: {
          type: 'string',
          description: 'Optional assignment UUID for autonomy workflow linkage',
          required: false,
        },
        metadata: {
          type: 'object',
          description: 'Optional structured draft metadata',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const normalizedType = normalizeContentType(params.type as string);
          const metadata = normalizeMetadata(params.metadata);
          const [row] = await systemQuery<{ id: string; title: string | null; status: string; type: string }>(
            `INSERT INTO content_drafts
               (type, title, content, platform, tags, meta_description, media_url, campaign_type, status, author,
                initiative_id, directive_id, assignment_id, metadata, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, $12, $13::jsonb, NOW(), NOW())
             RETURNING id, title, status, type`,
            [
              normalizedType,
              (params.title as string | undefined) ?? null,
              params.content as string,
              (params.platform as string | undefined) ?? null,
              (params.tags as string | undefined) ?? null,
              (params.meta_description as string | undefined) ?? null,
              (params.media_url as string | undefined) ?? null,
              (params.campaign_type as string | undefined) ?? null,
              ctx.agentRole,
              (params.initiative_id as string | undefined) ?? null,
              (params.directive_id as string | undefined) ?? null,
              (params.assignment_id as string | undefined) ?? null,
              JSON.stringify(metadata),
            ],
          );

          return {
            success: true,
            data: {
              draft_id: row.id,
              status: row.status,
              title: row.title,
              type: row.type,
            },
          };
        } catch (err) {
          return { success: false, error: withMigrationHint('create_content_draft', err) };
        }
      },
    },

    {
      name: 'update_content_draft',
      description: 'Edit an existing content draft.',
      parameters: {
        draft_id: {
          type: 'string',
          description: 'ID of the draft to update',
          required: true,
        },
        title: {
          type: 'string',
          description: 'Updated title',
          required: false,
        },
        content: {
          type: 'string',
          description: 'Updated body content',
          required: false,
        },
        platform: {
          type: 'string',
          description: 'Updated platform',
          required: false,
        },
        tags: {
          type: 'string',
          description: 'Updated comma-separated tags',
          required: false,
        },
        meta_description: {
          type: 'string',
          description: 'Updated SEO meta description',
          required: false,
        },
        media_url: {
          type: 'string',
          description: 'Updated media URL',
          required: false,
        },
        campaign_type: {
          type: 'string',
          description: 'Updated campaign type',
          required: false,
        },
        metadata: {
          type: 'object',
          description: 'Updated draft metadata',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const setClauses: string[] = [];
          const values: unknown[] = [];
          let idx = 1;

          const pushField = (column: string, value: unknown) => {
            setClauses.push(`${column} = $${idx++}`);
            values.push(value);
          };

          if (params.title !== undefined) pushField('title', params.title as string);
          if (params.content !== undefined) pushField('content', params.content as string);
          if (params.platform !== undefined) pushField('platform', params.platform as string);
          if (params.tags !== undefined) pushField('tags', params.tags as string);
          if (params.meta_description !== undefined) pushField('meta_description', params.meta_description as string);
          if (params.media_url !== undefined) pushField('media_url', params.media_url as string);
          if (params.campaign_type !== undefined) pushField('campaign_type', params.campaign_type as string);
          if (params.metadata !== undefined) pushField('metadata', JSON.stringify(normalizeMetadata(params.metadata)));

          if (setClauses.length === 0) {
            return { success: false, error: 'No fields provided to update' };
          }

          const normalizedClauses = setClauses.map((clause) =>
            clause.startsWith('metadata =')
              ? clause.replace(/\$\d+$/, (token) => `${token}::jsonb`)
              : clause,
          );
          normalizedClauses.push('updated_at = NOW()');
          values.push(params.draft_id as string);

          const [row] = await systemQuery<{ id: string; title: string | null; status: string }>(
            `UPDATE content_drafts
             SET ${normalizedClauses.join(', ')}
             WHERE id = $${idx}
             RETURNING id, title, status`,
            values,
          );

          if (!row) {
            return { success: false, error: `Draft not found: ${params.draft_id}` };
          }

          return {
            success: true,
            data: {
              draft_id: row.id,
              title: row.title,
              status: row.status,
            },
          };
        } catch (err) {
          return { success: false, error: withMigrationHint('update_content_draft', err) };
        }
      },
    },

    {
      name: 'get_content_drafts',
      description: 'List content drafts with optional filters for review and publishing workflows.',
      parameters: {
        draft_id: {
          type: 'string',
          description: 'Optional draft UUID filter',
          required: false,
        },
        type: {
          type: 'string',
          description: 'Optional content type filter',
          required: false,
        },
        status: {
          type: 'string',
          description: 'Optional draft status filter',
          required: false,
          enum: ['draft', 'pending_approval', 'approved', 'published', 'rejected', 'all'],
        },
        platform: {
          type: 'string',
          description: 'Optional platform filter',
          required: false,
        },
        author: {
          type: 'string',
          description: 'Optional author/agent filter',
          required: false,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of drafts to return (default 25)',
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

          if (params.draft_id) addCondition('id = ?', params.draft_id);
          if (params.type) addCondition('type = ?', normalizeContentType(params.type as string));
          if (params.platform) addCondition('platform = ?', params.platform);
          if (params.author) addCondition('author = ?', params.author);

          const status = (params.status as string | undefined) ?? 'all';
          if (status !== 'all') addCondition('status = ?', status);

          const limit = Math.min(Math.max((params.limit as number | undefined) ?? 25, 1), 100);
          values.push(limit);

          const rows = await systemQuery(
            `SELECT *
             FROM content_drafts
             ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
             ORDER BY updated_at DESC, created_at DESC
             LIMIT $${values.length}`,
            values,
          );

          return { success: true, data: rows };
        } catch (err) {
          return { success: false, error: withMigrationHint('get_content_drafts', err) };
        }
      },
    },

    {
      name: 'submit_content_for_review',
      description: 'Submit a draft for approval before social scheduling or external publication.',
      parameters: {
        draft_id: {
          type: 'string',
          description: 'ID of the draft to submit for review',
          required: true,
        },
        review_notes: {
          type: 'string',
          description: 'Optional review context or requested changes',
          required: false,
        },
        decision_id: {
          type: 'string',
          description: 'Optional linked approval decision UUID',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const [row] = await systemQuery<{
            id: string;
            title: string | null;
            status: string;
            type: string;
            platform: string | null;
          }>(
            `UPDATE content_drafts
             SET status = 'pending_approval',
                 review_requested_by = $2,
                 review_requested_at = NOW(),
                 review_notes = COALESCE($3, review_notes),
                 decision_id = COALESCE($4, decision_id),
                 updated_at = NOW()
             WHERE id = $1
               AND status NOT IN ('published', 'rejected')
             RETURNING id, title, status, type, platform`,
            [
              params.draft_id as string,
              ctx.agentRole,
              (params.review_notes as string | undefined) ?? null,
              (params.decision_id as string | undefined) ?? null,
            ],
          );

          if (!row) {
            return {
              success: false,
              error: `Draft not found or no longer reviewable: ${params.draft_id}`,
            };
          }

          if (isSocialDraftType(row.type)) {
            await recordSocialPublishAudit({
              draftId: row.id,
              actor: ctx.agentRole,
              action: 'submitted_for_review',
              status: row.status,
              details: {
                platform: row.platform,
                review_notes: params.review_notes ?? null,
                decision_id: params.decision_id ?? null,
              },
            });
          }

          return {
            success: true,
            data: {
              draft_id: row.id,
              title: row.title,
              status: row.status,
              type: row.type,
            },
          };
        } catch (err) {
          return { success: false, error: withMigrationHint('submit_content_for_review', err) };
        }
      },
    },

    {
      name: 'approve_content_draft',
      description: 'Approve a content draft for distribution. Social drafts must be approved before scheduling.',
      parameters: {
        draft_id: {
          type: 'string',
          description: 'ID of the draft to approve',
          required: true,
        },
        approval_notes: {
          type: 'string',
          description: 'Optional approval notes',
          required: false,
        },
        decision_id: {
          type: 'string',
          description: 'Optional linked approval decision UUID',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!CONTENT_APPROVERS.has(ctx.agentRole)) {
          return {
            success: false,
            error: `${ctx.agentRole} is not allowed to approve content drafts.`,
          };
        }

        try {
          const [row] = await systemQuery<{
            id: string;
            title: string | null;
            status: string;
            type: string;
            platform: string | null;
          }>(
            `UPDATE content_drafts
             SET status = 'approved',
                 approved_by = $2,
                 approved_at = NOW(),
                 approval_notes = COALESCE($3, approval_notes),
                 decision_id = COALESCE($4, decision_id),
                 rejected_by = NULL,
                 rejected_at = NULL,
                 rejection_reason = NULL,
                 platform_publish_error = NULL,
                 updated_at = NOW()
             WHERE id = $1
               AND status <> 'published'
             RETURNING id, title, status, type, platform`,
            [
              params.draft_id as string,
              ctx.agentRole,
              (params.approval_notes as string | undefined) ?? null,
              (params.decision_id as string | undefined) ?? null,
            ],
          );

          if (!row) {
            return { success: false, error: `Draft not found or already published: ${params.draft_id}` };
          }

          if (isSocialDraftType(row.type)) {
            await recordSocialPublishAudit({
              draftId: row.id,
              actor: ctx.agentRole,
              action: 'approved',
              status: row.status,
              details: {
                platform: row.platform,
                approval_notes: params.approval_notes ?? null,
                decision_id: params.decision_id ?? null,
              },
            });
          }

          return {
            success: true,
            data: {
              draft_id: row.id,
              title: row.title,
              status: row.status,
              type: row.type,
              approved_by: ctx.agentRole,
            },
          };
        } catch (err) {
          return { success: false, error: withMigrationHint('approve_content_draft', err) };
        }
      },
    },

    {
      name: 'reject_content_draft',
      description: 'Reject a content draft and persist the rejection reason for revision.',
      parameters: {
        draft_id: {
          type: 'string',
          description: 'ID of the draft to reject',
          required: true,
        },
        rejection_reason: {
          type: 'string',
          description: 'Why the draft was rejected',
          required: true,
        },
        decision_id: {
          type: 'string',
          description: 'Optional linked approval decision UUID',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        if (!CONTENT_APPROVERS.has(ctx.agentRole)) {
          return {
            success: false,
            error: `${ctx.agentRole} is not allowed to reject content drafts.`,
          };
        }

        try {
          const [row] = await systemQuery<{
            id: string;
            title: string | null;
            status: string;
            type: string;
            platform: string | null;
          }>(
            `UPDATE content_drafts
             SET status = 'rejected',
                 rejected_by = $2,
                 rejected_at = NOW(),
                 rejection_reason = $3,
                 decision_id = COALESCE($4, decision_id),
                 updated_at = NOW()
             WHERE id = $1
               AND status <> 'published'
             RETURNING id, title, status, type, platform`,
            [
              params.draft_id as string,
              ctx.agentRole,
              params.rejection_reason as string,
              (params.decision_id as string | undefined) ?? null,
            ],
          );

          if (!row) {
            return { success: false, error: `Draft not found or already published: ${params.draft_id}` };
          }

          if (isSocialDraftType(row.type)) {
            await recordSocialPublishAudit({
              draftId: row.id,
              actor: ctx.agentRole,
              action: 'rejected',
              status: row.status,
              details: {
                platform: row.platform,
                rejection_reason: params.rejection_reason,
                decision_id: params.decision_id ?? null,
              },
            });
          }

          return {
            success: true,
            data: {
              draft_id: row.id,
              title: row.title,
              status: row.status,
              type: row.type,
            },
          };
        } catch (err) {
          return { success: false, error: withMigrationHint('reject_content_draft', err) };
        }
      },
    },

    {
      name: 'publish_content',
      description:
        'Move a non-social content draft to published status. Social drafts must be approved and published via schedule_social_post.',
      parameters: {
        draft_id: {
          type: 'string',
          description: 'ID of the draft to publish',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          const [draft] = await systemQuery<{
            id: string;
            title: string | null;
            type: string;
            status: string;
            approved_by: string | null;
          }>(
            `SELECT id, title, type, status, approved_by
             FROM content_drafts
             WHERE id = $1`,
            [params.draft_id as string],
          );

          if (!draft) {
            return { success: false, error: `Draft not found: ${params.draft_id}` };
          }

          if (isSocialDraftType(draft.type)) {
            return {
              success: false,
              error: 'Social drafts must go through review and schedule_social_post. Use approve_content_draft, then schedule_social_post.',
            };
          }

          const canApprove = CONTENT_APPROVERS.has(ctx.agentRole);
          if (draft.status === 'pending_approval' && !canApprove) {
            return {
              success: false,
              error: `Draft ${draft.id} is pending approval and cannot be published by ${ctx.agentRole}.`,
            };
          }

          const [row] = await systemQuery<{ id: string; title: string | null; type: string }>(
            `UPDATE content_drafts
             SET status = 'published',
                 published_at = NOW(),
                 approved_by = COALESCE(approved_by, $2),
                 approved_at = CASE WHEN approved_by IS NULL THEN NOW() ELSE approved_at END,
                 updated_at = NOW()
             WHERE id = $1
             RETURNING id, title, type`,
            [
              draft.id,
              canApprove ? ctx.agentRole : draft.approved_by,
            ],
          );

          return {
            success: true,
            data: {
              draft_id: row.id,
              title: row.title,
              type: row.type,
              status: 'published',
              published_at: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: withMigrationHint('publish_content', err) };
        }
      },
    },

    {
      name: 'get_content_metrics',
      description: 'Read content performance metrics with optional type and platform filters.',
      parameters: {
        content_type: {
          type: 'string',
          description: 'Optional content type filter',
          required: false,
        },
        platform: {
          type: 'string',
          description: 'Optional platform filter',
          required: false,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of metric rows to return (default 25)',
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

          if (params.content_type) addCondition('content_type = ?', params.content_type);
          if (params.platform) addCondition('platform = ?', params.platform);

          const limit = Math.min(Math.max((params.limit as number | undefined) ?? 25, 1), 100);
          values.push(limit);

          const rows = await systemQuery(
            `SELECT *
             FROM content_metrics
             ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
             ORDER BY recorded_at DESC
             LIMIT $${values.length}`,
            values,
          );

          return { success: true, data: rows };
        } catch (err) {
          return { success: false, error: withMigrationHint('get_content_metrics', err) };
        }
      },
    },

    {
      name: 'get_content_calendar',
      description: 'View the content pipeline grouped by status and scheduled date.',
      parameters: {
        date_from: {
          type: 'string',
          description: 'Start date filter (ISO 8601)',
          required: false,
        },
        date_to: {
          type: 'string',
          description: 'End date filter (ISO 8601)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const conditions: string[] = [];
          const values: unknown[] = [];
          let idx = 1;

          if (params.date_from) {
            conditions.push(`created_at >= $${idx++}`);
            values.push(params.date_from as string);
          }
          if (params.date_to) {
            conditions.push(`created_at <= $${idx++}`);
            values.push(params.date_to as string);
          }

          const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

          const rows = await systemQuery<{
            status: string;
            type: string;
            id: string;
            title: string | null;
            platform: string | null;
            created_at: string;
            published_at: string | null;
            review_requested_at: string | null;
          }>(
            `SELECT status, type, id, title, platform, created_at, published_at, review_requested_at
             FROM content_drafts ${where}
             ORDER BY status, created_at DESC`,
            values,
          );

          const calendar: Record<string, typeof rows> = {};
          for (const row of rows) {
            if (!calendar[row.status]) calendar[row.status] = [];
            calendar[row.status].push(row);
          }

          return {
            success: true,
            data: {
              calendar,
              total: rows.length,
            },
          };
        } catch (err) {
          return { success: false, error: withMigrationHint('get_content_calendar', err) };
        }
      },
    },

    {
      name: 'generate_content_image',
      description: 'Generate an image for content using DALL-E 3. Optionally constrain to Glyphor brand palette.',
      parameters: {
        prompt: {
          type: 'string',
          description: 'Image generation prompt',
          required: true,
        },
        style: {
          type: 'string',
          description: 'Visual style for the generated image',
          required: false,
          enum: ['illustration', 'photo', 'icon', 'abstract'],
        },
        dimensions: {
          type: 'string',
          description: 'Image dimensions',
          required: false,
          enum: ['1024x1024', '1792x1024', '1024x1792'],
        },
        brand_constrained: {
          type: 'boolean',
          description: 'When true, augments prompt with Prism palette and brand style info',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) {
            return { success: false, error: 'OPENAI_API_KEY not configured' };
          }

          const style = (params.style as string) || 'illustration';
          const dimensions = (params.dimensions as string) || '1024x1024';
          const brandConstrained = params.brand_constrained ?? false;

          let finalPrompt = `${params.prompt as string} (style: ${style})`;
          if (brandConstrained) {
            finalPrompt = `${finalPrompt}. ${PRISM_STYLE_AUGMENT}`;
          }

          const res = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: 'gpt-image-1.5-2025-12-16',
              prompt: finalPrompt,
              size: dimensions,
              quality: 'standard',
              n: 1,
            }),
            signal: AbortSignal.timeout(60_000),
          });

          if (!res.ok) {
            return { success: false, error: `DALL-E API returned ${res.status}: ${await res.text()}` };
          }

          const data = await res.json() as Record<string, unknown>;
          const images = data.data as Array<Record<string, unknown>> | undefined;
          const image = images?.[0];
          return {
            success: true,
            data: {
              url: image?.url,
              revised_prompt: image?.revised_prompt,
              dimensions,
              style,
              brand_constrained: brandConstrained,
            },
          };
        } catch (err) {
          return { success: false, error: `generate_content_image failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}
