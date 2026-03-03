/**
 * Shared Tool Grant Management Tools
 *
 * Allows admin agents (Morgan, Riley, Sarah) to dynamically grant/revoke
 * tools for other agents via the agent_tool_grants table.
 *
 * Executive agents can propose grants, but all grants from non-admin
 * grantors file a Yellow decision requiring Kristina's approval.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { WRITE_TOOLS, invalidateGrantCache, isKnownTool } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

/** Grantors who can directly approve grants without filing a decision */
const DIRECT_GRANT_ADMINS = new Set(['kristina', 'system']);

export function createToolGrantTools(
  grantedBy: string,
): ToolDefinition[] {
  const canDirectGrant = DIRECT_GRANT_ADMINS.has(grantedBy);

  return [
    {
      name: 'grant_tool_access',
      description:
        canDirectGrant
          ? 'Grant an existing tool to an agent. Read-only tools (get_*, read_*, query_*, check_*, fetch_*) can be granted autonomously. Write tools auto-file a Yellow decision for founder awareness. The tool must exist in the system registry.'
          : 'Request a tool grant for an agent. All grants require Kristina\'s approval and will create a Yellow decision. The tool must exist in the system registry.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Agent role to grant the tool to (e.g., "cmo", "vp-sales")',
          required: true,
        },
        tool_name: {
          type: 'string',
          description: 'Name of the tool to grant (must exist in the tool registry)',
          required: true,
        },
        reason: {
          type: 'string',
          description: 'Why this grant is needed (links to directive or blocker)',
          required: true,
        },
        directive_id: {
          type: 'string',
          description: 'Optional: directive UUID this grant serves',
          required: false,
        },
        expires_in_hours: {
          type: 'number',
          description: 'Optional: auto-revoke after N hours (default: no expiry)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const agentRole = params.agent_role as string;
        const toolName = params.tool_name as string;
        const reason = params.reason as string;
        const directiveId = params.directive_id as string | undefined;
        const expiresInHours = params.expires_in_hours as number | undefined;

        if (!isKnownTool(toolName)) {
          return {
            success: false,
            error: `Tool "${toolName}" does not exist in the system registry. Cannot grant a tool that doesn't exist. Ask Marcus (CTO) to build it first.`,
          };
        }

        const isWrite = WRITE_TOOLS.has(toolName);
        const requiresApproval = !canDirectGrant || isWrite;

        const expiresAt = expiresInHours
          ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
          : null;

        // Non-admin grantors: file a Yellow decision instead of granting directly
        if (!canDirectGrant) {
          try {
            await systemQuery(
              `INSERT INTO decisions (tier, status, title, summary, proposed_by, reasoning, data, assigned_to)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                'yellow',
                'pending',
                `Tool Grant: ${toolName} → ${agentRole}`,
                `${grantedBy} requests granting "${toolName}" to ${agentRole}. Reason: ${reason}`,
                grantedBy,
                reason,
                JSON.stringify({
                  type: 'tool_grant_request',
                  agent_role: agentRole,
                  tool_name: toolName,
                  scope: 'full',
                  expires_at: expiresAt,
                  directive_id: directiveId ?? null,
                }),
                ['kristina'],
              ],
            );
          } catch (err) {
            return { success: false, error: (err as Error).message };
          }

          return {
            success: true,
            data: {
              granted: false,
              pending_approval: true,
              agent_role: agentRole,
              tool_name: toolName,
              note: 'Grant request filed as a Yellow decision for Kristina\'s approval. The grant will take effect once approved.',
            },
          };
        }

        // Admin grantors: grant directly

        try {
          await systemQuery(
            'INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, reason, directive_id, scope, is_active, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (agent_role, tool_name) DO UPDATE SET granted_by = EXCLUDED.granted_by, reason = EXCLUDED.reason, directive_id = EXCLUDED.directive_id, scope = EXCLUDED.scope, is_active = EXCLUDED.is_active, expires_at = EXCLUDED.expires_at',
            [agentRole, toolName, grantedBy, reason, directiveId ?? null, 'full', true, expiresAt],
          );
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }

        invalidateGrantCache(agentRole);

        return {
          success: true,
          data: {
            granted: true,
            agent_role: agentRole,
            tool_name: toolName,
            is_write_tool: isWrite,
            expires_at: expiresAt,
            note: isWrite
              ? 'This is a WRITE tool — a Yellow decision has been filed for founder awareness.'
              : 'Tool granted directly by admin.',
            written: { tool_name: toolName, agent_role: agentRole, action: 'grant' },
          },
        };
      },
    },

    {
      name: 'revoke_tool_access',
      description:
        "Revoke a dynamically granted tool from an agent. Only revokes DB-granted tools (not the agent's static/baseline tools built into their code).",
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Agent role to revoke the tool from',
          required: true,
        },
        tool_name: {
          type: 'string',
          description: 'Name of the tool to revoke',
          required: true,
        },
        reason: {
          type: 'string',
          description: 'Why this grant is being revoked',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const agentRole = params.agent_role as string;
        const toolName = params.tool_name as string;

        let data;
        try {
          data = await systemQuery(
            'UPDATE agent_tool_grants SET is_active = false, updated_at = $1 WHERE agent_role = $2 AND tool_name = $3 AND is_active = true RETURNING *',
            [new Date().toISOString(), agentRole, toolName],
          );
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }

        if (data.length === 0) {
          return {
            success: false,
            error: `No active dynamic grant found for ${agentRole}:${toolName}. System-granted (baseline) tools cannot be revoked via this tool.`,
          };
        }

        invalidateGrantCache(agentRole);

        return {
          success: true,
          data: { revoked: true, agent_role: agentRole, tool_name: toolName, written: { tool_name: toolName, agent_role: agentRole, action: 'revoke' } },
        };
      },
    },
  ];
}
