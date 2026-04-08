/**
 * Shared Tool Request Tools
 *
 * Allows agents to request new tools and additional access without
 * directly activating live capabilities.
 *
 * Requests are stored in the `tool_requests` table. Activation remains an
 * admin-controlled step after review and registry validation.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { isKnownToolAsync, getAllKnownTools, invalidateGrantCache } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { evaluateToolPermissionGate } from './toolPermissionPolicy.js';

const KNOWLEDGE_ARTIFACT_PATTERN = /(sharepoint|toolkit|playbook|guide|guidelines|primer|document|deck|brief|policy|template|style\s*guide|brand\s*guide|asset\s*library)/i;

function looksLikeKnowledgeArtifact(value: string): boolean {
  return KNOWLEDGE_ARTIFACT_PATTERN.test(value);
}

const ADMIN_REVIEW_ASSIGNEES = ['cto', 'global-admin'];
const RESTRICTED_REVIEW_ASSIGNEES = ['kristina', ...ADMIN_REVIEW_ASSIGNEES];

async function queueToolReviewDecision(input: {
  title: string;
  summary: string;
  proposedBy: string;
  reasoning: string;
  requiresApproval: boolean;
  data: Record<string, unknown>;
}): Promise<void> {
  await systemQuery(
    'INSERT INTO decisions (tier, status, title, summary, proposed_by, reasoning, assigned_to, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
    [
      'yellow',
      'pending',
      input.title,
      input.summary,
      input.proposedBy,
      input.reasoning,
      input.requiresApproval ? RESTRICTED_REVIEW_ASSIGNEES : ADMIN_REVIEW_ASSIGNEES,
      JSON.stringify(input.data),
    ],
  );
}

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

        const staticMatches = getAllKnownTools()
          .filter((toolName) => toolName.toLowerCase().includes(query));

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

        const mergedMatches = Array.from(new Set([
          ...rows.map((r) => r.tool_name),
          ...staticMatches,
        ]))
          .sort((a, b) => a.localeCompare(b))
          .slice(0, limit);

        return {
          success: true,
          data: {
            query,
            count: mergedMatches.length,
            matches: mergedMatches,
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
              // Active grant exists — the tool IS accessible at runtime.
              // Staleness only means the sync metadata is old, not that the
              // grant is invalid.  Reporting 'unknown' here caused agents to
              // believe they couldn't call the tool.
              accessible = 'yes';
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
                source === 'active_grant_stale'
                  ? 'Tool is accessible (active grant exists). Grant metadata is stale — consider re-syncing with grant_tool_access.'
                  : accessible === 'unknown'
                    ? 'No active grant found but tool exists in the system. Grant access with grant_tool_access before dispatching.'
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
          [toolName, ['pending', 'pending_approval', 'approved', 'building']],
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

        if (permissionPolicy.requiresApproval) {
          try {
            await queueToolReviewDecision({
              title: `Restricted tool request: ${toolName}`,
              summary: `${ctx.agentRole} requested restricted tool "${toolName}" (${permissionPolicy.reason}).\n\nDescription: ${description}\n\nJustification: ${justification}\n\nUse case: ${useCase}`,
              proposedBy: ctx.agentRole,
              reasoning: justification,
              requiresApproval: true,
              data: {
                type: 'restricted_tool_request',
                tool_name: toolName,
                requested_by: ctx.agentRole,
                restriction_reason: permissionPolicy.reason,
                matches: permissionPolicy.matches,
                request_id: request.id,
              },
            });
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

          const [updated] = await systemQuery<{ id: string }>(
            'UPDATE tool_requests SET status = $1, review_notes = $2 WHERE id = $3 RETURNING id',
            ['pending_approval', 'Awaiting restricted admin review before any registry activation.', request.id],
          );

          if (!updated) {
            // The request was already modified (e.g., auto-built by a concurrent process).
            // Return success with the original pending status so the caller is not blocked.
            return {
              success: true,
              data: {
                request_id: request.id,
                tool_name: toolName,
                status: 'pending',
                approval_required: true,
                approval_reason: permissionPolicy.reason,
                message:
                  `Restricted request received (${permissionPolicy.reason}). ` +
                  'Admin review is required before this tool can be activated in the registry.',
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
                'Admin review is required before this tool can be activated in the registry.',
            },
          };
        }

        try {
          await queueToolReviewDecision({
            title: `Tool request review: ${toolName}`,
            summary: `${ctx.agentRole} requested new tool "${toolName}". Review the proposal before any live registry activation.\n\nDescription: ${description}\n\nJustification: ${justification}\n\nUse case: ${useCase}`,
            proposedBy: ctx.agentRole,
            reasoning: justification,
            requiresApproval: false,
            data: {
              type: 'tool_request_review',
              tool_name: toolName,
              requested_by: ctx.agentRole,
              request_id: request.id,
            },
          });
        } catch (decisionErr) {
          return {
            success: true,
            data: {
              request_id: request.id,
              tool_name: toolName,
              status: 'pending',
              warning: `Tool request created but admin review routing failed: ${(decisionErr as Error).message}.`,
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
              'Tool request submitted for CTO/admin review. No live build, registry activation, or grant occurs until reviewed.',
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
        'fails with "does not have access". This files an access request for admin review; it does not activate access live. ' +
        'Restricted capabilities include paid/spend-impacting or global-admin permissioning tools.',
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
        const toolName = typeof params.tool_name === 'string' ? params.tool_name.trim() : '';
        const reason = typeof params.reason === 'string' ? params.reason.trim() : '';
        const agentRole = ctx.agentRole;
        if (!toolName) {
          return { success: false, error: 'tool_name is required' };
        }
        if (!reason) {
          return { success: false, error: 'reason is required' };
        }
        const permissionPolicy = evaluateToolPermissionGate({
          toolName,
          contextText: [reason],
        });

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

        try {
          await queueToolReviewDecision({
            title: `${permissionPolicy.requiresApproval ? 'Restricted ' : ''}tool access: ${toolName} → ${agentRole}`,
            summary: `${agentRole} requested access to "${toolName}". Admin review is required before any live grant.\n\nReason: ${reason}`,
            proposedBy: agentRole,
            reasoning: reason,
            requiresApproval: permissionPolicy.requiresApproval,
            data: {
              type: permissionPolicy.requiresApproval ? 'restricted_tool_access_request' : 'tool_access_request',
              agent_role: agentRole,
              tool_name: toolName,
              restriction_reason: permissionPolicy.reason,
              matches: permissionPolicy.matches,
            },
          });
        } catch (decisionErr) {
          return {
            success: false,
            error: `Tool access request could not be routed for review: ${(decisionErr as Error).message}`,
          };
        }

        return {
          success: true,
          data: {
            granted: false,
            pending_admin_review: true,
            pending_approval: permissionPolicy.requiresApproval,
            tool_name: toolName,
            agent_role: agentRole,
            message: permissionPolicy.requiresApproval
              ? `Access request for "${toolName}" was filed for restricted admin review. No live grant was activated.`
              : `Access request for "${toolName}" was filed for CTO/admin review. No live grant was activated.`,
          },
        };
      },
    },
  ];
}
