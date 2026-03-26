/**
 * Roadmap Tools — Product roadmap planning & feature management
 *
 * Tools:
 *   create_roadmap_item  — Add a feature to the product roadmap
 *   score_feature_rice   — Calculate RICE prioritization score
 *   get_roadmap          — View the current roadmap with filters
 *   update_roadmap_item  — Update an existing roadmap item
 *   get_feature_requests — Aggregate feature requests from activity log
 *   manage_feature_flags — Toggle feature flags by segment
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createRoadmapTools(): ToolDefinition[] {
  return [
    /* ── create_roadmap_item ───────────────── */
    {
      name: 'create_roadmap_item',
      description:
        'Add a new feature or initiative to the product roadmap. ' +
        'Specify product, priority, effort, expected impact, and target quarter.',
      parameters: {
        title: {
          type: 'string',
          description: 'Short, descriptive name for the roadmap item.',
          required: true,
        },
        description: {
          type: 'string',
          description: 'Detailed description of the feature or initiative.',
          required: true,
        },
        product: {
          type: 'string',
          description: 'Which internal engine this item belongs to (web-build/pulse are internal engines, not external products).',
          enum: ['pulse', 'web-build'],
          required: true,
        },
        priority: {
          type: 'string',
          description: 'Priority level for the roadmap item.',
          enum: ['critical', 'high', 'medium', 'low'],
        },
        estimated_effort: {
          type: 'string',
          description: 'T-shirt size estimate for implementation effort.',
          enum: ['xs', 's', 'm', 'l', 'xl'],
        },
        expected_impact: {
          type: 'string',
          description: 'Expected business impact of shipping this feature.',
          enum: ['low', 'medium', 'high', 'transformative'],
        },
        target_quarter: {
          type: 'string',
          description: 'Target delivery quarter, e.g. "Q3 2025".',
        },
        status: {
          type: 'string',
          description: 'Current status of the roadmap item.',
          enum: ['proposed', 'planned', 'in_progress', 'shipped', 'deferred'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const {
          title, description, product, priority, estimated_effort,
          expected_impact, target_quarter, status,
        } = params;

        try {
          const [row] = await systemQuery<{ id: string }>(
            `INSERT INTO roadmap_items
               (title, description, product, priority, estimated_effort, expected_impact, target_quarter, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
              title,
              description,
              product,
              priority ?? 'medium',
              estimated_effort ?? null,
              expected_impact ?? null,
              target_quarter ?? null,
              status ?? 'proposed',
            ],
          );

          return {
            success: true,
            data: {
              id: row.id,
              message: `Roadmap item "${title}" created for ${product}.`,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to create roadmap item: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── score_feature_rice ────────────────── */
    {
      name: 'score_feature_rice',
      description:
        'Calculate a RICE prioritization score for a feature. ' +
        'RICE = (Reach × Impact × Confidence) / Effort. Use this to compare and rank features objectively.',
      parameters: {
        reach: {
          type: 'number',
          description: 'Number of users/customers affected per quarter.',
          required: true,
        },
        impact: {
          type: 'number',
          description: 'Impact score from 0.25 (minimal) to 3 (massive).',
          required: true,
        },
        confidence: {
          type: 'number',
          description: 'Confidence level from 0 (no data) to 1 (high confidence).',
          required: true,
        },
        effort: {
          type: 'number',
          description: 'Effort in person-months required to ship.',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const reach = Number(params.reach);
        const impact = Number(params.impact);
        const confidence = Number(params.confidence);
        const effort = Number(params.effort);

        if (effort <= 0) {
          return { success: false, error: 'Effort must be greater than 0.' };
        }
        if (impact < 0.25 || impact > 3) {
          return { success: false, error: 'Impact must be between 0.25 and 3.' };
        }
        if (confidence < 0 || confidence > 1) {
          return { success: false, error: 'Confidence must be between 0 and 1.' };
        }

        const riceScore = (reach * impact * confidence) / effort;
        const rounded = Math.round(riceScore * 100) / 100;

        let ranking: string;
        if (rounded >= 500) ranking = 'exceptional — prioritize immediately';
        else if (rounded >= 200) ranking = 'strong — high priority';
        else if (rounded >= 50) ranking = 'moderate — consider for next quarter';
        else ranking = 'low — defer or revisit assumptions';

        return {
          success: true,
          data: {
            rice_score: rounded,
            components: { reach, impact, confidence, effort },
            ranking,
          },
        };
      },
    },

    /* ── get_roadmap ───────────────────────── */
    {
      name: 'get_roadmap',
      description:
        'View the current platform roadmap. Filter by engine, quarter, status, or priority. ' +
        'Results are ordered by priority (critical first).',
      parameters: {
        product: {
          type: 'string',
          description: 'Filter by internal engine or view all.',
          enum: ['pulse', 'web-build', 'all'],
        },
        quarter: {
          type: 'string',
          description: 'Filter by target quarter, e.g. "Q3 2025".',
        },
        status: {
          type: 'string',
          description: 'Filter by item status.',
          enum: ['proposed', 'planned', 'in_progress', 'shipped', 'deferred'],
        },
        priority: {
          type: 'string',
          description: 'Filter by priority level.',
          enum: ['critical', 'high', 'medium', 'low'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const product = params.product as string | undefined;
        const quarter = params.quarter as string | undefined;
        const status = params.status as string | undefined;
        const priority = params.priority as string | undefined;

        const conditions: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (product && product !== 'all') {
          conditions.push(`product = $${idx++}`);
          values.push(product);
        }
        if (quarter) {
          conditions.push(`target_quarter = $${idx++}`);
          values.push(quarter);
        }
        if (status) {
          conditions.push(`status = $${idx++}`);
          values.push(status);
        }
        if (priority) {
          conditions.push(`priority = $${idx++}`);
          values.push(priority);
        }

        const whereClause = conditions.length > 0
          ? `WHERE ${conditions.join(' AND ')}`
          : '';

        try {
          const rows = await systemQuery(
            `SELECT id, title, description, product, priority, estimated_effort,
                    expected_impact, target_quarter, status, created_at, updated_at
             FROM roadmap_items
             ${whereClause}
             ORDER BY
               CASE priority
                 WHEN 'critical' THEN 0
                 WHEN 'high' THEN 1
                 WHEN 'medium' THEN 2
                 WHEN 'low' THEN 3
                 ELSE 4
               END,
               created_at DESC`,
            values,
          );

          return {
            success: true,
            data: {
              total: rows.length,
              filters: { product: product ?? 'all', quarter, status, priority },
              items: rows,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to fetch roadmap: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── update_roadmap_item ───────────────── */
    {
      name: 'update_roadmap_item',
      description:
        'Update an existing roadmap item. Change its status, priority, target quarter, or description.',
      parameters: {
        item_id: {
          type: 'string',
          description: 'ID of the roadmap item to update.',
          required: true,
        },
        status: {
          type: 'string',
          description: 'New status for the item.',
          enum: ['proposed', 'planned', 'in_progress', 'shipped', 'deferred'],
        },
        priority: {
          type: 'string',
          description: 'New priority level.',
          enum: ['critical', 'high', 'medium', 'low'],
        },
        target_quarter: {
          type: 'string',
          description: 'New target quarter, e.g. "Q4 2025".',
        },
        description: {
          type: 'string',
          description: 'Updated description.',
        },
      },
      async execute(params): Promise<ToolResult> {
        const itemId = params.item_id as string;
        const setClauses: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (params.status != null) {
          setClauses.push(`status = $${idx++}`);
          values.push(params.status);
        }
        if (params.priority != null) {
          setClauses.push(`priority = $${idx++}`);
          values.push(params.priority);
        }
        if (params.target_quarter != null) {
          setClauses.push(`target_quarter = $${idx++}`);
          values.push(params.target_quarter);
        }
        if (params.description != null) {
          setClauses.push(`description = $${idx++}`);
          values.push(params.description);
        }

        if (setClauses.length === 0) {
          return { success: false, error: 'No fields provided to update.' };
        }

        setClauses.push(`updated_at = NOW()`);
        values.push(itemId);

        try {
          const rows = await systemQuery(
            `UPDATE roadmap_items
             SET ${setClauses.join(', ')}
             WHERE id = $${idx}
             RETURNING id, title, product, status, priority, target_quarter, description, updated_at`,
            values,
          );

          if (rows.length === 0) {
            return { success: false, error: `Roadmap item '${itemId}' not found.` };
          }

          return {
            success: true,
            data: {
              message: `Roadmap item '${itemId}' updated.`,
              item: rows[0],
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to update roadmap item: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── get_feature_requests ──────────────── */
    {
      name: 'get_feature_requests',
      description:
        'Aggregate feature requests from the activity log. ' +
        'Returns request frequency and categories over the specified date range.',
      parameters: {
        date_range: {
          type: 'string',
          description: 'Time window to aggregate feature requests.',
          enum: ['30d', '90d', '180d'],
          required: true,
        },
        product: {
          type: 'string',
          description: 'Filter by internal engine or view all.',
          enum: ['pulse', 'web-build', 'all'],
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const dateRange = params.date_range as string;
        const product = params.product as string;
        const intervalStr = dateRange.replace(/(\d+)d$/, '$1 days');

        const productFilter = product !== 'all'
          ? `AND product = $2`
          : '';
        const values: unknown[] = [intervalStr];
        if (product !== 'all') values.push(product);

        try {
          const rows = await systemQuery(
            `SELECT
               COALESCE(details->>'category', 'uncategorized') AS category,
               COUNT(*) AS request_count,
               COUNT(DISTINCT details->>'customer_id') AS unique_requestors
             FROM activity_log
             WHERE action = 'feature_request'
               AND created_at >= NOW() - CAST($1 AS INTERVAL)
               ${productFilter}
             GROUP BY category
             ORDER BY request_count DESC`,
            values,
          );

          const total = rows.reduce((sum, r) => sum + Number(r.request_count), 0);

          return {
            success: true,
            data: {
              date_range: dateRange,
              product: product,
              total_requests: total,
              categories: rows,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to fetch feature requests: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    /* ── manage_feature_flags ──────────────── */
    {
      name: 'manage_feature_flags',
      description:
        'Toggle feature flags or check their current status. ' +
        'Optionally scope a flag to a specific user segment (beta, enterprise, or all).',
      parameters: {
        flag_name: {
          type: 'string',
          description: 'Name of the feature flag.',
          required: true,
        },
        action: {
          type: 'string',
          description: 'Action to perform on the flag.',
          enum: ['enable', 'disable', 'status'],
          required: true,
        },
        segment: {
          type: 'string',
          description: 'User segment to scope the flag to.',
          enum: ['all', 'beta', 'enterprise'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const flagName = params.flag_name as string;
        const action = params.action as string;
        const segment = (params.segment as string) ?? 'all';

        try {
          if (action === 'status') {
            const rows = await systemQuery(
              `SELECT details->>'enabled' AS enabled,
                      details->>'segment' AS segment,
                      created_at AS last_updated
               FROM activity_log
               WHERE action = 'feature_flag'
                 AND details->>'flag_name' = $1
               ORDER BY created_at DESC
               LIMIT 1`,
              [flagName],
            );

            if (rows.length === 0) {
              return {
                success: true,
                data: { flag_name: flagName, status: 'not_found', message: 'Flag has no recorded state.' },
              };
            }

            return {
              success: true,
              data: {
                flag_name: flagName,
                enabled: rows[0].enabled === 'true',
                segment: rows[0].segment,
                last_updated: rows[0].last_updated,
              },
            };
          }

          // enable or disable
          const enabled = action === 'enable';

          await systemQuery(
            `INSERT INTO activity_log (agent_role, action, summary, details)
             VALUES ('cpo', 'feature_flag', $1, jsonb_build_object(
               'flag_name', $1::text,
               'enabled', $2::text,
               'segment', $3::text
             ))`,
            [flagName, String(enabled), segment],
          );

          return {
            success: true,
            data: {
              flag_name: flagName,
              enabled,
              segment,
              message: `Feature flag '${flagName}' ${action}d for segment '${segment}'.`,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to manage feature flag: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  ];
}
