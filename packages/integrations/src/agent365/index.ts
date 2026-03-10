/**
 * Agent 365 MCP Bridge — Converts Microsoft Agent 365 MCP tools into Glyphor ToolDefinitions
 *
 * This module bridges the Agent 365 MCP servers (Mail, Calendar, SharePoint, Teams, Word, etc.)
 * with the Glyphor agent runtime's custom ToolDefinition format.
 *
 * Flow:
 *   1. Load ToolingManifest.json (dev) or query the tooling gateway (prod)
 *   2. Connect to each MCP server and discover available tools
 *   3. Convert MCP tool schemas → Glyphor ToolDefinition format
 *   4. Route tool execute() calls back through the MCP client
 *
 * Authentication:
 *   - Uses refresh_token grant to get delegated tokens scoped to each MCP server's audience
 *   - Agent 365 MCP requires idtyp=user tokens with scp claims (client credentials are blocked)
 *   - Refresh token stored as AGENT365_REFRESH_TOKEN env var (obtained once via interactive auth)
 *
 * @see https://learn.microsoft.com/en-us/microsoft-agent-365/developer/tooling
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpToolServerConfigurationService } from '@microsoft/agents-a365-tooling';
import type { MCPServerConfig, McpClientTool } from '@microsoft/agents-a365-tooling';
import type { ToolDefinition, ToolParameter, ToolResult, ToolContext } from '@glyphor/agent-runtime';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// ── Types ────────────────────────────────────────────────────────

export interface Agent365Config {
  /** Public client app ID used for delegated auth (Glyphor AI Bot app) */
  clientId: string;
  /** Entra app client secret (used only for client credentials fallback) */
  clientSecret: string;
  /** Entra tenant ID */
  tenantId: string;
  /** Agent 365 Tools API audience (default: ea9ffc3e-8a23-4a7d-836d-234d7c7565c1) */
  audience?: string;
  /** Agent Identity Blueprint ID for gateway discovery (defaults to clientId if not set) */
  agenticAppId?: string;
  /** Refresh token for delegated auth — silently renews access tokens without user interaction */
  refreshToken?: string;
}

export interface Agent365ToolBridge {
  /** All discovered MCP tools converted to ToolDefinitions */
  tools: ToolDefinition[];
  /** Close all active MCP client connections */
  close(): Promise<void>;
}

interface ActiveMcpConnection {
  serverName: string;
  client: Client;
  transport: StreamableHTTPClientTransport;
}

// ── Email Sanitization ───────────────────────────────────────────

/** Field names in MCP Mail tool arguments that may contain email body content. */
const MAIL_BODY_FIELDS = new Set(['body', 'content', 'html_content', 'htmlContent', 'Body', 'Content']);

/**
 * Strip markdown syntax from a string.
 * Agents must never send markdown-formatted emails — recipients see raw
 * asterisks, hashes, and brackets which look unprofessional.
 */
