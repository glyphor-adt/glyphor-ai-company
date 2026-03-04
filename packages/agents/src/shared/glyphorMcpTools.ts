/**
 * Glyphor MCP Tools — Async factory for Glyphor's own MCP servers
 *
 * Enable with env var: GLYPHOR_MCP_ENABLED=true
 * Configure server URLs via env vars:
 *   GLYPHOR_MCP_DATA_URL, GLYPHOR_MCP_MARKETING_URL, GLYPHOR_MCP_ENGINEERING_URL,
 *   GLYPHOR_MCP_DESIGN_URL, GLYPHOR_MCP_FINANCE_URL
 */

import type { ToolDefinition, ToolParameter, ToolResult, ToolContext } from '@glyphor/agent-runtime';

// ── Server Configuration ────────────────────────────────────────

const GLYPHOR_MCP_SERVERS: Record<string, string> = {
  'mcp_GlyphorData': process.env.GLYPHOR_MCP_DATA_URL ?? '',
  'mcp_GlyphorMarketing': process.env.GLYPHOR_MCP_MARKETING_URL ?? '',
  'mcp_GlyphorEngineering': process.env.GLYPHOR_MCP_ENGINEERING_URL ?? '',
  'mcp_GlyphorDesign': process.env.GLYPHOR_MCP_DESIGN_URL ?? '',
  'mcp_GlyphorFinance': process.env.GLYPHOR_MCP_FINANCE_URL ?? '',
};

// ── Schema Conversion ───────────────────────────────────────────

/**
 * Convert a single MCP tool schema into a Glyphor ToolDefinition,
 * routing execute() calls via HTTP JSON-RPC to the MCP server.
 */
function convertMcpTool(mcpTool: Record<string, unknown>, serverUrl: string): ToolDefinition {
  const inputSchema = (mcpTool.inputSchema as Record<string, unknown>) ?? {};
  const props = (inputSchema.properties as Record<string, Record<string, unknown>>) ?? {};
  const requiredList = (inputSchema.required as string[]) ?? [];
  const requiredSet = new Set(requiredList);

  const parameters: Record<string, ToolParameter> = {};
  for (const [key, schema] of Object.entries(props)) {
    parameters[key] = {
      type: ((schema as Record<string, unknown>).type as ToolParameter['type']) ?? 'string',
      description: ((schema as Record<string, unknown>).description as string) ?? '',
      required: requiredSet.has(key),
    };
  }

  const toolName = mcpTool.name as string;

  return {
    name: toolName,
    description: (mcpTool.description as string) ?? '',
    parameters,
    execute: async (params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> => {
      try {
        const response = await fetch(serverUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/call',
            id: Date.now(),
            params: { name: toolName, arguments: params },
          }),
        });
        const result = (await response.json()) as Record<string, unknown>;

        if (result.error) {
          const err = result.error as Record<string, unknown>;
          return { success: false, error: (err.message as string) ?? JSON.stringify(err) };
        }
        return { success: true, data: result.result };
      } catch (err) {
        return {
          success: false,
          error: `Glyphor MCP tool ${toolName} failed: ${(err as Error).message}`,
        };
      }
    },
  };
}

// ── Public Factory ──────────────────────────────────────────────

/**
 * Connect to Glyphor MCP servers and return discovered tools as ToolDefinitions.
 *
 * @param agentRole  Optional agent role hint (reserved for future role-based filtering).
 * @param serverFilter Optional list of MCP server names to load (e.g. ['mcp_GlyphorData']).
 *                     Loads all configured servers if omitted.
 *
 * Returns an empty array if:
 *   - GLYPHOR_MCP_ENABLED is not 'true'
 *   - No server URLs are configured
 *   - All MCP server connections fail (logs warnings, doesn't crash)
 */
export async function createGlyphorMcpTools(
  agentRole?: string,
  serverFilter?: string[],
): Promise<ToolDefinition[]> {
  if (process.env.GLYPHOR_MCP_ENABLED !== 'true') {
    return [];
  }

  // Determine which servers to contact
  let entries = Object.entries(GLYPHOR_MCP_SERVERS);
  if (serverFilter && serverFilter.length > 0) {
    const filterSet = new Set(serverFilter);
    entries = entries.filter(([name]) => filterSet.has(name));
  }

  const allTools: ToolDefinition[] = [];

  for (const [serverName, serverUrl] of entries) {
    if (!serverUrl) continue;

    try {
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
      });
      const result = (await response.json()) as Record<string, unknown>;

      if (result.error) {
        console.warn(`[GlyphorMCP] ${serverName} returned error:`, result.error);
        continue;
      }

      const tools = (result.result as Record<string, unknown>[] | undefined) ?? [];
      for (const mcpTool of tools) {
        allTools.push(convertMcpTool(mcpTool, serverUrl));
      }

      console.log(`[GlyphorMCP] Connected to ${serverName}: ${tools.length} tools available`);
    } catch (err) {
      console.warn(`[GlyphorMCP] Failed to connect to ${serverName}:`, (err as Error).message);
    }
  }

  return allTools;
}
