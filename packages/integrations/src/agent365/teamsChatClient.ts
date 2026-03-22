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
import { MsalTokenProvider } from '@microsoft/agents-hosting';
import type { AuthConfiguration } from '@microsoft/agents-hosting';
import { getAgentIdentityAppId, getAgentBlueprintSpId, getAgentSpId, getAgentEntraUserId, getAgentUpn } from '@glyphor/agent-runtime';
import { markdownToTeamsHtml } from '../teams/messageFormatter.js';
import type { AdaptiveCard } from '../teams/webhooks.js';
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

/** Tokens from the 3-step agentic user flow expire quickly (~5 min). */
const TOKEN_REFRESH_BUFFER_MS = 60_000; // refresh 1 min before expiry
const DEFAULT_TOKEN_LIFETIME_MS = 4 * 60_000; // assume 4 min if we can't parse

export class A365TeamsChatClient {
  private mcpClient: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private tokenProvider: MsalTokenProvider;
  private audience: string;
  private readonly chatCache = new Map<string, string>();
  private connectedAt = 0; // timestamp when current connection was established

  private readonly defaultAgentRole?: string;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly tenantId: string,
    audience?: string,
    agentRole?: string,
  ) {
    this.audience = audience ?? 'ea9ffc3e-8a23-4a7d-836d-234d7c7565c1';
    this.defaultAgentRole = agentRole;
    const authConfig: AuthConfiguration = {
      clientId,
      clientSecret,
      tenantId,
    };
    this.tokenProvider = new MsalTokenProvider(authConfig);
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
      undefined,
      agentRole,
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

  private async callTool(name: string, args: Record<string, unknown>, agentRole?: string): Promise<unknown> {
    let client = await this.ensureConnected(agentRole);

    try {
      const result = await client.callTool({ name, arguments: args });

      if (result.isError) {
        const errorText = Array.isArray(result.content)
          ? (result.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n')
          : String(result.content);

        // Detect token expiry errors — reconnect and retry once
        if (/AADSTS500133|AADSTS700024|expired|not within its valid time/i.test(errorText)) {
          console.warn(`[A365Teams] Token expired during ${name}, reconnecting...`);
          await this.close();
          client = await this.ensureConnected(agentRole);
          const retry = await client.callTool({ name, arguments: args });
          if (retry.isError) {
            const retryErr = Array.isArray(retry.content)
              ? (retry.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n')
              : String(retry.content);
            throw new Error(`[A365Teams] ${name} failed after reconnect: ${retryErr}`);
          }
          return this.parseContent(retry.content);
        }

        throw new Error(`[A365Teams] ${name} failed: ${errorText}`);
      }

      return this.parseContent(result.content);
    } catch (err) {
      const message = (err as Error).message;
      // Catch transport-level auth failures too (e.g. 401 from the MCP server)
      if (/AADSTS500133|AADSTS700024|expired|not within its valid time|401/i.test(message)
          && !message.includes('after reconnect')) {
        console.warn(`[A365Teams] Auth error during ${name}, reconnecting: ${message.slice(0, 200)}`);
        await this.close();
        client = await this.ensureConnected(agentRole);
        const retry = await client.callTool({ name, arguments: args });
        if (retry.isError) {
          const retryErr = Array.isArray(retry.content)
            ? (retry.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n')
            : String(retry.content);
          throw new Error(`[A365Teams] ${name} failed after reconnect: ${retryErr}`);
        }
        return this.parseContent(retry.content);
      }
      throw err;
    }
  }

  private extractChatId(data: unknown): string | null {
    if (typeof data === 'string') {
      // Might be a raw chat ID string like "19:..."
      const trimmed = data.trim();
      return trimmed || null;
    }
    // Top-level array — e.g. [{"id":"19:...","chatType":"OneOnOne",...}, "CorrelationId: ..."]
    if (Array.isArray(data)) {
      for (const item of data) {
        const id = this.extractChatId(item);
        if (id) return id;
      }
      return null;
    }
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      // Direct .id property
      if (typeof obj.id === 'string' && obj.id) return obj.id;
      // Nested .chat.id (Graph API response shape)
      if (obj.chat && typeof obj.chat === 'object') {
        const chatId = (obj.chat as Record<string, unknown>).id;
        if (typeof chatId === 'string' && chatId) return chatId;
      }
      // chatId property
      if (typeof obj.chatId === 'string' && obj.chatId) return obj.chatId;
      // value[0].id (collection response)
      if (Array.isArray(obj.value) && obj.value.length > 0) {
        const firstId = (obj.value[0] as Record<string, unknown>)?.id;
        if (typeof firstId === 'string' && firstId) return firstId;
      }
      // Look for any string property that looks like a Teams chat ID (19:...)
      for (const val of Object.values(obj)) {
        if (typeof val === 'string' && val.startsWith('19:')) return val;
      }
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

  private async findOneOnOneChatByUpns(upns: string[]): Promise<string | null> {
    const targetUpns = new Set(upns.map(u => u.toLowerCase()).filter(Boolean));
    const chats = this.extractCollection<Record<string, unknown>>(
      await this.callTool('ListChats', { userUpns: upns, top: 50 }),
    );

    for (const chat of chats) {
      if (chat.chatType !== 'oneOnOne') continue;
      const chatId = this.extractChatId(chat);
      if (!chatId) continue;

      const members = await this.listChatMembers(chatId).catch(() => []);
      const memberUpns = new Set(members.map((m) => {
        const email = (m as { email?: string }).email;
        if (typeof email === 'string' && email) return email.toLowerCase();
        const userId = this.extractMemberUserId(m);
        return userId?.toLowerCase() ?? null;
      }).filter(Boolean) as string[]);

      if (memberUpns.size !== targetUpns.size) continue;
      let matches = true;
      for (const upn of targetUpns) {
        if (!memberUpns.has(upn)) { matches = false; break; }
      }
      if (matches) return chatId;
    }

    return null;
  }

  /**
   * Create or find an existing 1:1 chat with the recipient.
   * The MCP CreateChat tool requires the signed-in agentic user to be one of
   * the 2 members in oneOnOne chats. We always use the agentic user's UPN
   * (AGENT365_AGENTIC_USER_UPN) as one member and the recipient as the other.
   * The senderUpn parameter is kept for cache-key differentiation but is NOT
   * used as a chat member.
   */
  async createOrGetOneOnOneChat(recipientUpn: string, senderUpn?: string, agentRole?: string): Promise<string> {
    const role = agentRole ?? this.defaultAgentRole;
    const cacheKey = `${role ?? '__shared__'}:${recipientUpn.toLowerCase()}`;
    const cached = this.chatCache.get(cacheKey);
    if (cached) return cached;

    // Resolve per-agent UPN from agentIdentities.json; fall back to shared env var.
    const agenticUserUpn = (role ? getAgentUpn(role) : null)
      ?? process.env.AGENT365_AGENTIC_USER_UPN;
    if (!agenticUserUpn) {
      throw new Error(`[A365Teams] No UPN found for agent ${role ?? 'unknown'}. Set upn in agentIdentities.json or AGENT365_AGENTIC_USER_UPN env var.`);
    }

    // If the recipient IS the agentic user, use the sender instead (can't DM yourself)
    const actualRecipient = recipientUpn.toLowerCase() === agenticUserUpn.toLowerCase() && senderUpn
      ? senderUpn
      : recipientUpn;
    const upns = [agenticUserUpn, actualRecipient];

    try {
      const data = await this.callTool('CreateChat', {
        chatType: 'oneOnOne',
        members_upns: upns,
      });
      console.log(`[A365Teams] CreateChat response (type=${typeof data}):`, JSON.stringify(data).slice(0, 500));
      const chatId = this.extractChatId(data);
      if (!chatId) throw new Error(`Chat create succeeded but no chat id was returned. Response: ${JSON.stringify(data).slice(0, 300)}`);
      this.chatCache.set(cacheKey, chatId);
      return chatId;
    } catch (err) {
      const message = (err as Error).message;
      if (!/409|already exists|conflict/i.test(message)) throw err;

      const existingChatId = await this.findOneOnOneChatByUpns(upns);
      if (!existingChatId) throw err;
      this.chatCache.set(cacheKey, existingChatId);
      return existingChatId;
    }
  }

  async listChatMembers(chatId: string): Promise<Array<Record<string, unknown>>> {
    return this.extractCollection<Record<string, unknown>>(
      await this.callTool('ListChatMembers', { chatId }),
    );
  }

  async listChatMessages(chatId: string, top = 10): Promise<Array<Record<string, unknown>>> {
    return this.extractCollection<Record<string, unknown>>(
      await this.callTool('ListChatMessages', {
        chatId,
        top,
      }),
    );
  }

  /**
   * Acquire an agentic user token for the Agent 365 Tools API.
   * Uses MsalTokenProvider.getAgenticUserToken() 3-step flow
   * to authenticate as the specific agent user.
   */
  private async getToken(agentRole?: string): Promise<string> {
    const role = agentRole ?? this.defaultAgentRole;

    // Always use per-agent identity (blueprintSpId / entraUserId) when role is
    // known.  The MSAL app credentials (clientId/clientSecret) can be shared,
    // but the agentAppInstanceId and agenticUserId MUST be per-agent so each
    // agent authenticates as its own Teams-installed identity.
    const agentAppInstanceId = (role ? getAgentBlueprintSpId(role) : null)
      ?? process.env.AGENT365_APP_INSTANCE_ID;
    const agenticUserId = (role ? getAgentEntraUserId(role) : null)
      ?? process.env.AGENT365_AGENTIC_USER_ID;

    if (!agentAppInstanceId || !agenticUserId) {
      throw new Error(
        '[A365Teams] Agent identity not configured. ' +
        'Set AGENT365_APP_INSTANCE_ID and AGENT365_AGENTIC_USER_ID env vars.'
      );
    }

    const scopes = [`${this.audience}/.default`];
    return this.tokenProvider.getAgenticUserToken(
      this.tenantId,
      agentAppInstanceId,
      agenticUserId,
      scopes,
    );
  }

  /**
   * Connect to the mcp_TeamsServer MCP endpoint.
   * Reconnects when agentRole changes to use the correct identity token.
   */
  private lastAgentRole: string | undefined;
  private async ensureConnected(agentRole?: string): Promise<Client> {
    const role = agentRole ?? this.defaultAgentRole;

    // Reconnect if agent role changed (different identity = different auth token)
    if (this.mcpClient && role !== this.lastAgentRole) {
      await this.close();
    }

    // Proactively reconnect if the token is likely expired or about to expire.
    // The agentic user token has a short TTL (~5 min).
    if (this.mcpClient && Date.now() - this.connectedAt > DEFAULT_TOKEN_LIFETIME_MS - TOKEN_REFRESH_BUFFER_MS) {
      console.log(`[A365Teams] Token nearing expiry, proactively reconnecting as ${role ?? 'shared'}`);
      await this.close();
    }

    if (this.mcpClient) return this.mcpClient;

    const authToken = await this.getToken(role);
    this.lastAgentRole = role;

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
    this.connectedAt = Date.now();
    console.log(`[A365Teams] Connected to mcp_TeamsServer as ${role ?? 'shared'}`);
    return this.mcpClient;
  }

  /**
   * Post a message in a Teams chat using the Agent 365 MCP server.
   * Uses PostMessage (POST /v1.0/chats/{chat-id}/messages).
   */
  async postChatMessage(chatId: string, content: string, agentRole?: string): Promise<void> {
    await this.callTool('PostMessage', {
      chatId,
      content: markdownToTeamsHtml(content),
      contentType: 'html',
    }, agentRole);
  }

  /**
   * Post an Adaptive Card to a 1:1 chat as the agent identity (Graph API).
   * Use this when MCP PostMessage cannot attach cards — matches {@link GraphTeamsClient} DM card shape.
   */
  async postChatAdaptiveCard(
    chatId: string,
    card: AdaptiveCard,
    agentRole?: string,
    agentDisplayName?: string,
  ): Promise<void> {
    const role = agentRole ?? this.defaultAgentRole;
    const agentAppInstanceId = (role ? getAgentBlueprintSpId(role) : null)
      ?? process.env.AGENT365_APP_INSTANCE_ID;
    const agenticUserId = (role ? getAgentEntraUserId(role) : null)
      ?? process.env.AGENT365_AGENTIC_USER_ID;

    if (!agentAppInstanceId || !agenticUserId) {
      throw new Error(
        `[A365Teams] Agent identity not configured for adaptive card DM (${role ?? 'unknown'}).`,
      );
    }

    const token = await this.tokenProvider.getAgenticUserToken(
      this.tenantId,
      agentAppInstanceId,
      agenticUserId,
      ['https://graph.microsoft.com/.default'],
    );

    const url = `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/messages`;
    const htmlContent = agentDisplayName
      ? `<b>${agentDisplayName}</b><br/><attachment id="adaptiveCard"></attachment>`
      : '<attachment id="adaptiveCard"></attachment>';
    const body = {
      body: {
        contentType: 'html',
        content: htmlContent,
      },
      attachments: [
        {
          id: 'adaptiveCard',
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: JSON.stringify(card),
        },
      ],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[A365Teams] Adaptive card DM failed (${res.status}): ${text.substring(0, 400)}`);
    }
  }

  /**
   * Post a message to a Teams channel as the agent's own identity.
   *
   * Uses the agent's Graph token (via getAgenticUserToken with Graph audience)
   * to call POST /teams/{teamId}/channels/{channelId}/messages directly.
   * The message appears as the agent's agentic user — NOT the app or a human.
   */
  async postChannelMessage(
    teamId: string,
    channelId: string,
    content: string,
    agentRole?: string,
  ): Promise<void> {
    const role = agentRole ?? this.defaultAgentRole;

    const agentAppInstanceId = (role ? getAgentBlueprintSpId(role) : null)
      ?? process.env.AGENT365_APP_INSTANCE_ID;
    const agenticUserId = (role ? getAgentEntraUserId(role) : null)
      ?? process.env.AGENT365_AGENTIC_USER_ID;

    if (!agentAppInstanceId || !agenticUserId) {
      throw new Error(`[A365Teams] Agent identity not configured for channel posting (${role ?? 'unknown'}).`);
    }

    // Get a Graph-scoped token for this agent's identity
    const token = await this.tokenProvider.getAgenticUserToken(
      this.tenantId,
      agentAppInstanceId,
      agenticUserId,
      ['https://graph.microsoft.com/.default'],
    );

    const url = `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages`;
    const body = {
      body: { contentType: 'html', content: markdownToTeamsHtml(content) },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[A365Teams] Channel post failed (${res.status}): ${text.substring(0, 300)}`);
    }
    console.log(`[A365Teams] ${role ?? 'agent'} posted to channel ${channelId.substring(0, 20)}…`);
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
