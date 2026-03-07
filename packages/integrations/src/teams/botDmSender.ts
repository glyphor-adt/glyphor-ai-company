/**
 * Bot Framework DM Sender — sends proactive 1:1 DMs via Bot Framework REST API.
 *
 * Unlike Graph API `POST /chats/{id}/messages`, Bot Framework proactive messaging
 * works with application credentials. Graph API app-only tokens can only post
 * messages for "import" purposes.
 *
 * Uses Graph API only for resolving email → Entra Object ID (which works fine
 * with app permissions).
 */

import type { GraphTeamsClient } from './graphClient.js';
import { buildFounderDirectory, type FounderContact } from './directMessages.js';
import { getConversationRef } from './conversationStore.js';

export class BotDmSender {
  private tokenCache: { token: string; expiresAt: number } | null = null;
  private readonly emailCache = new Map<string, string>(); // email → AAD Object ID

  constructor(
    private readonly botAppId: string,
    private readonly botAppSecret: string,
    private readonly tenantId: string,
    private readonly graphClient: GraphTeamsClient,
    private readonly founderDir: Record<string, FounderContact> = {},
    private readonly serviceUrl = 'https://smba.trafficmanager.net/amer/',
  ) {}

  static fromEnv(graphClient: GraphTeamsClient): BotDmSender | null {
    const appId = process.env.BOT_APP_ID;
    const appSecret = process.env.BOT_APP_SECRET;
    const tenantId = process.env.BOT_TENANT_ID;
    if (!appId || !appSecret || !tenantId) return null;

    const dir = buildFounderDirectory();
    return new BotDmSender(appId, appSecret, tenantId, graphClient, dir);
  }

  /**
   * Acquire a Bot Framework token via MSAL client credentials.
   */
  private async getBotToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.botAppId,
      client_secret: this.botAppSecret,
      scope: 'https://api.botframework.com/.default',
    });

    const res = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Failed to get bot token: ${res.status} ${errText}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return data.access_token;
  }

  /**
   * Resolve an email address to an Entra Object ID.
   * Checks the founder directory first, then falls back to Graph API.
   */
  async resolveUserIdByEmail(email: string): Promise<string> {
    const key = email.toLowerCase();
    const cached = this.emailCache.get(key);
    if (cached) return cached;

    // Check founder directory
    for (const contact of Object.values(this.founderDir)) {
      if (contact.email.toLowerCase() === key) {
        this.emailCache.set(key, contact.userId);
        return contact.userId;
      }
    }

    const token = await this.graphClient.getAccessToken();
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}?$select=id`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to resolve user "${email}" (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { id: string };
    this.emailCache.set(key, data.id);
    return data.id;
  }

  /**
   * Send a proactive DM to a user by their Entra Object ID.
   * Uses stored conversation reference if available (required for multi-tenant bots).
   */
  async sendToUser(userAadObjectId: string, message: string): Promise<void> {
    const token = await this.getBotToken();

    // Check for a stored conversation reference (from a previous bot interaction).
    // Multi-tenant bots use pairwise-encrypted user IDs, so we can't construct
    // the user ID from the AAD Object ID alone.
    const ref = getConversationRef(userAadObjectId);
    if (ref) {
      const url = `${ref.serviceUrl}v3/conversations/${encodeURIComponent(ref.conversationId)}/activities`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'message', text: message, textFormat: 'markdown' }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Bot proactive DM failed (${res.status}): ${errText}`);
      }
      return;
    }

    // No stored reference — fall back to creating a new conversation.
    const createUrl = `${this.serviceUrl}v3/conversations`;

    const createBody = {
      bot: { id: `28:${this.botAppId}`, name: 'Glyphor Bot' },
      members: [{ id: `29:${userAadObjectId}` }],
      tenantId: this.tenantId,
      activity: {
        type: 'message',
        text: message,
        textFormat: 'markdown',
      },
    };

    const res = await fetch(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Bot proactive DM failed (${res.status}): ${errText}`);
    }
  }

  /**
   * Send a DM to a founder by key (kristina/andrew).
   */
  async sendText(
    founder: 'kristina' | 'andrew',
    message: string,
    agentName?: string,
  ): Promise<void> {
    const contact = this.founderDir[founder];
    if (!contact) {
      throw new Error(
        `Founder "${founder}" not configured. Set TEAMS_USER_${founder.toUpperCase()}_ID.`,
      );
    }
    const content = agentName ? `**${agentName}:** ${message}` : message;
    await this.sendToUser(contact.userId, content);
  }

  /**
   * Send a DM to any user by email address.
   */
  async sendToEmail(
    email: string,
    message: string,
    agentName?: string,
  ): Promise<void> {
    const userId = await this.resolveUserIdByEmail(email);
    const content = agentName ? `**${agentName}:** ${message}` : message;
    await this.sendToUser(userId, content);
  }
}
