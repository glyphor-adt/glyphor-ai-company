import type { CompanyAgentRole, ToolDeclaration } from './types.js';
import { getAlwaysLoadedTools } from './toolSearchConfig.js';
import { TOOL_NAMESPACES, matchesNamespacePrefix } from './toolNamespaces.js';

export interface OpenAIFunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  defer_loading?: boolean;
}

export interface OpenAINamespaceTool {
  type: 'namespace';
  name: string;
  description: string;
  tools: OpenAIFunctionTool[];
}

export interface OpenAIToolSearchTool {
  type: 'tool_search';
}

export type OpenAIHostedTool = OpenAIToolSearchTool | OpenAINamespaceTool | OpenAIFunctionTool;

function toOpenAIFunction(
  tool: ToolDeclaration,
  alwaysLoaded: Set<string>,
): OpenAIFunctionTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    defer_loading: tool.defer_loading ?? !alwaysLoaded.has(tool.name),
  };
}

export function buildOpenAITools(
  role: CompanyAgentRole | undefined,
  allTools: ToolDeclaration[],
): OpenAIHostedTool[] {
  const alwaysLoaded = getAlwaysLoadedTools(role);
  const assigned = new Set<string>();
  const result: OpenAIHostedTool[] = [{ type: 'tool_search' }];

  for (const namespace of TOOL_NAMESPACES) {
    const namespaceTools: OpenAIFunctionTool[] = [];

    for (const tool of allTools) {
      if (!matchesNamespacePrefix(tool.name, namespace.toolPrefixes)) continue;
      if (assigned.has(tool.name)) continue;

      namespaceTools.push(toOpenAIFunction(tool, alwaysLoaded));
      assigned.add(tool.name);
    }

    if (namespaceTools.length > 0) {
      result.push({
        type: 'namespace',
        name: namespace.name,
        description: namespace.description,
        tools: namespaceTools,
      });
    }
  }

  for (const tool of allTools) {
    if (assigned.has(tool.name)) continue;
    result.push(toOpenAIFunction(tool, alwaysLoaded));
  }

  return result;
}
