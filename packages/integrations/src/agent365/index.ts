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
 *   - Uses Agent Identity Authentication via MsalTokenProvider.getAgenticUserToken()
 *   - This produces idtyp=user tokens using only client credentials (no refresh token)
 *   - The 3-step flow: app token → instance token → user_fic token exchange
 *   - Requires: blueprint app, published agent instance, agentic user created in Teams
 *
 * @see https://learn.microsoft.com/en-us/microsoft-agent-365/developer/identity
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpToolServerConfigurationService } from '@microsoft/agents-a365-tooling';
import { MsalTokenProvider } from '@microsoft/agents-hosting';
import type { AuthConfiguration } from '@microsoft/agents-hosting';
import type { MCPServerConfig, McpClientTool } from '@microsoft/agents-a365-tooling';
import type { ToolDefinition, ToolParameter, ToolResult, ToolContext } from '@glyphor/agent-runtime';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// ── Types ────────────────────────────────────────────────────────

export interface Agent365Config {
  /** Blueprint app client ID (Entra app registration for the agent) */
  clientId: string;
  /** Blueprint app client secret */
  clientSecret: string;
  /** Entra tenant ID */
  tenantId: string;
  /** Agent 365 Tools API audience (default: ea9ffc3e-8a23-4a7d-836d-234d7c7565c1) */
  audience?: string;
  /** Agent app instance ID — created when agent is installed in Teams */
  agentAppInstanceId?: string;
  /** Agentic user object ID — the directory identity created for this agent instance */
  agenticUserId?: string;
  /** Agent Identity Blueprint ID for gateway discovery (defaults to clientId if not set) */
  agenticAppId?: string;
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

function isDisabledMailTool(tool: McpClientTool, serverName: string): boolean {
  if (serverName !== 'mcp_MailTools') return false;

  const name = (tool.name ?? '').toLowerCase();

  // Temporary guard: disable search-only mail endpoints that intermittently return HTTP 500.
  // Match by tool name only so inbox/read/reply tools are never filtered out due to description text.
  return name.includes('search');
}

// ── Email Sanitization ───────────────────────────────────────────

/** Field names in MCP Mail tool arguments that may contain email body content. */
const MAIL_BODY_FIELDS = new Set(['body', 'content', 'html_content', 'htmlContent', 'Body', 'Content']);
const FOUNDER_EMAILS = ['kristina@glyphor.ai', 'andrew@glyphor.ai'] as const;

function normalizeEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const match = trimmed.match(/<([^>]+)>/);
  return (match ? match[1] : trimmed).trim();
}

function collectEmails(value: unknown): string[] {
  if (!value) return [];

  if (typeof value === 'string') {
    return value
      .split(/[;,]/)
      .map((entry) => normalizeEmail(entry))
      .filter((entry) => entry.includes('@'));
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectEmails(entry));
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const direct = obj.email ?? obj.address;
    if (typeof direct === 'string') {
      return collectEmails(direct);
    }

    const nested = obj.emailAddress;
    if (nested && typeof nested === 'object') {
      return collectEmails((nested as Record<string, unknown>).address);
    }
  }

  return [];
}

function getRecipientEmails(params: Record<string, unknown>, keys: string[]): string[] {
  const emails = keys.flatMap((key) => collectEmails(params[key]));
  return Array.from(new Set(emails));
}

function enforceFounderCc(params: Record<string, unknown>): Record<string, unknown> {
  const toEmails = getRecipientEmails(params, ['to', 'To', 'toRecipients', 'ToRecipients', 'recipients']);
  const ccEmails = getRecipientEmails(params, ['cc', 'Cc', 'ccRecipients', 'CcRecipients']);

  const hasInternalPeer = toEmails.some((email) => email.endsWith('@glyphor.ai') && !FOUNDER_EMAILS.includes(email as typeof FOUNDER_EMAILS[number]));
  if (!hasInternalPeer) {
    return params;
  }

  const existing = new Set([...toEmails, ...ccEmails]);
  const missingFounders = FOUNDER_EMAILS.filter((email) => !existing.has(email));
  if (missingFounders.length === 0) {
    return params;
  }

  if (Array.isArray(params.ccRecipients)) {
    const current = params.ccRecipients as unknown[];
    params.ccRecipients = [
      ...current,
      ...missingFounders.map((email) => ({ emailAddress: { address: email } })),
    ];
    return params;
  }

  if (Array.isArray(params.CcRecipients)) {
    const current = params.CcRecipients as unknown[];
    params.CcRecipients = [
      ...current,
      ...missingFounders.map((email) => ({ emailAddress: { address: email } })),
    ];
    return params;
  }

  if (typeof params.cc === 'string') {
    params.cc = [...ccEmails, ...missingFounders].join(', ');
    return params;
  }

  if (typeof params.Cc === 'string') {
    params.Cc = [...ccEmails, ...missingFounders].join(', ');
    return params;
  }

  params.ccRecipients = missingFounders.map((email) => ({ emailAddress: { address: email } }));
  return params;
}

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
  return enforceFounderCc(sanitized);
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

/** Singleton token provider — reused across calls for built-in caching */
let tokenProvider: MsalTokenProvider | null = null;

/**
 * Acquire a delegated access token for the Agent 365 Tools API
 * using Agent Identity Authentication (no refresh token needed).
 *
 * Uses MsalTokenProvider.getAgenticUserToken() which performs a 3-step
 * client-credentials-only flow:
 *   1. App token (blueprint client_credentials → AzureADTokenExchange)
 *   2. Instance token (instance client_credentials → AzureADTokenExchange)
 *   3. User FIC exchange (produces idtyp=user token with MCP scopes)
 */
async function acquireToken(config: Agent365Config): Promise<string> {
  if (!config.agentAppInstanceId || !config.agenticUserId) {
    throw new Error(
      '[Agent365] Agent identity not configured. ' +
      'Set AGENT365_APP_INSTANCE_ID and AGENT365_AGENTIC_USER_ID env vars. ' +
      'Create the agent instance by installing the published agent in Teams.'
    );
  }

  if (!tokenProvider) {
    const authConfig: AuthConfiguration = {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      tenantId: config.tenantId,
    };
    tokenProvider = new MsalTokenProvider(authConfig);
  }

  const audience = config.audience ?? 'ea9ffc3e-8a23-4a7d-836d-234d7c7565c1';
  const scopes = [`${audience}/.default`];

  const token = await tokenProvider.getAgenticUserToken(
    config.tenantId,
    config.agentAppInstanceId,
    config.agenticUserId,
    scopes,
  );

  return token;
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

  const baseDescription = (mcpTool.description ?? mcpTool.name).trim();

  return {
    name: mcpTool.name,
    description: `[Agent365 ${serverName}] ${baseDescription}`,
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
          console.warn(`[Agent365] MCP tool error from ${serverName}/${mcpTool.name}: ${errorText.slice(0, 300)}`);
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
        console.error(`[Agent365] MCP call failed for ${serverName}/${mcpTool.name}:`, (err as Error).message);
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
  // Acquire a delegated bearer token via agent identity auth
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
        if (isDisabledMailTool(mcpTool, serverConfig.mcpServerName)) {
          console.warn(`[Agent365] Skipping unstable MailTools search tool: ${mcpTool.name}`);
          continue;
        }
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
      tokenProvider = null;
    },
  };
}

/**
 * Initialize Agent 365 MCP tools in development mode using ToolingManifest.json.
 * The manifest is read from the project root (or MCP_PLATFORM_ENDPOINT for mock server).
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
