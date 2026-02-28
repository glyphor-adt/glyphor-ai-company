/**
 * Shared Tool Request Tools
 *
 * Allows any agent to request a new tool that doesn't exist yet.
 * Requests are stored in the `tool_requests` table and routed through
 * the decision system (Yellow tier) for CTO review and approval.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { isKnownTool } from '@glyphor/agent-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createToolRequestTools(
  supabase: SupabaseClient,
): ToolDefinition[] {
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
        const { data: existing } = await supabase
          .from('tool_requests')
          .select('id, status')
          .eq('tool_name', toolName)
          .in('status', ['pending', 'approved', 'building'])
          .limit(1);

        if (existing && existing.length > 0) {
          return {
            success: false,
            error: `A request for tool "${toolName}" already exists (status: ${existing[0].status}, id: ${existing[0].id}). Wait for it to be processed.`,
          };
        }

        // Create the tool request
        const { data: request, error } = await supabase
          .from('tool_requests')
          .insert({
            requested_by: ctx.agentRole,
            tool_name: toolName,
            description,
            justification,
            use_case: useCase,
            suggested_category: (params.suggested_category as string) ?? null,
            directive_id: (params.directive_id as string) ?? null,
            suggested_api_config: params.suggested_api_config ?? null,
            suggested_parameters: params.suggested_parameters ?? null,
            status: 'pending',
          })
          .select('id')
          .single();

        if (error) return { success: false, error: error.message };

        // Auto-file a Yellow decision for CTO review
        const { error: decisionErr } = await supabase
          .from('decisions')
          .insert({
            tier: 'yellow',
            status: 'pending',
            title: `New tool request: ${toolName}`,
            summary: `${ctx.agentRole} is requesting a new tool "${toolName}": ${description}\n\nJustification: ${justification}\n\nUse case: ${useCase}`,
            proposed_by: ctx.agentRole,
            reasoning: justification,
            assigned_to: ['cto'],
          });

        if (decisionErr) {
          // Request was created but decision failed — not fatal
          return {
            success: true,
            data: {
              request_id: request.id,
              tool_name: toolName,
              status: 'pending',
              warning: `Tool request created but decision filing failed: ${decisionErr.message}. Alert Marcus (CTO) directly.`,
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
        if (params.request_id) {
          const { data, error } = await supabase
            .from('tool_requests')
            .select('*')
            .eq('id', params.request_id as string)
            .single();

          if (error) return { success: false, error: error.message };
          return { success: true, data };
        }

        // List all requests by this agent
        const { data, error } = await supabase
          .from('tool_requests')
          .select('id, tool_name, status, review_notes, created_at')
          .eq('requested_by', ctx.agentRole)
          .order('created_at', { ascending: false })
          .limit(20);

        if (error) return { success: false, error: error.message };
        return { success: true, data: { requests: data } };
      },
    },
  ];
}
