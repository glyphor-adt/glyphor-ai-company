/**
 * Deliverable Tools — Shared artifact publication and retrieval.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { GlyphorEventBus } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

const VALID_DELIVERABLE_TYPES = [
  'document',
  'design_asset',
  'code',
  'dataset',
  'strategy',
  'campaign',
] as const;

type DeliverableType = (typeof VALID_DELIVERABLE_TYPES)[number];

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

export function createDeliverableTools(
  glyphorEventBus?: GlyphorEventBus,
): ToolDefinition[] {
  return [
    {
      name: 'publish_deliverable',
      description:
        'Publish a shared deliverable tied to an initiative, directive, or assignment so downstream agents can consume it.',
      parameters: {
        title: { type: 'string', description: 'Deliverable title', required: true },
        type: {
          type: 'string',
          description: 'Deliverable type',
          required: true,
          enum: [...VALID_DELIVERABLE_TYPES],
        },
        content: {
          type: 'string',
          description: 'Inline deliverable content or summary',
          required: false,
        },
        storage_url: {
          type: 'string',
          description: 'Optional external storage URL (SharePoint, GCS, etc.)',
          required: false,
        },
        initiative_id: {
          type: 'string',
          description: 'Initiative UUID the deliverable supports',
          required: false,
        },
        directive_id: {
          type: 'string',
          description: 'Founder directive UUID the deliverable supports',
          required: false,
        },
        assignment_id: {
          type: 'string',
          description: 'Work assignment UUID this deliverable fulfills',
          required: false,
        },
        metadata: {
          type: 'object',
          description: 'Optional JSON metadata such as format, audience, or revision notes',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const type = params.type as string;
        if (!VALID_DELIVERABLE_TYPES.includes(type as DeliverableType)) {
          return {
            success: false,
            error: `Invalid deliverable type '${type}'. Use: ${VALID_DELIVERABLE_TYPES.join(', ')}`,
          };
        }

        if (!params.content && !params.storage_url) {
          return {
            success: false,
            error: 'Provide either content or storage_url when publishing a deliverable.',
          };
        }

        let initiativeId = (params.initiative_id as string | undefined) ?? null;
        let directiveId = (params.directive_id as string | undefined) ?? null;
        const assignmentId = (params.assignment_id as string | undefined) ?? null;

        if (!initiativeId && !directiveId && !assignmentId) {
          return {
            success: false,
            error: 'At least one of initiative_id, directive_id, or assignment_id is required.',
          };
        }

        if (assignmentId && (!initiativeId || !directiveId)) {
          const [assignment] = await systemQuery<{ directive_id: string | null }>(
            'SELECT directive_id FROM work_assignments WHERE id = $1',
            [assignmentId],
          );

          if (!assignment) {
            return { success: false, error: `Assignment ${assignmentId} not found.` };
          }

          directiveId = directiveId ?? assignment.directive_id ?? null;
        }

        if (directiveId && !initiativeId) {
          const [directive] = await systemQuery<{ initiative_id: string | null }>(
            'SELECT initiative_id FROM founder_directives WHERE id = $1',
            [directiveId],
          );
          initiativeId = directive?.initiative_id ?? null;
        }

        const metadata = normalizeMetadata(params.metadata);
        const [deliverable] = await systemQuery<{ id: string; created_at: string }>(
          `INSERT INTO deliverables
             (initiative_id, directive_id, assignment_id, title, type, content, storage_url, producing_agent, status, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'published', $9::jsonb)
            RETURNING id, created_at`,
          [
            initiativeId,
            directiveId,
            assignmentId,
            params.title,
            type,
            (params.content as string | undefined) ?? null,
            (params.storage_url as string | undefined) ?? null,
            ctx.agentRole,
            JSON.stringify(metadata),
          ],
        );

        if (!deliverable) {
          return {
            success: false,
            error: 'Failed to insert deliverable or read it back after insert.',
          };
        }

        await systemQuery(
          'INSERT INTO activity_log (agent_role, action, product, summary, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
          [
            ctx.agentRole,
            'deliverable.published',
            'company',
            `Published deliverable: ${params.title as string}`,
            JSON.stringify({
              deliverable_id: deliverable.id,
              initiative_id: initiativeId,
              directive_id: directiveId,
              assignment_id: assignmentId,
              type,
            }),
          ],
        );

        if (glyphorEventBus) {
          await glyphorEventBus.emit({
            type: 'deliverable.published' as any,
            source: ctx.agentRole,
            payload: {
              deliverable_id: deliverable.id,
              initiative_id: initiativeId,
              directive_id: directiveId,
              assignment_id: assignmentId,
              type,
              title: params.title,
            },
            priority: 'normal',
          });
        }

        return {
          success: true,
          data: {
            deliverable_id: deliverable.id,
            initiative_id: initiativeId,
            directive_id: directiveId,
            assignment_id: assignmentId,
            status: 'published',
          },
        };
      },
    },
    {
      name: 'get_deliverables',
      description:
        'Retrieve published deliverables by initiative, directive, assignment, type, or producing agent.',
      parameters: {
        initiative_id: {
          type: 'string',
          description: 'Optional initiative UUID filter',
          required: false,
        },
        directive_id: {
          type: 'string',
          description: 'Optional directive UUID filter',
          required: false,
        },
        assignment_id: {
          type: 'string',
          description: 'Optional assignment UUID filter',
          required: false,
        },
        type: {
          type: 'string',
          description: 'Optional deliverable type filter',
          required: false,
          enum: [...VALID_DELIVERABLE_TYPES],
        },
        producing_agent: {
          type: 'string',
          description: 'Optional producing agent role filter',
          required: false,
        },
        status: {
          type: 'string',
          description: 'Optional deliverable status filter',
          required: false,
          enum: ['draft', 'published', 'superseded', 'all'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of deliverables to return (default 25)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const conditions: string[] = [];
        const queryParams: unknown[] = [];

        const addCondition = (sql: string, value: unknown) => {
          queryParams.push(value);
          conditions.push(sql.replace('?', `$${queryParams.length}`));
        };

        if (params.initiative_id) addCondition('initiative_id = ?', params.initiative_id);
        if (params.directive_id) addCondition('directive_id = ?', params.directive_id);
        if (params.assignment_id) addCondition('assignment_id = ?', params.assignment_id);
        if (params.type) addCondition('type = ?', params.type);
        if (params.producing_agent) addCondition('producing_agent = ?', params.producing_agent);

        const status = (params.status as string | undefined) ?? 'published';
        if (status !== 'all') addCondition('status = ?', status);

        const limit = Math.min(Math.max((params.limit as number | undefined) ?? 25, 1), 100);
        queryParams.push(limit);

        const sql = `SELECT *
          FROM deliverables
          ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
          ORDER BY created_at DESC
          LIMIT $${queryParams.length}`;

        const deliverables = await systemQuery(sql, queryParams);
        const publishedIds = (deliverables as Array<{ id: string; status: string }>)
          .filter((row) => row.status === 'published')
          .map((row) => row.id);

        if (publishedIds.length > 0) {
          await systemQuery(
            `UPDATE deliverables
             SET consumed_by = (
               SELECT ARRAY(
                 SELECT DISTINCT consumer
                 FROM unnest(
                   COALESCE(consumed_by, ARRAY[]::text[]) || ARRAY[$1]::text[]
                 ) AS consumer
               )
             )
             WHERE id = ANY($2)`,
            [ctx.agentRole, publishedIds],
          );
        }

        return { success: true, data: deliverables };
      },
    },
  ];
}
