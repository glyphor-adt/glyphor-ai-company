/**
 * Agent 365 Teams Chat Client — Direct MCP bridge for posting chat messages
 *
 * Uses the mcp_TeamsServer MCP server (mcp_graph_chat_postMessage tool) to
 * post messages into Teams chats via delegated permissions. This bypasses the
 * Graph API restriction that blocks app-only tokens from posting chat messages.
 *
 * The Agent 365 MCP server authenticated under the agent blueprint's service
 * principal acts with the delegated oauth2PermissionGrants (McpServers.Teams.All)
 * assigned to each agent identity.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpToolServerConfigurationService } from '@microsoft/agents-a365-tooling';
import type { MCPServerConfig } from '@microsoft/agents-a365-tooling';
import { ConfidentialClientApplication } from '@azure/msal-node';

// ── Singleton ────────────────────────────────────────────────────

let instance: A365TeamsChatClient | null = null;

export class A365TeamsChatClient {
  private mcpClient: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private msalApp: ConfidentialClientApplication;
  private audience: string;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly tenantId: string,
    audience?: string,
  ) {
    this.audience = audience ?? 'ea9ffc3e-8a23-4a7d-836d-234d7c7565c1';
    this.msalApp = new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: `https://login.microsoftonline.com/${tenantId}`,
      },
    });
  }

  /**
   * Create / get a singleton instance from env vars.
   * Returns null if AGENT365_ENABLED is not 'true' or credentials are missing.
   */
  static fromEnv(): A365TeamsChatClient | null {
    if (instance) return instance;
    if (process.env.AGENT365_ENABLED !== 'true') return null;

    const clientId = process.env.AGENT365_CLIENT_ID;
    const clientSecret = process.env.AGENT365_CLIENT_SECRET;
    const tenantId = process.env.AGENT365_TENANT_ID;
    if (!clientId || !clientSecret || !tenantId) return null;

    instance = new A365TeamsChatClient(clientId, clientSecret, tenantId);
    return instance;
  }

  /** Acquire MSAL token for the Agent 365 Tools API */
  private async getToken(): Promise<string> {
    const result = await this.msalApp.acquireTokenByClientCredential({
      scopes: [`${this.audience}/.default`],
    });
    if (!result?.accessToken) {
      throw new Error('MSAL returned no access token for Agent 365 Tools API');
    }
    return result.accessToken;
  }

  /** Connect to the mcp_TeamsServer MCP endpoint (lazy, reusable) */
  private async ensureConnected(): Promise<Client> {
    if (this.mcpClient) return this.mcpClient;

    const authToken = await this.getToken();

    // Discover the mcp_TeamsServer config
    const configService = new McpToolServerConfigurationService();
    const allServers = await configService.listToolServers(this.clientId, authToken);
    const teamsServer = allServers.find(
      (s: MCPServerConfig) => s.mcpServerName === 'mcp_TeamsServer',
    );

    if (!teamsServer?.url) {
      throw new Error('[A365Teams] mcp_TeamsServer not found in server configuration');
    }

    const headers: Record<string, string> = {
      ...(teamsServer.headers as Record<string, string>),
      Authorization: `Bearer ${authToken}`,
    };

    this.transport = new StreamableHTTPClientTransport(new URL(teamsServer.url), {
      requestInit: { headers },
    });

    this.mcpClient = new Client({
      name: 'glyphor-teams-chat-reply',
      version: '1.0',
    });

    await this.mcpClient.connect(this.transport);
    console.log('[A365Teams] Connected to mcp_TeamsServer');
    return this.mcpClient;
  }

  /**
   * Post a message in a Teams chat using the Agent 365 MCP server.
   * Uses mcp_graph_chat_postMessage (POST /v1.0/chats/{chat-id}/messages).
   */
  async postChatMessage(chatId: string, content: string): Promise<void> {
    const client = await this.ensureConnected();

    const result = await client.callTool({
      name: 'mcp_graph_chat_postMessage',
      arguments: {
        'chat-id': chatId,
        body: {
          contentType: 'html',
          content,
        },
      },
    });

    if (result.isError) {
      const errorText = Array.isArray(result.content)
        ? (result.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n')
        : String(result.content);
      throw new Error(`[A365Teams] postChatMessage failed: ${errorText}`);
    }
  }

  /** Disconnect the MCP client */
  async close(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.close().catch(() => {});
      this.mcpClient = null;
      this.transport = null;
    }
    instance = null;
  }
}
