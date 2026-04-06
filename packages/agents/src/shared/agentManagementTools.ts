/**
 * Agent Management Tools — shared write tools for managing agent records.
 *
 * These tools allow authorized agents (CoS, HR) to update agent names,
 * profiles, reporting lines, and status. Read-only directory tools are
 * in agentDirectoryTools.ts.
 */

import type { ToolDefinition } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createAgentManagementTools(): ToolDefinition[] {
  return [
    {
      name: 'update_agent_name',
      description:
        'Update an agent\'s display name in company_agents. Use this when a founder asks to rename an agent.',
      parameters: {
        role: {
          type: 'string',
          description: 'The agent role slug (e.g. "vp-design", "content-creator"). Use get_agent_directory to find it.',
          required: true,
        },
        display_name: {
          type: 'string',
          description: 'New human-readable display name (e.g. "Aria Roseman").',
          required: true,
        },
      },
      execute: async (params) => {
        const role = String(params.role ?? '').trim();
        const displayName = String(params.display_name ?? '').trim();
        if (!role || !displayName) {
          return { success: false, error: 'Both role and display_name are required.' };
        }

        try {
          const result = await systemQuery(
            'UPDATE company_agents SET display_name = $1, name = $1, updated_at = NOW() WHERE role = $2 RETURNING role, display_name',
            [displayName, role],
          );
          if (!result || result.length === 0) {
            return { success: false, error: `No agent found with role "${role}".` };
          }
          return { success: true, data: `Agent "${role}" renamed to "${displayName}".` };
        } catch (err) {
          return { success: false, error: `Failed to update: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'set_reports_to',
      description:
        'Update which manager an agent reports to in the org chart.',
      parameters: {
        role: {
          type: 'string',
          description: 'The agent role slug to update.',
          required: true,
        },
        manager: {
          type: 'string',
          description: 'Role slug of the new manager (e.g. "chief-of-staff", "cto").',
          required: true,
        },
      },
      execute: async (params) => {
        const role = String(params.role ?? '').trim();
        const manager = String(params.manager ?? '').trim();
        if (!role || !manager) {
          return { success: false, error: 'Both role and manager are required.' };
        }

        try {
          const result = await systemQuery(
            'UPDATE company_agents SET reports_to = $1, updated_at = NOW() WHERE role = $2 RETURNING role, reports_to',
            [manager, role],
          );
          if (!result || result.length === 0) {
            return { success: false, error: `No agent found with role "${role}".` };
          }
          return { success: true, data: `Agent "${role}" now reports to "${manager}".` };
        } catch (err) {
          return { success: false, error: `Failed: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'update_agent_status',
      description:
        'Set an agent\'s status (active, paused, retired). Use to pause or reactivate agents.',
      parameters: {
        role: {
          type: 'string',
          description: 'The agent role slug.',
          required: true,
        },
        status: {
          type: 'string',
          description: 'New status.',
          required: true,
          enum: ['active', 'paused', 'retired'],
        },
      },
      execute: async (params) => {
        const role = String(params.role ?? '').trim();
        const status = String(params.status ?? '').trim();
        if (!role || !status) {
          return { success: false, error: 'Both role and status are required.' };
        }

        try {
          const result = await systemQuery(
            'UPDATE company_agents SET status = $1, updated_at = NOW() WHERE role = $2 RETURNING role, status',
            [status, role],
          );
          if (!result || result.length === 0) {
            return { success: false, error: `No agent found with role "${role}".` };
          }
          return { success: true, data: `Agent "${role}" status set to "${status}".` };
        } catch (err) {
          return { success: false, error: `Failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}
