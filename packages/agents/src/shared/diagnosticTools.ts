/**
 * Diagnostic Tools — Schema introspection & tool error investigation
 *
 * Gives agents the ability to investigate tool failures by checking
 * the live database schema. When a tool fails with "column X does not
 * exist", an agent can use these tools to identify what columns
 * actually exist and report the mismatch precisely.
 *
 * Intended primarily for CTO, Platform Engineer, DevOps, and Ops agents
 * but safe to give to any agent (read-only queries).
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createDiagnosticTools(): ToolDefinition[] {
  return [
    {
      name: 'check_table_schema',
      description:
        'Look up the actual columns of a database table. Use this when a tool fails with ' +
        '"column X does not exist" to see what columns really exist. Returns column names, ' +
        'types, and nullability.',
      parameters: {
        table_name: {
          type: 'string',
          description: 'The table to inspect (e.g. "agent_profiles", "company_agents", "agent_runs")',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const table = params.table_name as string;

        // Sanitize: only allow alphanumeric + underscores to prevent injection
        if (!/^[a-z_][a-z0-9_]*$/i.test(table)) {
          return { success: false, error: 'Invalid table name. Use only letters, numbers, and underscores.' };
        }

        try {
          const columns = await systemQuery(
            `SELECT column_name, data_type, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1
             ORDER BY ordinal_position`,
            [table],
          );

          if (columns.length === 0) {
            // Check if the table exists at all
            const tables = await systemQuery(
              `SELECT table_name FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name LIKE $1
               ORDER BY table_name LIMIT 10`,
              [`%${table}%`],
            );
            const suggestions = tables.map((t: Record<string, unknown>) => t.table_name);
            return {
              success: false,
              error: `Table "${table}" not found. ${suggestions.length > 0 ? `Similar tables: ${suggestions.join(', ')}` : 'No similar tables found.'}`,
            };
          }

          return {
            success: true,
            data: JSON.stringify({
              table,
              columnCount: columns.length,
              columns: columns.map((c: Record<string, unknown>) => ({
                name: c.column_name,
                type: c.data_type,
                nullable: c.is_nullable === 'YES',
                hasDefault: c.column_default !== null,
              })),
            }, null, 2),
          };
        } catch (err) {
          return { success: false, error: `Schema query failed: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'diagnose_column_error',
      description:
        'Diagnose a "column does not exist" error. Give it the table name and the column ' +
        'that was expected. It will check the actual schema and suggest the correct column name ' +
        'if a close match exists (e.g. "agent_role" vs "agent_id").',
      parameters: {
        table_name: {
          type: 'string',
          description: 'The table where the error occurred',
          required: true,
        },
        expected_column: {
          type: 'string',
          description: 'The column name that was not found',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const table = params.table_name as string;
        const expected = params.expected_column as string;

        if (!/^[a-z_][a-z0-9_]*$/i.test(table) || !/^[a-z_][a-z0-9_]*$/i.test(expected)) {
          return { success: false, error: 'Invalid table or column name.' };
        }

        try {
          const columns = await systemQuery(
            `SELECT column_name, data_type
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1
             ORDER BY ordinal_position`,
            [table],
          );

          if (columns.length === 0) {
            return { success: false, error: `Table "${table}" does not exist in the public schema.` };
          }

          const colNames = columns.map((c: Record<string, unknown>) => c.column_name as string);

          // Check if the column actually exists (maybe it was fixed already)
          if (colNames.includes(expected)) {
            return {
              success: true,
              data: JSON.stringify({
                diagnosis: 'COLUMN_EXISTS',
                message: `Column "${expected}" exists in "${table}". The error may have been resolved, or it may be a query syntax issue.`,
                allColumns: colNames,
              }, null, 2),
            };
          }

          // Find similar column names (simple similarity: shared prefix/suffix, contains)
          const suggestions = colNames.filter((col) => {
            const a = col.toLowerCase();
            const b = expected.toLowerCase();
            // Share a meaningful word (split on underscore)
            const aWords = new Set(a.split('_'));
            const bWords = new Set(b.split('_'));
            for (const w of bWords) {
              if (w.length > 2 && aWords.has(w)) return true;
            }
            // One contains the other
            if (a.includes(b) || b.includes(a)) return true;
            return false;
          });

          return {
            success: true,
            data: JSON.stringify({
              diagnosis: 'COLUMN_NOT_FOUND',
              message: `Column "${expected}" does not exist in table "${table}".`,
              likelyCorrectColumn: suggestions.length === 1 ? suggestions[0] : null,
              similarColumns: suggestions,
              allColumns: colNames,
              recommendation: suggestions.length === 1
                ? `The correct column name is probably "${suggestions[0]}". The SQL query referencing "${expected}" needs to be updated to "${suggestions[0]}".`
                : suggestions.length > 1
                  ? `Multiple possible matches: ${suggestions.join(', ')}. Check the query intent to determine which is correct.`
                  : `No similar columns found. The query may be referencing a column from a different table.`,
            }, null, 2),
          };
        } catch (err) {
          return { success: false, error: `Diagnosis failed: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'list_tables',
      description:
        'List all database tables in the public schema. Use this for an overview of what ' +
        'tables exist when investigating data or schema issues.',
      parameters: {
        filter: {
          type: 'string',
          description: 'Optional substring to filter table names (e.g. "agent" to see all agent-related tables)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const filter = (params.filter as string) ?? '';

        try {
          const tables = await systemQuery(
            `SELECT t.table_name,
                    (SELECT COUNT(*) FROM information_schema.columns c
                     WHERE c.table_schema = 'public' AND c.table_name = t.table_name) as column_count
             FROM information_schema.tables t
             WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
               AND ($1 = '' OR t.table_name LIKE '%' || $1 || '%')
             ORDER BY t.table_name`,
            [filter],
          );

          return {
            success: true,
            data: JSON.stringify({
              tableCount: tables.length,
              tables: tables.map((t: Record<string, unknown>) => ({
                name: t.table_name,
                columns: Number(t.column_count),
              })),
            }, null, 2),
          };
        } catch (err) {
          return { success: false, error: `Failed to list tables: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'check_tool_health',
      description:
        'Run a health check on a specific agent\'s recent tool executions. Shows which tools ' +
        'succeeded vs failed recently and the error messages for failures. Useful for diagnosing ' +
        'recurring tool problems.',
      parameters: {
        agent_role: {
          type: 'string',
          description: 'The agent role to check (e.g. "head-of-hr", "cto")',
          required: true,
        },
        hours: {
          type: 'number',
          description: 'Look back this many hours (default: 24)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        const role = params.agent_role as string;
        const hours = (params.hours as number) ?? 24;

        try {
          // Check recent activity for tool errors
          const logs = await systemQuery(
            `SELECT action, details, created_at
             FROM activity_log
             WHERE agent_role = $1
               AND created_at > NOW() - INTERVAL '1 hour' * $2
             ORDER BY created_at DESC
             LIMIT 50`,
            [role, hours],
          );

          // Also check agent_runs for errors
          const runs = await systemQuery(
            `SELECT status, error_message, started_at, finished_at
             FROM agent_runs
             WHERE agent_id = $1
               AND started_at > NOW() - INTERVAL '1 hour' * $2
             ORDER BY started_at DESC
             LIMIT 20`,
            [role, hours],
          );

          const failedRuns = runs.filter((r: Record<string, unknown>) =>
            r.status === 'failed' || r.status === 'error',
          );

          return {
            success: true,
            data: JSON.stringify({
              agent: role,
              lookbackHours: hours,
              activityLogs: logs.length,
              totalRuns: runs.length,
              failedRuns: failedRuns.length,
              recentErrors: failedRuns.map((r: Record<string, unknown>) => ({
                status: r.status,
                error: r.error_message,
                at: r.started_at,
              })),
              recentActivity: logs.slice(0, 10).map((l: Record<string, unknown>) => ({
                action: l.action,
                details: typeof l.details === 'string' ? l.details.slice(0, 200) : l.details,
                at: l.created_at,
              })),
            }, null, 2),
          };
        } catch (err) {
          return { success: false, error: `Health check failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}
