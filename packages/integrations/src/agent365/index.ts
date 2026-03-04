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

// ── Types ────────────────────────────────────────────────────────

export interface Agent365Config {
  /** Agentic app ID from Agent 365 blueprint (Entra app registration) */
  agenticAppId: string;
  /** Bearer token for authenticating with Agent 365 tooling gateway */
  authToken: string;
  /** Override the MCP platform endpoint (default: production gateway) */
  mcpPlatformEndpoint?: string;
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

// ── MCP Connection Manager ──────────────────────────────────────

/**
 * Create a persistent MCP client connection to an Agent 365 MCP server.
 * Unlike the SDK's getMcpClientTools (which opens/lists/closes),
 * this keeps the connection alive for tool invocation.
 */
async function connectToMcpServer(
  serverConfig: MCPServerConfig,
): Promise<{ client: Client; transport: StreamableHTTPClientTransport; tools: McpClientTool[] }> {
  if (!serverConfig.url) {
    throw new Error(`MCP Server URL missing for ${serverConfig.mcpServerName}`);
  }

  const transport = new StreamableHTTPClientTransport(new URL(serverConfig.url), {
    requestInit: {
      headers: serverConfig.headers,
    },
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
): Promise<Agent365ToolBridge> {
  const configService = new McpToolServerConfigurationService();
  const connections: ActiveMcpConnection[] = [];
  const allTools: ToolDefinition[] = [];

  // Discover available MCP servers
  const serverConfigs = await configService.listToolServers(
    config.agenticAppId,
    config.authToken,
  );

  if (serverConfigs.length === 0) {
    console.warn('[Agent365] No MCP servers configured. Run "a365 develop add-mcp-servers" to add servers.');
    return { tools: [], close: async () => {} };
  }

  // Connect to each server and discover tools
  for (const serverConfig of serverConfigs) {
    try {
      const { client, transport, tools } = await connectToMcpServer(serverConfig);

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
    },
  };
}

/**
 * Initialize Agent 365 MCP tools in development mode using ToolingManifest.json.
 * The manifest is read from the project root (or MCP_PLATFORM_ENDPOINT for mock server).
 *
 * This is a convenience wrapper that sets NODE_ENV=development temporarily
 * so the SDK reads from ToolingManifest.json instead of the production gateway.
 */
export async function createAgent365ToolsFromManifest(): Promise<Agent365ToolBridge> {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';

  try {
    // In dev mode, the config service reads ToolingManifest.json directly
    // and doesn't need agenticAppId or authToken
    return await createAgent365Tools({
      agenticAppId: '',
      authToken: '',
    });
  } finally {
    // Restore original NODE_ENV
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  }
}

export type { MCPServerConfig, McpClientTool };
