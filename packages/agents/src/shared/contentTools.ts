/**
 * Content Tools — Content creation, management, and publishing
 *
 * Tools:
 *   create_content_draft   — Create a new content draft
 *   update_content_draft   — Edit an existing draft
 *   get_content_drafts     — List drafts with filters
 *   publish_content        — Move draft to published status
 *   get_content_metrics    — Read content performance metrics
 *   get_content_calendar   — View content pipeline by status and date
 *   generate_content_image — Generate image for content using DALL-E 3
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

const PRISM_STYLE_AUGMENT =
  'Use the Glyphor Prism brand palette: deep indigo (#1E1B4B), electric violet (#7C3AED), ' +
  'soft lavender (#C4B5FD), crisp white (#FFFFFF). Clean, modern, geometric style with subtle gradients.';

export function createContentTools(): ToolDefinition[] {
  return [
    // ── create_content_draft ────────────────────────────────────────────
    {
      name: 'create_content_draft',
      description: 'Create a new content draft in the content_drafts table.',
      parameters: {
        type: {
          type: 'string',
          description: 'Content type',
          required: true,
          enum: ['blog', 'social', 'email', 'landing_page', 'case_study', 'press_release'],
        },
        title: {
          type: 'string',
          description: 'Title of the content draft',
          required: true,
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
        campaign_type: {
          type: 'string',
          description: 'Associated campaign type',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const [row] = await systemQuery<{ id: string }>(
            `INSERT INTO content_drafts (type, title, content, platform, tags, meta_description, campaign_type, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', NOW()) RETURNING id`,
            [
              params.type as string,
              params.title as string,
              params.content as string,
              (params.platform as string) || null,
              (params.tags as string) || null,
              (params.meta_description as string) || null,
              (params.campaign_type as string) || null,
            ],
          );

          return {
            success: true,
            data: {
              draft_id: row.id,
              status: 'draft',
              title: params.title,
              type: params.type,
            },
          };
        } catch (err) {
          return { success: false, error: `create_content_draft failed: ${(err as Error).message}` };
        }
      },
    },

    // ── update_content_draft ────────────────────────────────────────────
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
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const setClauses: string[] = [];
          const values: unknown[] = [];
          let idx = 1;

          if (params.title !== undefined) {
            setClauses.push(`title = $${idx++}`);
            values.push(params.title as string);
          }
          if (params.content !== undefined) {
            setClauses.push(`content = $${idx++}`);
            values.push(params.content as string);
          }
          if (params.tags !== undefined) {
            setClauses.push(`tags = $${idx++}`);
            values.push(params.tags as string);
          }
          if (params.meta_description !== undefined) {
            setClauses.push(`meta_description = $${idx++}`);
            values.push(params.meta_description as string);
          }

          if (setClauses.length === 0) {
            return { success: false, error: 'No fields provided to update' };
          }

          setClauses.push(`updated_at = NOW()`);
          values.push(params.draft_id as string);

          const [row] = await systemQuery<{ id: string; title: string; status: string }>(
            `UPDATE content_drafts SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING id, title, status`,
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
              updated_fields: setClauses.filter((c) => !c.startsWith('updated_at')).map((c) => c.split(' = ')[0]),
            },
          };
        } catch (err) {
          return { success: false, error: `update_content_draft failed: ${(err as Error).message}` };
        }
      },
    },

    // ── get_content_drafts ──────────────────────────────────────────────
    {
      name: 'get_content_drafts',
      description: 'List content drafts with optional filters.',
      parameters: {
        status: {
          type: 'string',
          description: 'Filter by draft status',
          required: false,
          enum: ['draft', 'review', 'approved', 'published', 'archived'],
        },
        type: {
          type: 'string',
          description: 'Filter by content type',
          required: false,
        },
        platform: {
          type: 'string',
          description: 'Filter by target platform',
          required: false,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of drafts to return (default: 20)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const conditions: string[] = [];
          const values: unknown[] = [];
          let idx = 1;

          if (params.status) {
            conditions.push(`status = $${idx++}`);
            values.push(params.status as string);
          }
          if (params.type) {
            conditions.push(`type = $${idx++}`);
            values.push(params.type as string);
          }
          if (params.platform) {
            conditions.push(`platform = $${idx++}`);
            values.push(params.platform as string);
          }

          const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
          const limit = Math.min((params.limit as number) || 20, 100);

          const rows = await systemQuery<{
            id: string;
            type: string;
            title: string;
            status: string;
            platform: string;
            tags: string;
            created_at: string;
          }>(
            `SELECT id, type, title, status, platform, tags, created_at
             FROM content_drafts ${where}
             ORDER BY created_at DESC
             LIMIT ${limit}`,
            values,
          );

          return {
            success: true,
            data: {
              drafts: rows,
              count: rows.length,
            },
          };
        } catch (err) {
          return { success: false, error: `get_content_drafts failed: ${(err as Error).message}` };
        }
      },
    },

    // ── publish_content ─────────────────────────────────────────────────
    {
      name: 'publish_content',
      description:
        'Move a content draft to published status. This is a CMO-level action ' +
        'that marks content as approved for distribution.',
      parameters: {
        draft_id: {
          type: 'string',
          description: 'ID of the draft to publish',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const [row] = await systemQuery<{ id: string; title: string; type: string }>(
            `UPDATE content_drafts SET status = 'published', published_at = NOW(), updated_at = NOW()
             WHERE id = $1 RETURNING id, title, type`,
            [params.draft_id as string],
          );

          if (!row) {
            return { success: false, error: `Draft not found: ${params.draft_id}` };
          }

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
          return { success: false, error: `publish_content failed: ${(err as Error).message}` };
        }
      },
    },

    // ── get_content_metrics ─────────────────────────────────────────────
    {
      name: 'get_content_metrics',
      description: 'Read content performance metrics including views, shares, engagement, and conversions.',
      parameters: {
        type: {
          type: 'string',
          description: 'Filter by content type',
          required: false,
        },
        platform: {
          type: 'string',
          description: 'Filter by platform',
          required: false,
        },
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
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 20)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const conditions: string[] = [];
          const values: unknown[] = [];
          let idx = 1;

          if (params.type) {
            conditions.push(`type = $${idx++}`);
            values.push(params.type as string);
          }
          if (params.platform) {
            conditions.push(`platform = $${idx++}`);
            values.push(params.platform as string);
          }
          if (params.date_from) {
            conditions.push(`recorded_at >= $${idx++}`);
            values.push(params.date_from as string);
          }
          if (params.date_to) {
            conditions.push(`recorded_at <= $${idx++}`);
            values.push(params.date_to as string);
          }

          const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
          const limit = Math.min((params.limit as number) || 20, 100);

          const rows = await systemQuery<{
            id: string;
            content_id: string;
            type: string;
            platform: string;
            views: number;
            shares: number;
            engagement: number;
            conversions: number;
            recorded_at: string;
          }>(
            `SELECT id, content_id, type, platform, views, shares, engagement, conversions, recorded_at
             FROM content_metrics ${where}
             ORDER BY recorded_at DESC
             LIMIT ${limit}`,
            values,
          );

          return {
            success: true,
            data: {
              metrics: rows,
              count: rows.length,
            },
          };
        } catch (err) {
          return { success: false, error: `get_content_metrics failed: ${(err as Error).message}` };
        }
      },
    },

    // ── get_content_calendar ────────────────────────────────────────────
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
            title: string;
            platform: string;
            created_at: string;
            published_at: string;
          }>(
            `SELECT status, type, id, title, platform, created_at, published_at
             FROM content_drafts ${where}
             ORDER BY status, created_at DESC`,
            values,
          );

          // Group by status
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
          return { success: false, error: `get_content_calendar failed: ${(err as Error).message}` };
        }
      },
    },

    // ── generate_content_image ──────────────────────────────────────────
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
