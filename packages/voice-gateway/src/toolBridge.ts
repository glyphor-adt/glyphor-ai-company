/**
 * Tool Bridge — Bridges OpenAI Realtime function calls to the existing agent tool system
 *
 * Converts ToolDefinition[] from the agent runtime into OpenAI Realtime
 * function declarations, and executes tool calls using the same
 * ToolExecutor the text-chat agents use.
 */

import type { CompanyAgentRole, ToolDefinition, ToolParameter, ToolContext, ToolResult } from '@glyphor/agent-runtime';
import type { VoiceToolDeclaration } from './types.js';

/**
 * Convert internal ToolDefinition parameters to JSON Schema for OpenAI Realtime.
 */
function parameterToJsonSchema(param: ToolParameter): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: param.type,
    description: param.description,
  };
  if (param.enum) schema.enum = param.enum;
  if (param.items) schema.items = parameterToJsonSchema(param.items);
  if (param.properties) {
    const props: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(param.properties)) {
      props[key] = parameterToJsonSchema(val);
    }
    schema.properties = props;
  }
  return schema;
}

/**
 * Convert the agent's ToolDefinition[] into OpenAI Realtime tool declarations.
 */
export function toRealtimeTools(tools: ToolDefinition[]): VoiceToolDeclaration[] {
  return tools.map((tool) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [name, param] of Object.entries(tool.parameters)) {
      properties[name] = parameterToJsonSchema(param);
      if (param.required) required.push(name);
    }

    return {
      type: 'function' as const,
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    };
  });
}

/**
 * Execute an agent tool by name. Returns the result as a string for the Realtime API.
 */
export async function executeVoiceTool(
  tools: ToolDefinition[],
  toolName: string,
  argsJson: string,
  context: ToolContext,
): Promise<string> {
  const tool = tools.find((t) => t.name === toolName);
  if (!tool) {
    return JSON.stringify({ success: false, error: `Unknown tool: ${toolName}` });
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return JSON.stringify({ success: false, error: 'Invalid JSON arguments' });
  }

  try {
    const result = await tool.execute(args, context);
    if (typeof result.data === 'string') return result.data;
    return JSON.stringify(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ success: false, error: message });
  }
}
