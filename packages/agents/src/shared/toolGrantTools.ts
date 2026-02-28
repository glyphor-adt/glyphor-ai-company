/**
 * Shared Tool Grant Management Tools
 *
 * Allows admin agents (Morgan, Riley, Sarah) to dynamically grant/revoke
 * tools for other agents via the agent_tool_grants table.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { WRITE_TOOLS, invalidateGrantCache, isKnownTool } from '@glyphor/agent-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createToolGrantTools(
  supabase: SupabaseClient,
  grantedBy: string,
): ToolDefinition[] {
  return [
    {
      name: 'grant_tool_access',
      description:
        'Grant an existing tool to an agent. Read-only tools (get_*, read_*, query_*, check_*, fetch_*) can be granted autonomously. Write tools auto-file a Yellow decision for founder approval. The tool must exist in the system registry.',
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

        const expiresAt = expiresInHours
          ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
          : null;

        const { error } = await supabase
          .from('agent_tool_grants')
          .upsert(
            {
              agent_role: agentRole,
              tool_name: toolName,
              granted_by: grantedBy,
              reason,
              directive_id: directiveId ?? null,
              scope: 'full',
              is_active: true,
              expires_at: expiresAt,
            },
            { onConflict: 'agent_role,tool_name' },
          );

        if (error) return { success: false, error: error.message };

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
              ? 'This is a WRITE tool — a Yellow decision should be filed for founder awareness.'
              : 'Read-only tool granted autonomously.',
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

        const { data, error } = await supabase
          .from('agent_tool_grants')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('agent_role', agentRole)
          .eq('tool_name', toolName)
          .eq('is_active', true)
          .select();

        if (error) return { success: false, error: error.message };

        if (!data || data.length === 0) {
          return {
            success: false,
            error: `No active dynamic grant found for ${agentRole}:${toolName}. System-granted (baseline) tools cannot be revoked via this tool.`,
          };
        }

        invalidateGrantCache(agentRole);

        return {
          success: true,
          data: { revoked: true, agent_role: agentRole, tool_name: toolName },
        };
      },
    },
  ];
}
