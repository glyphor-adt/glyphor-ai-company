/**
 * CTO Tool Registry Management Tools
 *
 * Allows Marcus (CTO) to review, approve, and register new tools
 * from the tool_requests pipeline. This completes the self-service
 * tool creation workflow:
 *
 *   1. Any agent → request_new_tool → tool_requests (pending)
 *   2. CTO reviews → approve/reject → tool_requests (approved/rejected)
 *   3. CTO registers → register_tool → tool_registry (active)
 *   4. Grant tool to requester → grant_tool_access
 */

import type { ToolDefinition, ToolResult, ApiToolConfig } from '@glyphor/agent-runtime';
import { refreshDynamicToolCache } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createToolRegistryTools(): ToolDefinition[] {
  return [
    {
      name: 'list_tool_requests',
      description:
        'List pending tool requests from agents. Shows who requested what tool and why. ' +
        'Filter by status: pending (default), approved, rejected, building, completed.',
      parameters: {
        status: {
          type: 'string',
          description: 'Filter by status (default: "pending")',
          enum: ['pending', 'approved', 'rejected', 'building', 'completed'],
          required: false,
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 20)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const status = (params.status as string) ?? 'pending';
        const limit = (params.limit as number) ?? 20;

        try {
          const data = await systemQuery(
            'SELECT id, requested_by, tool_name, description, justification, use_case, suggested_category, suggested_api_config, suggested_parameters, status, created_at FROM tool_requests WHERE status = $1 ORDER BY created_at DESC LIMIT $2',
            [status, limit],
          );
          return {
            success: true,
            data: { count: data.length, requests: data },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'review_tool_request',
      description:
        'Approve or reject a tool request. Approved requests move to "approved" status ' +
        'and can then be registered. Rejected requests get review notes explaining why.',
      parameters: {
        request_id: {
          type: 'string',
          description: 'UUID of the tool request to review',
          required: true,
        },
        action: {
          type: 'string',
          description: 'Approve or reject the request',
          enum: ['approve', 'reject'],
          required: true,
        },
        review_notes: {
          type: 'string',
          description: 'Explanation for the decision — required for rejections, recommended for approvals.',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const requestId = params.request_id as string;
        const action = params.action as 'approve' | 'reject';
        const notes = params.review_notes as string;

        const newStatus = action === 'approve' ? 'approved' : 'rejected';

        try {
          const rows = await systemQuery(
            'UPDATE tool_requests SET status = $1, reviewed_by = $2, review_notes = $3 WHERE id = $4 AND status = $5 RETURNING id, tool_name, requested_by, status',
            [newStatus, ctx.agentRole, notes, requestId, 'pending'],
          );

          if (rows.length === 0) {
            return {
              success: false,
              error: 'Request not found or not in pending status.',
            };
          }

          const data = rows[0];
          return {
            success: true,
            data: {
              ...data,
              message:
                action === 'approve'
                  ? `Approved. Use register_tool to build and register "${data.tool_name}".`
                  : `Rejected. ${data.requested_by} will be notified.`,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'register_tool',
      description:
        'Register a new tool in the dynamic tool registry. The tool becomes immediately available ' +
        'for granting to agents. If this fulfills a tool request, link it via request_id to mark the request completed. ' +
        'For API-based tools, provide api_config so the tool can be executed dynamically.',
      parameters: {
        name: {
          type: 'string',
          description:
            'Tool name (snake_case, 3–64 chars). Must not already exist in static or dynamic registry.',
          required: true,
        },
        description: {
          type: 'string',
          description: 'What the tool does — used in LLM tool descriptions.',
          required: true,
        },
        category: {
          type: 'string',
          description: 'Category (e.g., "integration", "analytics", "communication", "data")',
          required: true,
        },
        parameters_schema: {
          type: 'object',
          description:
            'Parameter schema for the tool. Object of { param_name: { type, description, required } }.',
          required: true,
        },
        api_config: {
          type: 'object',
          description:
            'API configuration for external-API tools. Keys: method (GET/POST), url_template (with {{param}} placeholders), ' +
            'headers_template, body_template, auth_type (bearer_env/header_env/none), auth_env_var, response_path (jq-like path).',
          required: false,
        },
        request_id: {
          type: 'string',
          description: 'Optional: tool_requests UUID this registration fulfills. Marks the request as completed.',
          required: false,
        },
        tags: {
          type: 'array',
          description: 'Optional: tags for categorization and discovery',
          required: false,
          items: { type: 'string', description: 'Tag value' },
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const toolName = params.name as string;

        // Validate name format
        if (!/^[a-z][a-z0-9_]{2,63}$/.test(toolName)) {
          return {
            success: false,
            error:
              'Tool name must be snake_case, start with a letter, and be 3–64 characters.',
          };
        }

        // Insert into tool_registry
        try {
          await systemQuery(
            'INSERT INTO tool_registry (name, description, category, parameters, api_config, created_by, approved_by, is_active, tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [
              toolName,
              params.description as string,
              params.category as string,
              params.parameters_schema,
              (params.api_config as ApiToolConfig) ?? null,
              ctx.agentRole,
              ctx.agentRole,
              true,
              (params.tags as string[]) ?? [],
            ],
          );
        } catch (insertErr) {
          if ((insertErr as Error).message.includes('duplicate key')) {
            return {
              success: false,
              error: `Tool "${toolName}" already exists in the registry.`,
            };
          }
          return { success: false, error: (insertErr as Error).message };
        }

        // Refresh dynamic tool cache so isKnownTool sees it immediately
        await refreshDynamicToolCache();

        // If fulfilling a request, mark it completed
        const requestId = params.request_id as string | undefined;
        if (requestId) {
          await systemQuery(
            'UPDATE tool_requests SET status = $1, built_by = $2 WHERE id = $3',
            ['completed', ctx.agentRole, requestId],
          );
        }

        return {
          success: true,
          data: {
            registered: true,
            tool_name: toolName,
            message:
              `Tool "${toolName}" registered and active. ` +
              `Use grant_tool_access to grant it to agents who need it.` +
              (requestId
                ? ` Request ${requestId} marked as completed.`
                : ''),
          },
        };
      },
    },

    {
      name: 'deactivate_tool',
      description:
        'Deactivate a dynamically registered tool. The tool will no longer be grantable or usable. ' +
        'Does not affect statically defined (code-built) tools.',
      parameters: {
        tool_name: {
          type: 'string',
          description: 'Name of the tool to deactivate',
          required: true,
        },
        reason: {
          type: 'string',
          description: 'Why the tool is being deactivated',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const toolName = params.tool_name as string;

        try {
          const data = await systemQuery(
            'UPDATE tool_registry SET is_active = false WHERE name = $1 AND is_active = true RETURNING name',
            [toolName],
          );

          if (data.length === 0) {
            return {
              success: false,
              error: `Tool "${toolName}" not found in dynamic registry or already inactive.`,
            };
          }

          await refreshDynamicToolCache();

          return {
            success: true,
            data: { deactivated: true, tool_name: toolName },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'list_registered_tools',
      description:
        'List all dynamically registered tools in the tool_registry. Shows name, description, category, usage stats.',
      parameters: {
        category: {
          type: 'string',
          description: 'Optional: filter by category',
          required: false,
        },
        include_inactive: {
          type: 'boolean',
          description: 'Include deactivated tools (default: false)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const conditions: string[] = [];
          const queryParams: unknown[] = [];

          if (!params.include_inactive) {
            conditions.push('is_active = true');
          }

          if (params.category) {
            queryParams.push(params.category as string);
            conditions.push(`category = $${queryParams.length}`);
          }

          const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
          const data = await systemQuery(
            `SELECT name, description, category, created_by, is_active, usage_count, last_used_at, tags, created_at FROM tool_registry ${whereClause} ORDER BY created_at DESC LIMIT 50`,
            queryParams,
          );

          return {
            success: true,
            data: { count: data.length, tools: data },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}
