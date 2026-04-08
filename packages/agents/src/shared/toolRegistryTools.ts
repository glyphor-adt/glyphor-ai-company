/**
 * CTO Tool Registry Management Tools
 *
 * Allows CTO/admin reviewers to approve and register new tools from the
 * tool_requests pipeline. Requests may be self-served, but activation is not.
 *
 *   1. Any agent → request_new_tool → tool_requests (pending)
 *   2. CTO reviews → approve/reject → tool_requests (approved/rejected)
 *   3. CTO registers → register_tool → tool_registry (active)
 *   4. Grant tool to requester → grant_tool_access
 */

import type { ToolDefinition, ToolResult, ApiToolConfig } from '@glyphor/agent-runtime';
import { refreshDynamicToolCache } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

const REGISTRY_REVIEWERS = new Set(['cto', 'global-admin', 'kristina', 'system']);
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function deactivateMalformedActiveRegistryEntries(): Promise<string[]> {
  const rows = await systemQuery<{ name: string }>(
    `UPDATE tool_registry
        SET is_active = false,
            updated_at = NOW()
      WHERE is_active = true
        AND (name IS NULL OR name !~ '^[a-z][a-z0-9_]{2,63}$')
      RETURNING name`,
  );

  if (rows.length > 0) {
    await refreshDynamicToolCache();
  }

  return rows.map((row) => row.name);
}

export function createToolRegistryTools(): ToolDefinition[] {
  return [
    {
      name: 'list_tool_requests',
      description:
        'List pending tool requests from agents. Shows who requested what tool and why. ' +
        'Filter by status: pending (default, includes pending_approval), approved, rejected, building, completed.',
      parameters: {
        status: {
          type: 'string',
          description: 'Filter by status (default: "pending", which also includes "pending_approval")',
          enum: ['pending', 'pending_approval', 'approved', 'rejected', 'building', 'completed'],
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
          // When filtering by 'pending', also include 'pending_approval' rows.
          // Restricted tool requests go through a Yellow decision flow and may be
          // stored with status 'pending_approval' rather than plain 'pending'.
          const statusFilter = status === 'pending'
            ? ['pending', 'pending_approval']
            : [status];

          const data = await systemQuery(
            'SELECT id, requested_by, tool_name, description, justification, use_case, suggested_category, suggested_api_config, suggested_parameters, status, created_at FROM tool_requests WHERE status = ANY($1) ORDER BY created_at DESC LIMIT $2',
            [statusFilter, limit],
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
        'and can then be registered. Rejected requests get review notes explaining why. ' +
        'Use the "id" field from list_tool_requests as the request_id.',
      parameters: {
        request_id: {
          type: 'string',
          description: 'UUID of the tool request to review. Use the "id" field returned by list_tool_requests.',
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
        if (!REGISTRY_REVIEWERS.has(ctx.agentRole)) {
          return { success: false, error: 'Only CTO/admin roles can review tool requests.' };
        }

        const requestId = typeof params.request_id === 'string' ? params.request_id.trim() : '';
        const action = params.action as 'approve' | 'reject';
        const notes = params.review_notes as string;

        if (!requestId) {
          return { success: false, error: 'request_id is required. Pass the "id" field from list_tool_requests.' };
        }

        const newStatus = action === 'approve' ? 'approved' : 'rejected';

        try {
          // First, look up the request to give a precise error if something is wrong.
          const [existing] = await systemQuery<{ id: string; status: string; tool_name: string; requested_by: string }>(
            'SELECT id, status, tool_name, requested_by FROM tool_requests WHERE id = $1',
            [requestId],
          );

          if (!existing) {
            return { success: false, error: `Tool request "${requestId}" not found.` };
          }

          // Accept both 'pending' and 'pending_approval' — the latter is used for
          // restricted-tool requests that went through the Yellow decision flow.
          const reviewableStatuses = ['pending', 'pending_approval'];
          if (!reviewableStatuses.includes(existing.status)) {
            return {
              success: false,
              error: `Tool request "${requestId}" cannot be reviewed: current status is "${existing.status}". Only pending requests can be approved or rejected.`,
            };
          }

          const rows = await systemQuery(
            'UPDATE tool_requests SET status = $1, reviewed_by = $2, review_notes = $3 WHERE id = $4 AND status = ANY($5) RETURNING id, tool_name, requested_by, status',
            [newStatus, ctx.agentRole, notes, requestId, reviewableStatuses],
          );

          if (rows.length === 0) {
            // This can happen in a race condition where two processes concurrently
            // select the same pending request and both pass the status check above,
            // but only the first UPDATE succeeds. Return a clear message.
            return {
              success: false,
              error: `Tool request "${requestId}" could not be updated — it may have already been reviewed by another process.`,
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
        if (!REGISTRY_REVIEWERS.has(ctx.agentRole)) {
          return { success: false, error: 'Only CTO/admin roles can activate tools in the registry.' };
        }

        const cleanupDeactivated = await deactivateMalformedActiveRegistryEntries();
        const toolName = typeof params.name === 'string' ? params.name.trim() : '';

        // Validate name format
        if (!TOOL_NAME_PATTERN.test(toolName)) {
          return {
            success: false,
            error:
              'Tool name must be snake_case, start with a letter, and be 3–64 characters.',
          };
        }

        if (!isRecord(params.parameters_schema)) {
          return {
            success: false,
            error: 'parameters_schema must be an object before a tool can be registered.',
          };
        }

        if (params.api_config != null && !isRecord(params.api_config)) {
          return {
            success: false,
            error: 'api_config must be an object when provided.',
          };
        }

        const requestId = typeof params.request_id === 'string' ? params.request_id.trim() : undefined;
        if (requestId) {
          const [request] = await systemQuery<{ id: string; status: string; tool_name: string }>(
            'SELECT id, status, tool_name FROM tool_requests WHERE id = $1',
            [requestId],
          );

          if (!request) {
            return { success: false, error: `Tool request "${requestId}" not found.` };
          }

          if (request.status !== 'approved') {
            return {
              success: false,
              error: `Tool request "${requestId}" must be approved before registry activation (current status: "${request.status}").`,
            };
          }

          if (request.tool_name !== toolName) {
            return {
              success: false,
              error: `Tool request "${requestId}" is for "${request.tool_name}", not "${toolName}".`,
            };
          }
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
               (params.api_config as unknown as ApiToolConfig) ?? null,
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
        if (requestId) {
          await systemQuery(
            'UPDATE tool_requests SET status = $1, built_by = $2 WHERE id = $3 AND status = $4',
            ['completed', ctx.agentRole, requestId, 'approved'],
          );
        }

        return {
          success: true,
          data: {
            registered: true,
            tool_name: toolName,
            deactivated_malformed_entries: cleanupDeactivated,
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
          const cleanupDeactivated = await deactivateMalformedActiveRegistryEntries();
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
            data: {
              count: data.length,
              tools: data,
              deactivated_malformed_entries: cleanupDeactivated,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}
