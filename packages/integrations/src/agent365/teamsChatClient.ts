/**
 * Agent 365 Teams Chat Client — Direct MCP bridge for Teams chat operations
 *
 * Uses the mcp_TeamsServer MCP server to create chats, list chat messages,
 * and post messages via delegated permissions. This keeps Teams DM chat
 * operations on the documented Microsoft Agent 365 MCP surface.
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
import { getAgentIdentityAppId } from '@glyphor/agent-runtime';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// ── Singleton ────────────────────────────────────────────────────

const instances = new Map<string, A365TeamsChatClient>();

function normalizeRoleKey(role: string): string {
  return role
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function resolveAgent365Credentials(agentRole?: string): {
  clientId: string;
  clientSecret: string;
  tenantId: string;
} | null {
  const sharedClientId = process.env.AGENT365_CLIENT_ID;
  const sharedClientSecret = process.env.AGENT365_CLIENT_SECRET;
  const sharedTenantId = process.env.AGENT365_TENANT_ID;

  if (!agentRole) {
    if (!sharedClientId || !sharedClientSecret || !sharedTenantId) return null;
    return {
      clientId: sharedClientId,
      clientSecret: sharedClientSecret,
      tenantId: sharedTenantId,
    };
  }

  const roleKey = normalizeRoleKey(agentRole);
  const envClientId = process.env[`AGENT365_${roleKey}_CLIENT_ID`];
  const envClientSecret = process.env[`AGENT365_${roleKey}_CLIENT_SECRET`];
  const envTenantId = process.env[`AGENT365_${roleKey}_TENANT_ID`] ?? sharedTenantId;
  const configuredAppId = getAgentIdentityAppId(agentRole);
  const roleClientId = envClientId ?? configuredAppId;

  if (roleClientId && envClientSecret && envTenantId) {
    return {
      clientId: roleClientId,
      clientSecret: envClientSecret,
      tenantId: envTenantId,
    };
  }

  if (roleClientId && !envClientSecret) {
    console.warn(`[A365Teams] Per-agent app id found for ${agentRole} but AGENT365_${roleKey}_CLIENT_SECRET is missing. Falling back to shared Agent 365 credentials.`);
  }

  if (!sharedClientId || !sharedClientSecret || !sharedTenantId) return null;
  return {
    clientId: sharedClientId,
    clientSecret: sharedClientSecret,
    tenantId: sharedTenantId,
  };
}

async function discoverTeamsServer(
  configService: McpToolServerConfigurationService,
  clientId: string,
  authToken: string,
): Promise<MCPServerConfig | undefined> {
  try {
    const allServers = await configService.listToolServers(clientId, authToken);
    return allServers.find((server) => server.mcpServerName === 'mcp_TeamsServer');
  } catch (err) {
    const message = (err as Error).message;
    console.warn(`[A365Teams] Tooling gateway discovery failed, falling back to ToolingManifest.json: ${message}`);
    const manifestServers = loadServerConfigsFromManifest();
    return manifestServers.find((server) => server.mcpServerName === 'mcp_TeamsServer');
  }
}

function loadServerConfigsFromManifest(): MCPServerConfig[] {
  let manifestPath = path.join(process.cwd(), 'ToolingManifest.json');
  if (!existsSync(manifestPath)) {
    manifestPath = path.join(path.dirname(process.argv[1] || ''), 'ToolingManifest.json');
  }
  if (!existsSync(manifestPath)) {
    console.warn(`[A365Teams] ToolingManifest.json not found at ${manifestPath}`);
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
    console.warn(`[A365Teams] Failed to read ToolingManifest.json: ${(err as Error).message}`);
    return [];
  }
}

export class A365TeamsChatClient {
  private mcpClient: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private msalApp: ConfidentialClientApplication;
  private audience: string;
  private readonly chatCache = new Map<string, string>();

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
  static fromEnv(agentRole?: string): A365TeamsChatClient | null {
    if (process.env.AGENT365_ENABLED !== 'true') return null;

    const instanceKey = agentRole ?? '__shared__';
    const existing = instances.get(instanceKey);
    if (existing) return existing;

    const credentials = resolveAgent365Credentials(agentRole);
    if (!credentials) return null;

    const instance = new A365TeamsChatClient(
      credentials.clientId,
      credentials.clientSecret,
      credentials.tenantId,
    );
    instances.set(instanceKey, instance);
    return instance;
  }

  private parseContent(content: unknown): unknown {
    if (!Array.isArray(content)) return content;

    if (content.length === 1 && typeof content[0] === 'object' && content[0] !== null && 'text' in content[0]) {
      const text = String((content[0] as { text?: string }).text ?? '').trim();
      if (!text) return text;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    return content.map((item) => {
      if (typeof item === 'object' && item !== null && 'text' in item) {
        const text = String((item as { text?: string }).text ?? '');
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }
      return item;
    });
  }

  private extractCollection<T>(data: unknown): T[] {
    if (Array.isArray(data)) return data as T[];
    if (data && typeof data === 'object' && Array.isArray((data as { value?: unknown[] }).value)) {
      return (data as { value: T[] }).value;
    }
    return [];
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.ensureConnected();
    const result = await client.callTool({ name, arguments: args });

    if (result.isError) {
      const errorText = Array.isArray(result.content)
        ? (result.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n')
        : String(result.content);
      throw new Error(`[A365Teams] ${name} failed: ${errorText}`);
    }

    return this.parseContent(result.content);
  }

  private extractChatId(data: unknown): string | null {
    if (typeof data === 'string') {
      const trimmed = data.trim();
      return trimmed || null;
    }
    if (data && typeof data === 'object') {
      const directId = (data as { id?: unknown }).id;
      if (typeof directId === 'string' && directId) return directId;
    }
    return null;
  }

  private extractMemberUserId(member: unknown): string | null {
    if (!member || typeof member !== 'object') return null;

    const directUserId = (member as { userId?: unknown }).userId;
    if (typeof directUserId === 'string' && directUserId) return directUserId;

    const user = (member as { user?: { id?: unknown } }).user;
    if (user && typeof user.id === 'string' && user.id) return user.id;

    const bind = (member as { ['user@odata.bind']?: unknown })['user@odata.bind'];
    if (typeof bind === 'string') {
      const match = bind.match(/users\('([^']+)'\)/i);
      if (match?.[1]) return match[1];
    }

    return null;
  }

  private async findOneOnOneChatByMembers(memberUserIds: string[]): Promise<string | null> {
    const targetIds = new Set(memberUserIds.filter(Boolean));
    const chats = this.extractCollection<Record<string, unknown>>(
      await this.callTool('mcp_graph_chat_listChats', { '$top': 100, '$orderby': 'lastUpdatedDateTime desc' }),
    );

    for (const chat of chats) {
      if (chat.chatType !== 'oneOnOne') continue;
      const chatId = this.extractChatId(chat);
      if (!chatId) continue;

      const members = await this.listChatMembers(chatId).catch(() => []);
      const memberIds = new Set(members.map((member) => this.extractMemberUserId(member)).filter(Boolean));
      if (memberIds.size !== targetIds.size) continue;

      let matches = true;
      for (const id of targetIds) {
        if (!memberIds.has(id)) {
          matches = false;
          break;
        }
      }
      if (matches) return chatId;
    }

    return null;
  }

  async createOrGetOneOnOneChat(recipientUserId: string, senderUserId?: string): Promise<string> {
    const cacheKey = senderUserId ? `${senderUserId}:${recipientUserId}` : recipientUserId;
    const cached = this.chatCache.get(cacheKey);
    if (cached) return cached;

    const members: Record<string, unknown>[] = [
      {
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        roles: ['owner'],
        'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${recipientUserId}')`,
      },
    ];

    if (senderUserId) {
      members.push({
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        roles: ['owner'],
        'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${senderUserId}')`,
      });
    }

    try {
      const data = await this.callTool('mcp_graph_chat_createChat', {
        chatType: 'oneOnOne',
        members,
      });
      const chatId = this.extractChatId(data);
      if (!chatId) throw new Error('Chat create succeeded but no chat id was returned');
      this.chatCache.set(cacheKey, chatId);
      return chatId;
    } catch (err) {
      const message = (err as Error).message;
      if (!/409|already exists|conflict/i.test(message)) throw err;

      const existingChatId = await this.findOneOnOneChatByMembers(
        [recipientUserId, senderUserId].filter((value): value is string => Boolean(value)),
      );
      if (!existingChatId) throw err;
      this.chatCache.set(cacheKey, existingChatId);
      return existingChatId;
    }
  }

  async listChatMembers(chatId: string): Promise<Array<Record<string, unknown>>> {
    return this.extractCollection<Record<string, unknown>>(
      await this.callTool('mcp_graph_chat_listChatMembers', { 'chat-id': chatId }),
    );
  }

  async listChatMessages(chatId: string, top = 10): Promise<Array<Record<string, unknown>>> {
    return this.extractCollection<Record<string, unknown>>(
      await this.callTool('mcp_graph_chat_listChatMessages', {
        'chat-id': chatId,
        '$top': top,
        '$orderby': 'createdDateTime desc',
      }),
    );
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
    const teamsServer = await discoverTeamsServer(configService, this.clientId, authToken);

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
    await this.callTool('mcp_graph_chat_postMessage', {
      'chat-id': chatId,
      body: {
        contentType: 'html',
        content,
      },
    });
  }

  /** Disconnect the MCP client */
  async close(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.close().catch(() => {});
      this.mcpClient = null;
      this.transport = null;
    }
    for (const [key, value] of instances.entries()) {
      if (value === this) instances.delete(key);
    }
  }
}
