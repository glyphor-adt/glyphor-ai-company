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
import { isKnownToolAsync, invalidateGrantCache } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createToolRequestTools(): ToolDefinition[] {
  return [
    {
      name: 'list_my_tools',
      description:
        'List tool visibility for the current agent. Returns active self-service grants and, optionally, known system tools for discovery.',
      parameters: {
        search: {
          type: 'string',
          description: 'Optional case-insensitive substring filter applied to tool names.',
          required: false,
        },
        include_known_tools: {
          type: 'boolean',
          description: 'When true, include known system tools (can be large). Defaults to false.',
          required: false,
        },
        limit: {
          type: 'number',
          description: 'Max known tools to return when include_known_tools=true. Defaults to 200.',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const search = String(params.search ?? '').trim().toLowerCase();
        const includeKnown = Boolean(params.include_known_tools);
        const limitRaw = Number(params.limit ?? 200);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 200;

        const grants = await systemQuery<{ tool_name: string; reason: string | null; granted_by: string | null; updated_at: string | null }>(
          `SELECT tool_name, reason, granted_by, updated_at
             FROM agent_tool_grants
            WHERE agent_role = $1 AND is_active = true
            ORDER BY tool_name ASC`,
          [ctx.agentRole],
        );

        const grantedTools = search
          ? grants.filter((row) => row.tool_name.toLowerCase().includes(search))
          : grants;

        let knownTools: string[] = [];
        if (includeKnown) {
          const rows = await systemQuery<{ tool_name: string }>(
            `SELECT DISTINCT tool_name
               FROM (
                      SELECT tool_name FROM agent_tool_grants WHERE agent_role = $1 AND is_active = true
                      UNION ALL
                      SELECT name AS tool_name FROM tool_registry WHERE is_active = true
                    ) t
              ORDER BY tool_name ASC`,
            [ctx.agentRole],
          );

          knownTools = rows
            .map((r) => r.tool_name)
            .filter((name) => (search ? name.toLowerCase().includes(search) : true))
            .slice(0, limit);
        }

        return {
          success: true,
          data: {
            agent_role: ctx.agentRole,
            granted_count: grantedTools.length,
            granted_tools: grantedTools,
            known_tools: knownTools,
            note:
              'Runtime tool visibility is the intersection of loaded tool declarations, MCP server health/auth, and role/task filtering. If a needed tool is missing, call request_tool_access or request_new_tool.',
          },
        };
      },
    },

    {
      name: 'tool_search',
      description:
        'Search discoverable tool names by keyword. Compatibility helper for agents that attempt tool discovery via tool_search.',
      parameters: {
        query: {
          type: 'string',
          description: 'Keyword or partial tool name to search for.',
          required: true,
        },
        limit: {
          type: 'number',
          description: 'Maximum matches to return. Defaults to 50.',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const query = String(params.query ?? '').trim().toLowerCase();
        if (!query) return { success: false, error: 'query is required.' };
        const limitRaw = Number(params.limit ?? 50);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 50;

        const rows = await systemQuery<{ tool_name: string }>(
          `SELECT DISTINCT tool_name
             FROM (
                    SELECT tool_name FROM agent_tool_grants WHERE agent_role = $1 AND is_active = true
                    UNION ALL
                    SELECT name AS tool_name FROM tool_registry WHERE is_active = true
                  ) t
            WHERE LOWER(tool_name) LIKE $2
            ORDER BY tool_name ASC
            LIMIT $3`,
          [ctx.agentRole, `%${query}%`, limit],
        );

        return {
          success: true,
          data: {
            query,
            count: rows.length,
            matches: rows.map((r) => r.tool_name),
            note: 'This searches discoverable registry + active grant names. MCP availability still depends on runtime server auth/health.',
          },
        };
      },
    },

    {
      name: 'check_tool_access',
      description:
        'Pre-dispatch access check. Verifies whether tools exist in the system and whether an agent currently has an active self-service grant row for each tool.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Agent role to evaluate (e.g., "cmo"). Defaults to caller role when omitted.',
          required: false,
        },
        tool_names: {
          type: 'array',
          description: 'List of tool names to validate.',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const agentRole = String(params.agent_role ?? ctx.agentRole);
        const rawToolNames = Array.isArray(params.tool_names) ? params.tool_names : [];
        const toolNames = rawToolNames
          .map((value) => String(value).trim())
          .filter(Boolean);

        if (toolNames.length === 0) {
          return { success: false, error: 'tool_names must contain at least one tool name.' };
        }

        const grants = await systemQuery<{ tool_name: string }>(
          `SELECT tool_name
             FROM agent_tool_grants
            WHERE agent_role = $1 AND is_active = true`,
          [agentRole],
        );
        const grantSet = new Set(grants.map((row) => row.tool_name));

        const checks = await Promise.all(
          toolNames.map(async (toolName) => {
            const knownInRegistry = await isKnownToolAsync(toolName);
            const hasGrant = grantSet.has(toolName);
            const exists = knownInRegistry || hasGrant;
            const likelyAccessible = exists;

            return {
              tool_name: toolName,
              exists,
              active_grant: hasGrant,
              likely_accessible: likelyAccessible,
              recommendation: exists
                ? (hasGrant
                    ? (knownInRegistry
                        ? 'Tool appears available. Dispatch is safe; if runtime still fails, check MCP health/auth and task subset filters.'
                        : 'Tool has an active grant but is not in registry metadata. It may still be code-loaded (for example, a fallback). Dispatch directly; if runtime fails with Unknown tool, request_new_tool.')
                    : 'Tool exists. If dispatch fails due access, call request_tool_access then retry.')
                : 'Tool does not exist in registry and has no active grant. Use request_new_tool.',
            };
          }),
        );

        const missing = checks.filter((c) => !c.exists).map((c) => c.tool_name);
        return {
          success: true,
          data: {
            agent_role: agentRole,
            checks,
            all_tools_exist: missing.length === 0,
            missing_tools: missing,
          },
        };
      },
    },

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
        if (!params.tool_name) return { success: false, error: 'tool_name parameter is required' };
        if (!params.description) return { success: false, error: 'description parameter is required' };
        if (!params.justification) return { success: false, error: 'justification parameter is required' };
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

        // If the requester already has an active grant for this exact name,
        // this is not a "new tool" request.
        const alreadyGranted = await systemQuery<{ id: string }>(
          `SELECT id FROM agent_tool_grants
           WHERE agent_role = $1 AND tool_name = $2 AND is_active = true
           LIMIT 1`,
          [ctx.agentRole, toolName],
        );
        if (alreadyGranted.length > 0) {
          return {
            success: false,
            error: `You already have access to "${toolName}". Use the existing tool instead of requesting a new one.`,
          };
        }

        // Check if tool already exists (static or DB-registered)
        if (await isKnownToolAsync(toolName)) {
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

        if (!(await isKnownToolAsync(toolName))) {
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
