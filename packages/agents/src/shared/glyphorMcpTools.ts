/**
 * Glyphor MCP Tools — Async factory for Glyphor's own MCP servers
 *
 * Enable with env var: GLYPHOR_MCP_ENABLED=true
 * Configure server URLs via env vars:
 *   GLYPHOR_MCP_DATA_URL, GLYPHOR_MCP_MARKETING_URL, GLYPHOR_MCP_ENGINEERING_URL,
 *   GLYPHOR_MCP_DESIGN_URL, GLYPHOR_MCP_FINANCE_URL
 *
 * Per-agent auth: Each agent has an Entra app registration with assigned app roles.
 * The bridge acquires a token per agent identity and passes it to MCP servers.
 * Agent identity mapping is in config/agentIdentities.json + config/agentEntraRoles.ts.
 */

import type { ToolDefinition, ToolParameter, ToolResult, ToolContext } from '@glyphor/agent-runtime';

// ── Agent Identity Lookup ───────────────────────────────────────

let agentIdentities: Record<string, { appId: string; spId: string }> | null = null;

function loadAgentIdentities(): Record<string, { appId: string; spId: string }> {
  if (agentIdentities) return agentIdentities;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    agentIdentities = require('../../agent-runtime/src/config/agentIdentities.json');
    return agentIdentities!;
  } catch {
    agentIdentities = {};
    return {};
  }
}

// ── Per-Agent Token Acquisition ─────────────────────────────────

const tokenCache: Map<string, { token: string; expiresAt: number }> = new Map();

/**
 * Acquire an access token for the given agent's Entra identity.
 * Uses client credentials flow with the agent's own app registration.
 *
 * The token includes the agent's assigned app roles as claims,
 * which the MCP server uses for scope-based tool filtering.
 */
async function getAgentToken(agentRole: string, audience: string): Promise<string | null> {
  const cacheKey = `${agentRole}:${audience}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const identities = loadAgentIdentities();
  const identity = identities[agentRole];
  if (!identity?.appId) return null;

  const tenantId = process.env.AGENT365_TENANT_ID ?? process.env.AZURE_TENANT_ID;
  const clientSecret = process.env.AGENT365_CLIENT_SECRET;
  if (!tenantId || !clientSecret) return null;

  try {
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: identity.appId,
      client_secret: clientSecret,
      scope: `${audience}/.default`,
    });

    const resp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as { access_token: string; expires_in: number };
    const token = data.access_token;
    // Cache with 5-minute safety margin
    tokenCache.set(cacheKey, {
      token,
      expiresAt: Date.now() + (data.expires_in - 300) * 1000,
    });
    return token;
  } catch {
    return null;
  }
}

// ── Server Configuration ────────────────────────────────────────

const GLYPHOR_MCP_SERVERS: Record<string, string> = {
  'mcp_GlyphorData': process.env.GLYPHOR_MCP_DATA_URL ?? '',
  'mcp_GlyphorMarketing': process.env.GLYPHOR_MCP_MARKETING_URL ?? '',
  'mcp_GlyphorEngineering': process.env.GLYPHOR_MCP_ENGINEERING_URL ?? '',
  'mcp_GlyphorDesign': process.env.GLYPHOR_MCP_DESIGN_URL ?? '',
  'mcp_GlyphorFinance': process.env.GLYPHOR_MCP_FINANCE_URL ?? '',
  'mcp_GlyphorEmail': process.env.GLYPHOR_MCP_EMAIL_URL ?? '',
};

// ── Schema Conversion ───────────────────────────────────────────

/**
 * Convert a single MCP tool schema into a Glyphor ToolDefinition,
 * routing execute() calls via HTTP JSON-RPC to the MCP server.
 * Includes per-agent auth token in requests when available.
 */
function convertMcpTool(
  mcpTool: Record<string, unknown>,
  serverUrl: string,
  authToken: string | null,
  agentRole?: string,
): ToolDefinition {
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
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        if (agentRole) headers['X-Agent-Role'] = agentRole;

        const response = await fetch(serverUrl, {
          method: 'POST',
          headers,
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
 * @param agentRole  Agent role for per-agent Entra identity auth. When provided,
 *                   acquires an access token scoped to the agent's app roles.
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

  // Acquire per-agent auth token (shared across all Glyphor MCP servers)
  const blueprintAudience = process.env.GLYPHOR_MCP_AUDIENCE ?? '5604df3b-a3a3-4c7e-a8c4-e6f9ed04ad6a';
  const authToken = agentRole ? await getAgentToken(agentRole, blueprintAudience) : null;

  const allTools: ToolDefinition[] = [];

  for (const [serverName, serverUrl] of entries) {
    if (!serverUrl) continue;

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      if (agentRole) headers['X-Agent-Role'] = agentRole;

      const response = await fetch(serverUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
      });
      const result = (await response.json()) as Record<string, unknown>;

      if (result.error) {
        console.warn(`[GlyphorMCP] ${serverName} returned error:`, result.error);
        continue;
      }

      const tools = (result.result as Record<string, unknown>[] | undefined) ?? [];
      for (const mcpTool of tools) {
        allTools.push(convertMcpTool(mcpTool, serverUrl, authToken, agentRole));
      }

      console.log(`[GlyphorMCP] ${serverName}: ${tools.length} tools (agent=${agentRole ?? 'anon'})`);
    } catch (err) {
      console.warn(`[GlyphorMCP] Failed to connect to ${serverName}:`, (err as Error).message);
    }
  }

  return allTools;
}
