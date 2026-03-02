/**
 * Access Audit Tools
 *
 * Provides read-only visibility into agent tool grants and access matrix.
 * Used by HR (Jasmine Rivera) and admins to audit who has access to what.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createAccessAuditTools(): ToolDefinition[] {
  return [
    {
      name: 'view_access_matrix',
      description:
        'View the full agent access matrix — shows all active tool grants across the company. ' +
        'Can filter by agent role or tool name. Returns who has what, who granted it, and when.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'Optional: filter by a specific agent role (e.g., "cmo")',
          required: false,
        },
        tool_name: {
          type: 'string',
          description: 'Optional: filter by a specific tool name',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const agentRole = params.agent_role as string | undefined;
        const toolName = params.tool_name as string | undefined;

        let query = 'SELECT agent_role, tool_name, granted_by, reason, scope, expires_at, created_at FROM agent_tool_grants WHERE is_active = true';
        const queryParams: unknown[] = [];
        let paramIdx = 1;

        if (agentRole) {
          query += ` AND agent_role = $${paramIdx++}`;
          queryParams.push(agentRole);
        }
        if (toolName) {
          query += ` AND tool_name = $${paramIdx++}`;
          queryParams.push(toolName);
        }
        query += ' ORDER BY agent_role, tool_name';

        try {
          const rows = await systemQuery(query, queryParams);

          // Group by agent for readability
          const byAgent: Record<string, { tools: string[]; total: number }> = {};
          for (const row of rows) {
            const role = row.agent_role as string;
            if (!byAgent[role]) byAgent[role] = { tools: [], total: 0 };
            const expiry = row.expires_at ? ` (expires ${new Date(row.expires_at as string).toLocaleDateString()})` : '';
            const scope = row.scope === 'read_only' ? ' [read-only]' : '';
            byAgent[role].tools.push(`${row.tool_name}${scope}${expiry} — granted by ${row.granted_by}`);
            byAgent[role].total++;
          }

          return {
            success: true,
            data: {
              total_grants: rows.length,
              total_agents: Object.keys(byAgent).length,
              matrix: byAgent,
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },

    {
      name: 'view_pending_grant_requests',
      description:
        'View all pending tool grant decisions awaiting approval. ' +
        'Shows who requested what, for which agent, and when.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        try {
          const rows = await systemQuery(
            `SELECT id, title, summary, proposed_by, data, created_at
             FROM decisions
             WHERE status = 'pending' AND tier = 'yellow'
               AND (title LIKE '%Tool Grant%' OR title LIKE '%tool_grant%')
             ORDER BY created_at DESC
             LIMIT 50`,
            [],
          );

          return {
            success: true,
            data: {
              pending_count: rows.length,
              requests: rows.map((r: Record<string, unknown>) => ({
                id: r.id,
                title: r.title,
                summary: r.summary,
                proposed_by: r.proposed_by,
                requested_at: r.created_at,
                details: r.data,
              })),
            },
          };
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }
      },
    },
  ];
}
