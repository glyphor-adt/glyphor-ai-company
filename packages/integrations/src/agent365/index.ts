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
 *   - Uses MSAL client credentials flow to get tokens scoped to each MCP server's audience
 *   - Each agent authenticates via its Entra app identity (agentic auth) or shared app (OBO)
 *
 * @see https://learn.microsoft.com/en-us/microsoft-agent-365/developer/tooling
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpToolServerConfigurationService } from '@microsoft/agents-a365-tooling';
import type { MCPServerConfig, McpClientTool } from '@microsoft/agents-a365-tooling';
import type { ToolDefinition, ToolParameter, ToolResult, ToolContext } from '@glyphor/agent-runtime';
import { ConfidentialClientApplication } from '@azure/msal-node';

// ── Types ────────────────────────────────────────────────────────

export interface Agent365Config {
  /** Blueprint app client ID */
  clientId: string;
  /** Blueprint app client secret */
  clientSecret: string;
  /** Entra tenant ID */
  tenantId: string;
  /** Agent 365 Tools API audience (default: ea9ffc3e-8a23-4a7d-836d-234d7c7565c1) */
  audience?: string;
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

let msalApp: ConfidentialClientApplication | null = null;

function getMsalApp(config: Agent365Config): ConfidentialClientApplication {
  if (!msalApp) {
    msalApp = new ConfidentialClientApplication({
      auth: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
      },
    });
  }
  return msalApp;
}

async function acquireToken(config: Agent365Config): Promise<string> {
  const audience = config.audience ?? 'ea9ffc3e-8a23-4a7d-836d-234d7c7565c1';
  const app = getMsalApp(config);
  const result = await app.acquireTokenByClientCredential({
    scopes: [`${audience}/.default`],
  });
  if (!result?.accessToken) {
    throw new Error('MSAL returned no access token for Agent 365 Tools API');
  }
  return result.accessToken;
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
): Promise<{ client: Client; transport: StreamableHTTPClientTransport; tools: McpClientTool[] }> {
  if (!serverConfig.url) {
    throw new Error(`MCP Server URL missing for ${serverConfig.mcpServerName}`);
  }

  const headers: Record<string, string> = {
    ...serverConfig.headers as Record<string, string>,
    Authorization: `Bearer ${authToken}`,
  };

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
        const result = await mcpClient.callTool({
          name: mcpTool.name,
          arguments: callParams,
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
  // Acquire a bearer token via MSAL client credentials flow
  const authToken = await acquireToken(config);

  const configService = new McpToolServerConfigurationService();
  const connections: ActiveMcpConnection[] = [];
  const allTools: ToolDefinition[] = [];

  // Discover available MCP servers
  let serverConfigs = await configService.listToolServers(
    config.clientId,
    authToken,
  );

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
      const { client, transport, tools } = await connectToMcpServer(serverConfig, authToken);

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
      msalApp = null;
    },
  };
}

/**
 * Initialize Agent 365 MCP tools in development mode using ToolingManifest.json.
 * The manifest is read from the project root (or MCP_PLATFORM_ENDPOINT for mock server).
 *
 * Still requires MSAL credentials to authenticate with the MCP servers.
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
