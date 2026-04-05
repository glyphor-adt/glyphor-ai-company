/**
 * Shared Tool Grant Management Tools
 *
 * Allows admin agents (Morgan, Riley, Sarah) to dynamically grant/revoke
 * tools for other agents via the agent_tool_grants table.
 *
 * Executive agents can grant most tools directly.
 * Only restricted grants (paid/spend-impacting or global-admin permissioning)
 * file a Yellow decision requiring Kristina's approval.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { invalidateGrantCache, isKnownToolAsync } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import { evaluateToolPermissionGate } from './toolPermissionPolicy.js';

/** Grantors who can directly approve restricted grants without filing a decision */
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
          ? 'Grant an existing tool to an agent. Most grants are immediate. Restricted grants (paid/spend-impacting or global-admin permissioning) can still be approved directly by you. The tool must exist in the system registry.'
          : 'Grant a tool to an agent. Most grants are immediate. Only restricted grants (paid/spend-impacting or global-admin permissioning) create a Yellow decision for founder approval. The tool must exist in the system registry.',
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
        const agentRole = typeof params.agent_role === 'string' ? params.agent_role.trim() : '';
        const toolName = typeof params.tool_name === 'string' ? params.tool_name.trim() : '';
        const reason = typeof params.reason === 'string' ? params.reason.trim() : '';
        const directiveId = params.directive_id as string | undefined;
        const expiresInHours = params.expires_in_hours as number | undefined;

        if (!agentRole) {
          return { success: false, error: 'agent_role is required' };
        }
        if (!toolName) {
          return { success: false, error: 'tool_name is required' };
        }
        if (!reason) {
          return { success: false, error: 'reason is required' };
        }

        if (!(await isKnownToolAsync(toolName))) {
          return {
            success: false,
            error: `Tool "${toolName}" does not exist in the system registry. Cannot grant a tool that doesn't exist. Ask Marcus (CTO) to build it first.`,
          };
        }

        const permissionPolicy = evaluateToolPermissionGate({
          toolName,
          contextText: [reason],
        });
        const requiresApproval = permissionPolicy.requiresApproval && !canDirectGrant;

        const expiresAt = expiresInHours
          ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
          : null;

        // Restricted grants by non-admin grantors: file a Yellow decision instead of granting directly
        if (requiresApproval) {
          try {
            await systemQuery(
              `INSERT INTO decisions (tier, status, title, summary, proposed_by, reasoning, data, assigned_to)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                'yellow',
                'pending',
                `Restricted Tool Grant: ${toolName} → ${agentRole}`,
                `${grantedBy} requests restricted grant "${toolName}" to ${agentRole}. Reason: ${reason}`,
                grantedBy,
                reason,
                JSON.stringify({
                  type: 'tool_grant_request',
                  agent_role: agentRole,
                  tool_name: toolName,
                  restriction_reason: permissionPolicy.reason,
                  matches: permissionPolicy.matches,
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
              approval_reason: permissionPolicy.reason,
              note: 'Restricted grant request filed as a Yellow decision for Kristina\'s approval. The grant will take effect once approved.',
            },
          };
        }

        // Admin grantors: grant directly

        try {
          await systemQuery(
            'INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, reason, directive_id, scope, is_active, expires_at, last_synced_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (agent_role, tool_name) DO UPDATE SET granted_by = EXCLUDED.granted_by, reason = EXCLUDED.reason, directive_id = EXCLUDED.directive_id, scope = EXCLUDED.scope, is_active = EXCLUDED.is_active, expires_at = EXCLUDED.expires_at, last_synced_at = NOW()',
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
            restricted_tool: permissionPolicy.requiresApproval,
            expires_at: expiresAt,
            note: permissionPolicy.requiresApproval
              ? 'Restricted tool granted directly by privileged admin.'
              : 'Tool granted directly.',
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
