/**
 * Shared Tool Request Tools
 *
 * Allows any agent to request a new tool that doesn't exist yet.
 * Requests are stored in the `tool_requests` table.
 *
 * Default behavior is self-service and unblocked.
 * Approval is required only for paid/spend-impacting capabilities and
 * global-admin/IAM/tenant-permissioning capabilities.
 *
 * Also provides request_tool_access for agents to self-service access
 * to existing tools they don't currently have.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { isKnownToolAsync, invalidateGrantCache, refreshDynamicToolCache } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { evaluateToolPermissionGate } from './toolPermissionPolicy.js';

const KNOWLEDGE_ARTIFACT_PATTERN = /(sharepoint|toolkit|playbook|guide|guidelines|primer|document|deck|brief|policy|template|style\s*guide|brand\s*guide|asset\s*library)/i;

function looksLikeKnowledgeArtifact(value: string): boolean {
  return KNOWLEDGE_ARTIFACT_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DIRECT_PERMISSION_APPROVERS = new Set(['kristina', 'system']);

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
        'Pre-dispatch access check. Verifies active grants, grant freshness, and whether each tool exists in the system.',
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

        const grants = await systemQuery<{ tool_name: string; last_synced_at: string | null; granted_by: string | null }>(
          `SELECT tool_name, last_synced_at, granted_by
             FROM agent_tool_grants
            WHERE agent_role = $1
              AND tool_name = ANY($2::text[])
              AND is_active = true`,
          [agentRole, toolNames],
        );
        const grantByTool = new Map(grants.map((row) => [row.tool_name, row]));

        const checks = await Promise.all(
          toolNames.map(async (toolName) => {
            const grantRow = grantByTool.get(toolName);
            const existsInSystem = await isKnownToolAsync(toolName);
            const isFresh = Boolean(
              grantRow?.last_synced_at &&
              (Date.now() - new Date(grantRow.last_synced_at).getTime()) < 24 * 60 * 60 * 1000,
            );

            let accessible: 'yes' | 'no' | 'unknown';
            let source: 'active_grant_fresh' | 'active_grant_stale' | 'exists_in_system_only' | 'not_found';

            if (grantRow && isFresh) {
              accessible = 'yes';
              source = 'active_grant_fresh';
            } else if (grantRow && !isFresh) {
              accessible = 'unknown';
              source = 'active_grant_stale';
            } else if (existsInSystem) {
              accessible = 'unknown';
              source = 'exists_in_system_only';
            } else {
              accessible = 'no';
              source = 'not_found';
            }

            return {
              tool_name: toolName,
              agent_role: agentRole,
              accessible,
              source,
              active_grant: Boolean(grantRow),
              last_synced_at: grantRow?.last_synced_at ?? null,
              granted_by: grantRow?.granted_by ?? null,
              exists_in_system: existsInSystem,
              recommendation:
                accessible === 'unknown'
                  ? 'Grant this tool preemptively before dispatching - use grant_tool_access. The grant is idempotent (no-op if the agent already has it).'
                  : accessible === 'no'
                    ? 'This tool does not exist. Check the tool name or request it via request_new_tool.'
                    : 'Tool confirmed accessible.',
            };
          }),
        );

        const missing = checks.filter((c) => !c.exists_in_system).map((c) => c.tool_name);
        const unknown = checks.filter((c) => c.accessible === 'unknown').map((c) => c.tool_name);
        return {
          success: true,
          data: {
            agent_role: agentRole,
            checks,
            all_tools_exist: missing.length === 0,
            missing_tools: missing,
            unknown_tools: unknown,
            all_tools_confirmed_accessible: checks.every((c) => c.accessible === 'yes'),
          },
        };
      },
    },

    {
      name: 'request_new_tool',
      description:
        'Request a new tool capability that does not currently exist in the system. ' +
        'Creates a tool request for CTO build review. Include a clear description of what the tool should do, ' +
        'why it is needed, and optionally suggest an API configuration if the tool wraps an external API. ' +
        'Approval is required only for paid/spend-impacting or global-admin permissioning tools.',
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
        const combinedRequestText = `${toolName}\n${description}\n${justification}\n${useCase}`;
        const permissionPolicy = evaluateToolPermissionGate({
          toolName,
          contextText: [description, justification, useCase],
        });
        const requesterCanBypassApproval = DIRECT_PERMISSION_APPROVERS.has(ctx.agentRole);

        if (looksLikeKnowledgeArtifact(combinedRequestText)) {
          return {
            success: false,
            error:
              'This looks like a document/knowledge access request (for example: toolkit/guide/primer), not a missing executable tool. ' +
              'Use SharePoint tools first (mcp_ODSPRemoteServer/findFileOrFolder, mcp_ODSPRemoteServer/listDocumentLibrariesInSite), ' +
              'or call list_my_tools/include_known_tools=true and request_tool_access with the exact existing tool name.',
          };
        }

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

        // Fast path: allow agents to self-bootstrap API-backed tools immediately
        // when they provide executable config + parameter schema.
        const autoBuildEnabled = process.env.ENABLE_AGENT_SELF_TOOL_BUILD !== 'false';
        const suggestedApiConfig = params.suggested_api_config;
        const suggestedParameters = params.suggested_parameters;
        const autoBuildEligible = autoBuildEnabled
          && (!permissionPolicy.requiresApproval || requesterCanBypassApproval)
          && isRecord(suggestedApiConfig)
          && isRecord(suggestedParameters);

        if (autoBuildEligible) {
          try {
            await systemQuery(
              'INSERT INTO tool_registry (name, description, category, parameters, api_config, created_by, approved_by, is_active, tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
              [
                toolName,
                description,
                (params.suggested_category as string) ?? 'integration',
                suggestedParameters,
                suggestedApiConfig,
                ctx.agentRole,
                'self-service-auto',
                true,
                ['self-service', 'auto-built'],
              ],
            );

            await refreshDynamicToolCache();

            await systemQuery(
              `INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, reason)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (agent_role, tool_name) DO UPDATE
                 SET is_active = true, granted_by = EXCLUDED.granted_by, reason = EXCLUDED.reason, updated_at = NOW()`,
              [ctx.agentRole, toolName, 'self-service-auto', `Auto-built via request_new_tool: ${justification}`],
            );
            invalidateGrantCache(ctx.agentRole);

            await systemQuery(
              'UPDATE tool_requests SET status = $1, reviewed_by = $2, review_notes = $3, built_by = $4 WHERE id = $5',
              [
                'completed',
                'self-service-auto',
                'Auto-built from suggested_api_config + suggested_parameters.',
                ctx.agentRole,
                request.id,
              ],
            );

            return {
              success: true,
              data: {
                request_id: request.id,
                tool_name: toolName,
                status: 'completed',
                auto_registered: true,
                message:
                  `Tool "${toolName}" was auto-built and access was granted to ${ctx.agentRole}. ` +
                  'Retry your original task now using this tool.',
              },
            };
          } catch (autoBuildErr) {
            console.warn(
              `[ToolRequest] Auto-build failed for ${toolName}; falling back to CTO review:`,
              (autoBuildErr as Error).message,
            );
          }
        }

        if (permissionPolicy.requiresApproval && !requesterCanBypassApproval) {
          try {
            await systemQuery(
              'INSERT INTO decisions (tier, status, title, summary, proposed_by, reasoning, assigned_to, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
              [
                'yellow',
                'pending',
                `Restricted tool request: ${toolName}`,
                `${ctx.agentRole} requested restricted tool "${toolName}" (${permissionPolicy.reason}).\n\nDescription: ${description}\n\nJustification: ${justification}\n\nUse case: ${useCase}`,
                ctx.agentRole,
                justification,
                ['kristina'],
                JSON.stringify({
                  type: 'restricted_tool_request',
                  tool_name: toolName,
                  requested_by: ctx.agentRole,
                  restriction_reason: permissionPolicy.reason,
                  matches: permissionPolicy.matches,
                  request_id: request.id,
                }),
              ],
            );
          } catch (decisionErr) {
            return {
              success: true,
              data: {
                request_id: request.id,
                tool_name: toolName,
                status: 'pending',
                warning: `Restricted tool request created but approval routing failed: ${(decisionErr as Error).message}.`,
              },
            };
          }

          return {
            success: true,
            data: {
              request_id: request.id,
              tool_name: toolName,
              status: 'pending_approval',
              approval_required: true,
              approval_reason: permissionPolicy.reason,
              message:
                `Restricted request received (${permissionPolicy.reason}). ` +
                'Founder approval is required before this tool can be built/granted.',
            },
          };
        }

        return {
          success: true,
          data: {
            request_id: request.id,
            tool_name: toolName,
            status: 'pending',
            approval_required: false,
            message:
              'Tool request submitted to build queue. No approval is required for this tool type. ' +
              'Marcus can build/register it and grant access when ready.',
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
        'fails with "does not have access". Most tools are auto-granted immediately. ' +
        'Only paid/spend-impacting or global-admin permissioning tools require approval. ' +
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
        const permissionPolicy = evaluateToolPermissionGate({
          toolName,
          contextText: [reason],
        });
        const requesterCanBypassApproval = DIRECT_PERMISSION_APPROVERS.has(agentRole);

        if (!(await isKnownToolAsync(toolName))) {
          if (looksLikeKnowledgeArtifact(`${toolName}\n${reason}`)) {
            return {
              success: false,
              error:
                `"${toolName}" appears to be a document/resource name, not a tool. ` +
                'Search SharePoint via existing ODSP tools (for example mcp_ODSPRemoteServer/findFileOrFolder), then request access to the exact tool name if needed.',
            };
          }
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

        if (permissionPolicy.requiresApproval && !requesterCanBypassApproval) {
          try {
            await systemQuery(
              `INSERT INTO decisions (tier, status, title, summary, proposed_by, reasoning, assigned_to, data)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
              [
                'yellow',
                'pending',
                `Restricted tool access: ${toolName} → ${agentRole}`,
                `${agentRole} requested restricted access to "${toolName}" (${permissionPolicy.reason}).`,
                agentRole,
                reason,
                ['kristina'],
                JSON.stringify({
                  type: 'restricted_tool_access_request',
                  agent_role: agentRole,
                  tool_name: toolName,
                  restriction_reason: permissionPolicy.reason,
                  matches: permissionPolicy.matches,
                }),
              ],
            );
          } catch (decisionErr) {
            return {
              success: false,
              error: `Restricted tool access requires approval, but request routing failed: ${(decisionErr as Error).message}`,
            };
          }

          return {
            success: true,
            data: {
              granted: false,
              pending_approval: true,
              tool_name: toolName,
              approval_reason: permissionPolicy.reason,
              message:
                `Access to "${toolName}" requires approval (${permissionPolicy.reason}). ` +
                'A Yellow decision was filed to Kristina.',
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
