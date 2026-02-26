/**
 * Teams Direct Messages — 1:1 chat via Microsoft Graph API
 *
 * Sends DMs to specific users (founders) as the Glyphor app.
 * Uses the same MSAL client credentials flow as channel messages.
 *
 * Required Entra ID permission (Application): Chat.ReadWrite
 *
 * Governance:
 *   GREEN — Sarah (chief-of-staff) and Atlas (ops) only
 *   YELLOW — other executives (requires founder approval)
 *   BLOCKED — sub-team agents (escalate through manager)
 */

import type { GraphTeamsClient } from './graphClient.js';
import type { AdaptiveCard } from './webhooks.js';

// ─── FOUNDER DIRECTORY ──────────────────────────────────────────

export interface FounderContact {
  userId: string;       // Entra ID object ID (NOT email)
  displayName: string;
  email: string;
}

/**
 * Build founder directory from environment variables.
 *   TEAMS_USER_KRISTINA_ID — Kristina's Entra Object ID
 *   TEAMS_USER_ANDREW_ID   — Andrew's Entra Object ID
 */
export function buildFounderDirectory(): Record<string, FounderContact> {
  const dir: Record<string, FounderContact> = {};

  const kristinaId = process.env.TEAMS_USER_KRISTINA_ID;
  if (kristinaId) {
    dir.kristina = {
      userId: kristinaId,
      displayName: 'Kristina Denney',
      email: process.env.TEAMS_USER_KRISTINA_EMAIL ?? 'kristina@glyphor.com',
    };
  }

  const andrewId = process.env.TEAMS_USER_ANDREW_ID;
  if (andrewId) {
    dir.andrew = {
      userId: andrewId,
      displayName: 'Andrew Zwelling',
      email: process.env.TEAMS_USER_ANDREW_EMAIL ?? 'andrew@glyphor.com',
    };
  }

  return dir;
}

// ─── DIRECT MESSAGE CLIENT ─────────────────────────────────────

export class TeamsDirectMessageClient {
  private readonly chatCache = new Map<string, string>(); // userId → chatId

  constructor(
    private readonly graphClient: GraphTeamsClient,
    private readonly founderDir: Record<string, FounderContact>,
  ) {}

  /**
   * Create from environment. Returns null if Graph API or founder IDs aren't configured.
   */
  static fromEnv(graphClient: GraphTeamsClient): TeamsDirectMessageClient | null {
    const dir = buildFounderDirectory();
    if (Object.keys(dir).length === 0) return null;
    return new TeamsDirectMessageClient(graphClient, dir);
  }

  /**
   * Send a plain text DM to a founder.
   */
  async sendText(
    founder: 'kristina' | 'andrew',
    message: string,
    agentName?: string,
  ): Promise<void> {
    const contact = this.founderDir[founder];
    if (!contact) {
      throw new Error(`Founder "${founder}" not configured. Set TEAMS_USER_${founder.toUpperCase()}_ID.`);
    }

    const chatId = await this.getOrCreateChat(contact.userId);
    const content = agentName ? `**${agentName}:** ${message}` : message;

    await this.postMessage(chatId, { contentType: 'text', content });
  }

  /**
   * Send an Adaptive Card as a DM to a founder.
   */
  async sendCard(
    founder: 'kristina' | 'andrew',
    card: AdaptiveCard,
    agentName?: string,
  ): Promise<void> {
    const contact = this.founderDir[founder];
    if (!contact) {
      throw new Error(`Founder "${founder}" not configured. Set TEAMS_USER_${founder.toUpperCase()}_ID.`);
    }

    const chatId = await this.getOrCreateChat(contact.userId);

    const body: Record<string, unknown> = {
      body: {
        contentType: 'html',
        content: agentName
          ? `<b>${agentName}</b><br/><attachment id="adaptiveCard"></attachment>`
          : '<attachment id="adaptiveCard"></attachment>',
      },
      attachments: [
        {
          id: 'adaptiveCard',
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: JSON.stringify(card),
        },
      ],
    };

    await this.postRaw(chatId, body);
  }

  /**
   * Get or create a 1:1 chat between the app and a user.
   * Caches chat IDs to avoid repeated lookups.
   */
  private async getOrCreateChat(userId: string): Promise<string> {
    const cached = this.chatCache.get(userId);
    if (cached) return cached;

    const token = await (this.graphClient as unknown as { getToken(): Promise<string> }).getToken();

    // Install the app in user's personal scope + create 1:1 chat
    const response = await fetch('https://graph.microsoft.com/v1.0/chats', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chatType: 'oneOnOne',
        members: [
          {
            '@odata.type': '#microsoft.graph.aadUserConversationMember',
            roles: ['owner'],
            'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${encodeURIComponent(userId)}')`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create/get 1:1 chat (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { id: string };
    this.chatCache.set(userId, data.id);
    return data.id;
  }

  /**
   * Post a message to a chat.
   */
  private async postMessage(
    chatId: string,
    body: { contentType: string; content: string },
  ): Promise<void> {
    await this.postRaw(chatId, { body });
  }

  /**
   * Post a raw message payload to a chat.
   */
  private async postRaw(chatId: string, payload: Record<string, unknown>): Promise<void> {
    const token = await (this.graphClient as unknown as { getToken(): Promise<string> }).getToken();

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to send DM (${response.status}): ${text}`);
    }
  }
}
