/**
 * Glyphor MCP Tools — Async factory for Glyphor's own MCP servers
 *
 * Enable with env var: GLYPHOR_MCP_ENABLED=true
 * Configure server URLs via env vars:
 *   GLYPHOR_MCP_DATA_URL, GLYPHOR_MCP_MARKETING_URL, GLYPHOR_MCP_ENGINEERING_URL,
 *   GLYPHOR_MCP_DESIGN_URL, GLYPHOR_MCP_FINANCE_URL
 *
 * Auth: Uses GCP identity tokens for Cloud Run service-to-service authentication.
 * On GCP, tokens are fetched from the metadata server. Locally, uses ADC.
 * Agent role is passed via X-Agent-Role header for tool-level authorization.
 */

import type { ToolDefinition, ToolParameter, ToolResult, ToolContext } from '@glyphor/agent-runtime';

// ── GCP Identity Token (Cloud Run service-to-service auth) ───────

const gcpIdTokenCache: Map<string, { token: string; expiresAt: number }> = new Map();

/**
 * Acquire a GCP identity token for Cloud Run service-to-service auth.
 * Uses the metadata server on GCP, or google-auth-library locally.
 * The audience must be the base URL of the target Cloud Run service.
 */
async function getGcpIdentityToken(audience: string): Promise<string | null> {
  const cached = gcpIdTokenCache.get(audience);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  // Extract base URL (audience) from the full /mcp URL
  const baseUrl = audience.replace(/\/mcp$/, '');

  try {
    // On GCP: use metadata server for identity token
    const metadataUrl = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(baseUrl)}`;
    const metaResp = await fetch(metadataUrl, {
      headers: { 'Metadata-Flavor': 'Google' },
    });
    if (metaResp.ok) {
      const token = await metaResp.text();
      // Identity tokens from metadata server are valid for ~1 hour; cache with 5-min margin
      gcpIdTokenCache.set(audience, { token, expiresAt: Date.now() + 55 * 60 * 1000 });
      return token;
    }
  } catch {
    // Not on GCP — fall through to ADC
  }

  try {
    const { GoogleAuth } = await import('google-auth-library');
    const auth = new GoogleAuth();
    const client = await auth.getIdTokenClient(baseUrl);
    const headers = await client.getRequestHeaders();
    const token = headers['Authorization']?.replace('Bearer ', '') ?? null;
    if (token) {
      gcpIdTokenCache.set(audience, { token, expiresAt: Date.now() + 55 * 60 * 1000 });
    }
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
  'mcp_GlyphorLegal': process.env.GLYPHOR_MCP_LEGAL_URL ?? '',
  'mcp_GlyphorHR': process.env.GLYPHOR_MCP_HR_URL ?? '',
  'mcp_GlyphorEmailMarketing': process.env.GLYPHOR_MCP_EMAIL_MARKETING_URL ?? '',
};

function getDefaultGlyphorServers(agentRole?: string): string[] {
  if (!agentRole) return Object.keys(GLYPHOR_MCP_SERVERS);
  if (['cto', 'platform-engineer', 'quality-engineer', 'devops-engineer', 'frontend-engineer'].includes(agentRole)) {
    return ['mcp_GlyphorEngineering', 'mcp_GlyphorData'];
  }
  if (['cmo', 'content-creator', 'seo-analyst', 'social-media-manager'].includes(agentRole)) {
    return ['mcp_GlyphorMarketing', 'mcp_GlyphorEmailMarketing', 'mcp_GlyphorData'];
  }
  if (['cfo', 'cost-analyst', 'revenue-analyst', 'ai-impact-analyst'].includes(agentRole)) {
    return ['mcp_GlyphorFinance', 'mcp_GlyphorData'];
  }
  if (['clo'].includes(agentRole)) {
    return ['mcp_GlyphorLegal', 'mcp_GlyphorData'];
  }
  if (['head-of-hr'].includes(agentRole)) {
    return ['mcp_GlyphorHR', 'mcp_GlyphorData'];
  }
  if (['vp-design', 'ui-ux-designer', 'design-critic', 'template-architect'].includes(agentRole)) {
    return ['mcp_GlyphorDesign', 'mcp_GlyphorData'];
  }
  return Object.keys(GLYPHOR_MCP_SERVERS);
}

// ── Schema Conversion ───────────────────────────────────────────

/**
 * Convert a single MCP tool schema into a Glyphor ToolDefinition,
 * routing execute() calls via HTTP JSON-RPC to the MCP server.
 * Uses GCP identity tokens for Cloud Run auth and passes agent role header.
 */
function convertMcpTool(
  mcpTool: Record<string, unknown>,
  serverUrl: string,
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
        if (agentRole) headers['X-Agent-Role'] = agentRole;

        // Acquire GCP identity token for Cloud Run auth
        const gcpToken = await getGcpIdentityToken(serverUrl);
        if (gcpToken) headers['Authorization'] = `Bearer ${gcpToken}`;

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

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          return {
            success: false,
            error: `MCP server returned ${response.status} with non-JSON response (${contentType}). Service may require authentication or be unavailable.`,
          };
        }

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
 * @param agentRole  Agent role identifier, passed as X-Agent-Role header.
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
  const effectiveFilter = serverFilter && serverFilter.length > 0
    ? serverFilter
    : getDefaultGlyphorServers(agentRole);
  if (effectiveFilter.length > 0) {
    const filterSet = new Set(effectiveFilter);
    entries = entries.filter(([name]) => filterSet.has(name));
  }

  const MCP_PER_SERVER_TIMEOUT_MS = 10_000;
  const allTools: ToolDefinition[] = [];

  for (const [serverName, serverUrl] of entries) {
    if (!serverUrl) continue;

    try {
      const serverInit = async (): Promise<void> => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (agentRole) headers['X-Agent-Role'] = agentRole;

        // Acquire GCP identity token for Cloud Run service-to-service auth
        const gcpToken = await getGcpIdentityToken(serverUrl);
        if (gcpToken) headers['Authorization'] = `Bearer ${gcpToken}`;

        const response = await fetch(serverUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
          signal: AbortSignal.timeout(MCP_PER_SERVER_TIMEOUT_MS),
        });

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
          console.warn(`[GlyphorMCP] ${serverName} returned ${response.status} non-JSON (${contentType}). Auth issue or service down.`);
          return;
        }

        const result = (await response.json()) as Record<string, unknown>;

        if (result.error) {
          console.warn(`[GlyphorMCP] ${serverName} returned error:`, result.error);
          return;
        }

        const tools = (result.result as Record<string, unknown>[] | undefined) ?? [];
        for (const mcpTool of tools) {
          allTools.push(convertMcpTool(mcpTool, serverUrl, agentRole));
        }

        console.log(`[GlyphorMCP] ${serverName}: ${tools.length} tools (agent=${agentRole ?? 'anon'})`);
      };

      // Timeout guard: skip this server if init takes too long
      await Promise.race([
        serverInit(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timed out after ${MCP_PER_SERVER_TIMEOUT_MS}ms`)), MCP_PER_SERVER_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      console.warn(`[GlyphorMCP] Failed to connect to ${serverName} (skipping):`, (err as Error).message);
    }
  }

  return allTools;
}