function stripMarkdownFromText(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(?<![\w*])\*([^*]+)\*(?![\w*])/g, '$1')
    .replace(/(?<![\w_])_([^_]+)_(?![\w_])/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```\w*\n?/g, '').trim())
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*_]{3,}$/gm, '');
}

/**
 * Sanitize MCP Mail tool arguments — strip markdown from email body fields.
 * Returns a new params object (does not mutate the original).
 */
function sanitizeMailToolParams(params: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...params };
  for (const [key, value] of Object.entries(sanitized)) {
    if (MAIL_BODY_FIELDS.has(key) && typeof value === 'string') {
      sanitized[key] = stripMarkdownFromText(value);
    }
  }
  return sanitized;
}

// ── Schema Conversion ────────────────────────────────────────────

/**
 * Convert a JSON Schema 'properties' object (from MCP inputSchema)
 * into our ToolParameter record format.
 */
function convertJsonSchemaToToolParams(
  properties: Record<string, Record<string, unknown>> | undefined,
  required: string[] | undefined,
): Record<string, ToolParameter> {
  if (!properties) return {};

  const params: Record<string, ToolParameter> = {};
  const requiredSet = new Set(required ?? []);

  for (const [key, schema] of Object.entries(properties)) {
    params[key] = convertSchemaProperty(key, schema, requiredSet);
  }

  return params;
}

function convertSchemaProperty(
  name: string,
  schema: Record<string, unknown>,
  requiredSet: Set<string>,
): ToolParameter {
  const typeStr = (schema.type as string) ?? 'string';
  const validTypes = ['string', 'number', 'boolean', 'object', 'array'] as const;
  const type = validTypes.includes(typeStr as typeof validTypes[number])
    ? (typeStr as ToolParameter['type'])
    : 'string';

  const param: ToolParameter = {
    type,
    description: (schema.description as string) ?? '',
    required: requiredSet.has(name),
  };

  if (schema.enum && Array.isArray(schema.enum)) {
    param.enum = schema.enum as string[];
  }

  if (type === 'array' && schema.items && typeof schema.items === 'object') {
    param.items = convertSchemaProperty('_item', schema.items as Record<string, unknown>, new Set());
  }

  if (type === 'object' && schema.properties && typeof schema.properties === 'object') {
    param.properties = convertJsonSchemaToToolParams(
      schema.properties as Record<string, Record<string, unknown>>,
      schema.required as string[] | undefined,
    );
  }

  return param;
}

// ── Token Acquisition ────────────────────────────────────────────

/** Cached access token to avoid re-acquiring on every tool call within a single run */
let cachedAccessToken: string | null = null;
let cachedTokenExpiry = 0;

/**
 * Acquire a delegated access token for the Agent 365 Tools API.
 *
 * Uses the OAuth 2.0 refresh_token grant to silently obtain a new access token
 * without user interaction. The refresh token itself is renewed on each use,
 * so it stays valid indefinitely as long as agents run regularly.
 *
 * This produces `idtyp=user` tokens with `scp` claim containing MCP scopes,
 * which is what Agent 365 MCP servers require. Client credentials (app tokens)
 * are explicitly blocked by Entra for agentic apps (AADSTS82001).
 */
async function acquireToken(config: Agent365Config): Promise<string> {
  // Return cached token if still valid (with 5 min buffer)
  if (cachedAccessToken && Date.now() < cachedTokenExpiry - 300_000) {
    return cachedAccessToken;
  }

  if (!config.refreshToken) {
    throw new Error(
      '[Agent365] No refresh token configured. ' +
      'Agent 365 MCP requires delegated (user) tokens — client credentials are blocked for agentic apps. ' +
      'Run the token acquisition script to obtain a refresh token and store it as AGENT365_REFRESH_TOKEN in GCP secrets.'
    );
  }

  const audience = config.audience ?? 'ea9ffc3e-8a23-4a7d-836d-234d7c7565c1';
  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: config.refreshToken,
    scope: `${audience}/.default offline_access`,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`[Agent365] Token refresh failed (${response.status}): ${errorBody}`);
  }

  const tokenResponse = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  if (!tokenResponse.access_token) {
    throw new Error('[Agent365] Token refresh returned no access token');
  }

  cachedAccessToken = tokenResponse.access_token;
  cachedTokenExpiry = Date.now() + tokenResponse.expires_in * 1000;

  // Persist rotated refresh token to GCP Secret Manager so it survives restarts
  if (tokenResponse.refresh_token && tokenResponse.refresh_token !== config.refreshToken) {
    console.log('[Agent365] Refresh token was rotated — saving to GCP Secret Manager');
    saveRotatedRefreshToken(tokenResponse.refresh_token).catch((err) =>
      console.error('[Agent365] Failed to save rotated refresh token:', (err as Error).message)
    );
    // Update in-memory config so subsequent calls within this process use the new token
    config.refreshToken = tokenResponse.refresh_token;
  }

  return cachedAccessToken;
}

/**
 * Save a rotated refresh token back to GCP Secret Manager.
 * Uses the metadata server for auth (works on Cloud Run without a service account key).
 */
async function saveRotatedRefreshToken(newToken: string): Promise<void> {
  const project = process.env.GCP_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? 'ai-glyphor-company';
  const secretName = 'agent365-refresh-token';

  // Get access token from metadata server
  const metaResp = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } }
  );
  if (!metaResp.ok) throw new Error(`Metadata server returned ${metaResp.status}`);
  const { access_token: gcpToken } = await metaResp.json() as { access_token: string };

  // Add new secret version via REST API
  const payload = Buffer.from(newToken).toString('base64');
  const addResp = await fetch(
    `https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${secretName}:addVersion`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${gcpToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { data: payload } }),
    }
  );
  if (!addResp.ok) {
    const body = await addResp.text();
    throw new Error(`Secret Manager returned ${addResp.status}: ${body}`);
  }
  console.log('[Agent365] Rotated refresh token saved to GCP Secret Manager');
}

async function discoverServerConfigs(
  configService: McpToolServerConfigurationService,
  clientId: string,
  authToken: string,
): Promise<MCPServerConfig[]> {
  try {
    return await configService.listToolServers(clientId, authToken);
  } catch (err) {
    const message = (err as Error).message;
    console.warn(`[Agent365] Tooling gateway discovery failed, falling back to ToolingManifest.json: ${message}`);
    return loadServerConfigsFromManifest();
  }
}

function loadServerConfigsFromManifest(): MCPServerConfig[] {
  let manifestPath = path.join(process.cwd(), 'ToolingManifest.json');
  if (!existsSync(manifestPath)) {
    manifestPath = path.join(path.dirname(process.argv[1] || ''), 'ToolingManifest.json');
  }
  if (!existsSync(manifestPath)) {
    console.warn(`[Agent365] ToolingManifest.json not found at ${manifestPath}`);
    return [];
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      mcpServers?: Array<Record<string, unknown>>;
    };
    const serverConfigs: MCPServerConfig[] = [];
    for (const server of manifest.mcpServers ?? []) {
      const mcpServerName = typeof server.mcpServerName === 'string'
        ? server.mcpServerName
        : typeof server.mcpServerUniqueName === 'string'
          ? server.mcpServerUniqueName
          : null;
      const url = typeof server.url === 'string' ? server.url : null;
      if (!mcpServerName || !url) continue;
      serverConfigs.push({
        mcpServerName,
        url,
        headers: typeof server.headers === 'object' ? server.headers as Record<string, string> : undefined,
      });
    }
    return serverConfigs;
  } catch (err) {
    console.warn(`[Agent365] Failed to read ToolingManifest.json: ${(err as Error).message}`);
    return [];
  }
}

// ── MCP Connection Manager ──────────────────────────────────────

/**
 * Create a persistent MCP client connection to an Agent 365 MCP server.
 * Unlike the SDK's getMcpClientTools (which opens/lists/closes),
 * this keeps the connection alive for tool invocation.
 */
async function connectToMcpServer(
  serverConfig: MCPServerConfig,
  authToken: string,
  agenticAppId?: string,
): Promise<{ client: Client; transport: StreamableHTTPClientTransport; tools: McpClientTool[] }> {
  if (!serverConfig.url) {
    throw new Error(`MCP Server URL missing for ${serverConfig.mcpServerName}`);
  }

  const headers: Record<string, string> = {
    ...serverConfig.headers as Record<string, string>,
    Authorization: `Bearer ${authToken}`,
  };
  // x-ms-agentid tells the MCP server which blueprint is making the request
  // so it can look up the blueprint's configured inheritable permissions
  if (agenticAppId) {
    headers['x-ms-agentid'] = agenticAppId;
  }

  const transport = new StreamableHTTPClientTransport(new URL(serverConfig.url), {
    requestInit: { headers },
  });

  const client = new Client({
    name: `glyphor-${serverConfig.mcpServerName}`,
    version: '1.0',
  });

  await client.connect(transport);

  const toolsResult = await client.listTools();
  const tools = toolsResult.tools as McpClientTool[];

  return { client, transport, tools };
}

/**
 * Convert a single MCP tool into a Glyphor ToolDefinition,
 * routing execute() calls through the connected MCP client.
 */
function mcpToolToToolDefinition(
  mcpTool: McpClientTool,
  mcpClient: Client,
  serverName: string,
): ToolDefinition {
  const params = convertJsonSchemaToToolParams(
    mcpTool.inputSchema.properties as Record<string, Record<string, unknown>> | undefined,
    mcpTool.inputSchema.required,
  );

  return {
    name: mcpTool.name,
    description: mcpTool.description ?? `[Agent 365 ${serverName}] ${mcpTool.name}`,
    parameters: params,
    execute: async (callParams: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> => {
      try {
        // Strip markdown from email body fields for Mail tools
        const sanitizedParams = serverName === 'mcp_MailTools'
          ? sanitizeMailToolParams(callParams)
          : callParams;

        const result = await mcpClient.callTool({
          name: mcpTool.name,
          arguments: sanitizedParams,
        });

        // MCP results have .content (array of content blocks) and .isError
        if (result.isError) {
          const errorText = Array.isArray(result.content)
            ? result.content.map((c: { text?: string }) => c.text ?? '').join('\n')
            : String(result.content);
          return { success: false, error: errorText };
        }

        // Extract text content
        const data = Array.isArray(result.content)
          ? result.content.map((c: { type?: string; text?: string }) => {
              if (c.type === 'text') return c.text;
              return JSON.stringify(c);
            }).join('\n')
          : result.content;

        return { success: true, data };
      } catch (err) {
        return {
          success: false,
          error: `Agent 365 MCP tool ${mcpTool.name} failed: ${(err as Error).message}`,
        };
      }
    },
  };
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Initialize Agent 365 MCP tools for a Glyphor agent run.
 *
 * Connects to all configured MCP servers, discovers their tools,
 * and returns them as standard Glyphor ToolDefinitions.
 *
 * Usage:
 *   const bridge = await createAgent365Tools(config);
 *   // Add bridge.tools to the agent's tool array
 *   // Call bridge.close() when the agent run finishes
 */
export async function createAgent365Tools(
  config: Agent365Config,
  /** Optional list of MCP server names to load (e.g. ['mcp_CalendarTools', 'mcp_TeamsServer']). Loads all if omitted. */
  serverFilter?: string[],
): Promise<Agent365ToolBridge> {
  // Acquire a delegated bearer token via refresh token flow
  const authToken = await acquireToken(config);

  const configService = new McpToolServerConfigurationService();
  const connections: ActiveMcpConnection[] = [];
  const allTools: ToolDefinition[] = [];

  // Discover available MCP servers (use agenticAppId for gateway, falls back to clientId)
  const agenticAppId = config.agenticAppId ?? config.clientId;
  let serverConfigs = await discoverServerConfigs(configService, agenticAppId, authToken);

  if (serverConfigs.length === 0) {
    console.warn('[Agent365] No MCP servers configured. Run "a365 develop add-mcp-servers" to add servers.');
    return { tools: [], close: async () => {} };
  }

  // Apply server filter if provided
  if (serverFilter && serverFilter.length > 0) {
    const filterSet = new Set(serverFilter);
    serverConfigs = serverConfigs.filter(s => filterSet.has(s.mcpServerName));
  }

  // Connect to each server and discover tools
  for (const serverConfig of serverConfigs) {
    try {
      const { client, transport, tools } = await connectToMcpServer(serverConfig, authToken, agenticAppId);

      connections.push({
        serverName: serverConfig.mcpServerName,
        client,
        transport,
      });

      // Convert each MCP tool to a Glyphor ToolDefinition
      for (const mcpTool of tools) {
        allTools.push(mcpToolToToolDefinition(mcpTool, client, serverConfig.mcpServerName));
      }

      console.log(`[Agent365] Connected to ${serverConfig.mcpServerName}: ${tools.length} tools available`);
    } catch (err) {
      console.error(`[Agent365] Failed to connect to ${serverConfig.mcpServerName}:`, (err as Error).message);
    }
  }

  return {
    tools: allTools,
    close: async () => {
      for (const conn of connections) {
        try {
          await conn.client.close();
        } catch {
          // Ignore close errors
        }
      }
      connections.length = 0;
      cachedAccessToken = null;
      cachedTokenExpiry = 0;
    },
  };
}

/**
 * Initialize Agent 365 MCP tools in development mode using ToolingManifest.json.
 * The manifest is read from the project root (or MCP_PLATFORM_ENDPOINT for mock server).
 *
 * Still requires a refresh token to authenticate with the MCP servers.
 */
export async function createAgent365ToolsFromManifest(
  config: Agent365Config,
): Promise<Agent365ToolBridge> {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';

  try {
    return await createAgent365Tools(config);
  } finally {
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  }
}

export type { MCPServerConfig, McpClientTool };
