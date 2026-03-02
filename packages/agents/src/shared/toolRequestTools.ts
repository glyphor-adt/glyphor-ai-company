/**
 * Shared Tool Request Tools
 *
 * Allows any agent to request a new tool that doesn't exist yet.
 * Requests are stored in the `tool_requests` table and routed through
 * the decision system (Yellow tier) for CTO review and approval.
 *
 * Also provides request_tool_access for agents to self-service access
 * to existing tools they don't currently have.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { isKnownTool, invalidateGrantCache } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createToolRequestTools(): ToolDefinition[] {
  return [
    {
      name: 'request_new_tool',
      description:
        'Request a new tool capability that does not currently exist in the system. ' +
        'Creates a tool request for CTO review. Include a clear description of what the tool should do, ' +
        'why it is needed, and optionally suggest an API configuration if the tool wraps an external API. ' +
        'Yellow-tier decision is auto-created for approval.',
      parameters: {
        tool_name: {
          type: 'string',
          description:
            'Proposed name for the tool (snake_case, e.g., "get_jira_issues"). Must not already exist.',
          required: true,
        },
        description: {
          type: 'string',
          description: 'What the tool does — be specific about inputs, outputs, and behavior.',
          required: true,
        },
        justification: {
          type: 'string',
          description: 'Why this tool is needed. Reference a directive, blocker, or use case.',
          required: true,
        },
        use_case: {
          type: 'string',
          description: 'Concrete example of how you would use this tool in your work.',
          required: true,
        },
        suggested_category: {
          type: 'string',
          description: 'Category for the tool (e.g., "integration", "analytics", "communication", "data")',
          required: false,
        },
        directive_id: {
          type: 'string',
          description: 'Optional: directive UUID this tool supports',
          required: false,
        },
        suggested_api_config: {
          type: 'object',
          description:
            'Optional: suggested API configuration if the tool wraps an external API. ' +
            'Keys: method (GET/POST/etc), url_template, headers_template, body_template, auth_type (bearer_env/header_env/none), auth_env_var',
          required: false,
        },
        suggested_parameters: {
          type: 'object',
          description:
            'Optional: suggested parameter schema for the tool. Keys are param names, values describe type and description.',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const toolName = params.tool_name as string;
        const description = params.description as string;
        const justification = params.justification as string;
        const useCase = params.use_case as string;

        // Validate tool name format
        if (!/^[a-z][a-z0-9_]{2,63}$/.test(toolName)) {
          return {
            success: false,
            error:
              'Tool name must be snake_case, start with a letter, and be 3–64 characters (a-z, 0-9, _).',
          };
        }

        // Check if tool already exists
        if (isKnownTool(toolName)) {
          return {
            success: false,
            error: `Tool "${toolName}" already exists. Use grant_tool_access to get access to an existing tool instead.`,
          };
        }

        // Check for duplicate pending request
        const existing = await systemQuery(
          'SELECT id, status FROM tool_requests WHERE tool_name = $1 AND status = ANY($2) LIMIT 1',
          [toolName, ['pending', 'approved', 'building']],
        );

        if (existing.length > 0) {
          return {
            success: false,
            error: `A request for tool "${toolName}" already exists (status: ${existing[0].status}, id: ${existing[0].id}). Wait for it to be processed.`,
          };
        }

        // Create the tool request
        const [request] = await systemQuery(
          'INSERT INTO tool_requests (requested_by, tool_name, description, justification, use_case, suggested_category, directive_id, suggested_api_config, suggested_parameters, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
          [
            ctx.agentRole,
            toolName,
            description,
            justification,
            useCase,
            (params.suggested_category as string) ?? null,
            (params.directive_id as string) ?? null,
            params.suggested_api_config ?? null,
            params.suggested_parameters ?? null,
            'pending',
          ],
        );

        // Auto-file a Yellow decision for CTO review
        try {
          await systemQuery(
            'INSERT INTO decisions (tier, status, title, summary, proposed_by, reasoning, assigned_to) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [
              'yellow',
              'pending',
              `New tool request: ${toolName}`,
              `${ctx.agentRole} is requesting a new tool "${toolName}": ${description}\n\nJustification: ${justification}\n\nUse case: ${useCase}`,
              ctx.agentRole,
              justification,
              ['cto'],
            ],
          );
        } catch (decisionErr) {
          // Request was created but decision failed — not fatal
          return {
            success: true,
            data: {
              request_id: request.id,
              tool_name: toolName,
              status: 'pending',
              warning: `Tool request created but decision filing failed: ${(decisionErr as Error).message}. Alert Marcus (CTO) directly.`,
            },
          };
        }

        return {
          success: true,
          data: {
            request_id: request.id,
            tool_name: toolName,
            status: 'pending',
            message:
              'Tool request submitted and Yellow decision filed for CTO review. ' +
              'Marcus will review, approve, and build the tool. You will be notified when it is available.',
          },
        };
      },
    },

    {
      name: 'check_tool_request_status',
      description:
        'Check the status of a previously submitted tool request, or list your pending requests.',
      parameters: {
        request_id: {
          type: 'string',
          description: 'Specific request UUID to check. Omit to list all your requests.',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        try {
          if (params.request_id) {
            const [data] = await systemQuery(
              'SELECT * FROM tool_requests WHERE id = $1',
              [params.request_id as string],
            );
            return { success: true, data };
          }

          // List all requests by this agent
          const data = await systemQuery(
            'SELECT id, tool_name, status, review_notes, created_at FROM tool_requests WHERE requested_by = $1 ORDER BY created_at DESC LIMIT 20',
            [ctx.agentRole],
          );
          return { success: true, data: { requests: data } };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'request_tool_access',
      description:
        'Request access to an EXISTING tool you don\'t currently have. Use this when a tool call ' +
        'fails with "does not have access". Read-only tools (get_*, read_*, query_*, check_*, fetch_*) ' +
        'are auto-approved immediately. Write tools are auto-approved but logged for founder awareness. ' +
        'After calling this, retry the original tool call.',
      parameters: {
        tool_name: {
          type: 'string',
          description: 'Name of the existing tool you need access to.',
          required: true,
        },
        reason: {
          type: 'string',
          description: 'Why you need this tool — reference the task or request you\'re working on.',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const toolName = params.tool_name as string;
        const reason = params.reason as string;
        const agentRole = ctx.agentRole;

        if (!isKnownTool(toolName)) {
          return {
            success: false,
            error: `Tool "${toolName}" does not exist in the system. Use request_new_tool to request it be built.`,
          };
        }

        // Check if already granted
        const existing = await systemQuery(
          `SELECT id FROM agent_tool_grants WHERE agent_role = $1 AND tool_name = $2 AND is_active = true`,
          [agentRole, toolName],
        );
        if (existing.length > 0) {
          invalidateGrantCache(agentRole);
          return {
            success: true,
            data: {
              granted: true,
              tool_name: toolName,
              message: `You already have access to "${toolName}". Cache refreshed — retry your tool call now.`,
            },
          };
        }

        // Auto-grant: insert the grant row
        try {
          await systemQuery(
            `INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, reason)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (agent_role, tool_name) DO UPDATE SET is_active = true, reason = $4, updated_at = NOW()`,
            [agentRole, toolName, 'self-service', `Self-requested: ${reason}`],
          );
          invalidateGrantCache(agentRole);
        } catch (err) {
          return { success: false, error: `Failed to grant access: ${(err as Error).message}` };
        }

        // Log for founder awareness
        try {
          await systemQuery(
            `INSERT INTO activity_log (agent_role, action, details) VALUES ($1, $2, $3)`,
            [agentRole, 'self_service_tool_grant', JSON.stringify({ tool_name: toolName, reason })],
          );
        } catch {} // best-effort logging

        return {
          success: true,
          data: {
            granted: true,
            tool_name: toolName,
            agent_role: agentRole,
            message: `Access to "${toolName}" granted. You can now use it — retry your original tool call.`,
          },
        };
      },
    },
  ];
}
