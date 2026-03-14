import type { CompanyAgentRole, ToolDeclaration } from './types.js';
import {
  ANTHROPIC_TOOL_SEARCH_NAME,
  ANTHROPIC_TOOL_SEARCH_TYPE,
  getAlwaysLoadedTools,
} from './toolSearchConfig.js';

export interface AnthropicToolSearchDeclaration {
  type: typeof ANTHROPIC_TOOL_SEARCH_TYPE;
  name: typeof ANTHROPIC_TOOL_SEARCH_NAME;
}

export interface AnthropicFunctionTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  defer_loading?: boolean;
}

export type AnthropicToolEntry = AnthropicToolSearchDeclaration | AnthropicFunctionTool;

export function buildAnthropicTools(
  role: CompanyAgentRole | undefined,
  allTools: ToolDeclaration[],
): AnthropicToolEntry[] {
  const alwaysLoaded = getAlwaysLoadedTools(role);
  const tools: AnthropicToolEntry[] = [
    {
      type: ANTHROPIC_TOOL_SEARCH_TYPE,
      name: ANTHROPIC_TOOL_SEARCH_NAME,
    },
  ];

  for (const tool of allTools) {
    tools.push({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
      defer_loading: tool.defer_loading ?? !alwaysLoaded.has(tool.name),
    });
  }

  return tools;
}
