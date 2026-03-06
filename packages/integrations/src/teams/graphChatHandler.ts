/**
 * Graph Chat Handler — Process 1:1 Teams DMs to agent user accounts
 *
 * When someone messages an agent's Entra user account in Teams,
 * Graph Change Notifications push the event to our webhook.
 * We fetch the message, identify the agent, run the agent,
 * and reply as the agent user via Graph API.
 *
 * Flow:
 *   1. Graph subscription on /chats/getAllMessages pushes notification
 *   2. Webhook validates → fetches message → identifies agent
 *   3. agentRunner(role, 'on_demand', {message}) executes
 *   4. Reply posted as agent user via POST /chats/{chatId}/messages
 *
 * Required Entra ID permissions (Application):
 *   - Chat.ReadWrite.All: Read/write all chats
 *
 * References:
 *   https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions
 *   https://learn.microsoft.com/en-us/graph/api/chat-post-messages
 */

import { AGENT_EMAIL_MAP, type AgentEmailEntry } from '@glyphor/agent-runtime';
import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import type { GraphTeamsClient } from './graphClient.js';
import type { TeamsBotHandler } from './bot.js';

// ─── TYPES ──────────────────────────────────────────────────────

export interface ChatChangeNotification {
  subscriptionId: string;
  subscriptionExpirationDateTime: string;
  changeType: 'created' | 'updated' | 'deleted';
  resource: string;
  resourceData: {
    '@odata.type': string;
    '@odata.id': string;
    '@odata.etag'?: string;
    id: string;
  };
  clientState?: string;
  tenantId: string;
  /** Encrypted content for /chats/getAllMessages with encryption */
  encryptedContent?: unknown;
}

export interface ChatChangePayload {
  value: ChatChangeNotification[];
}

export interface ChatMessage {
  id: string;
  chatId: string;
  messageType: string;
  body: { contentType: string; content: string };
  from?: {
    user?: { id: string; displayName: string; userIdentityType: string };
    application?: { id: string; displayName: string };
  };
  createdDateTime: string;
}

export interface ChatMember {
  '@odata.type': string;
  id: string;
  displayName: string;
  userId: string;
  email: string;
  roles: string[];
}

export type AgentRunner = (
  agentRole: string,
  task: string,
  payload: { message: string },
) => Promise<{ output?: string | null; error?: string | null } | undefined>;

// ─── REVERSE LOOKUP ─────────────────────────────────────────────

/** email (lowercase) → agent role */
const EMAIL_TO_ROLE = new Map<string, CompanyAgentRole>();
/** email (lowercase) → display name */
const EMAIL_TO_NAME = new Map<string, string>();

for (const [role, entry] of Object.entries(AGENT_EMAIL_MAP) as [CompanyAgentRole, AgentEmailEntry][]) {
  EMAIL_TO_ROLE.set(entry.email.toLowerCase(), role);
  EMAIL_TO_NAME.set(entry.email.toLowerCase(), entry.displayName);
}

/** Set of all agent user IDs — populated at runtime */
const AGENT_USER_IDS = new Set<string>();

// ─── HANDLER ────────────────────────────────────────────────────

const CLIENT_STATE = 'glyphor-chat-webhook';

/** Recent message IDs to deduplicate (Graph can send duplicates) */
const processedMessages = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEDUP_CLEANUP_INTERVAL = 60 * 1000;

export class GraphChatHandler {
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private teamsBot: TeamsBotHandler | null = null;

  constructor(
    private readonly graphClient: GraphTeamsClient,
    private readonly agentRunner: AgentRunner,
  ) {
    // Periodic cleanup of dedup cache
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, ts] of processedMessages) {
        if (now - ts > DEDUP_TTL_MS) processedMessages.delete(id);
      }
    }, DEDUP_CLEANUP_INTERVAL);
  }

  /** Expected client state for subscription validation */
  static get CLIENT_STATE(): string {
    return CLIENT_STATE;
  }

  /** Set the Teams bot handler for proactive reply delivery */
  setTeamsBot(bot: TeamsBotHandler): void {
    this.teamsBot = bot;
  }

  /**
   * Pre-populate the agent user ID set by resolving emails → Graph user IDs.
   * Called once at startup so we can quickly detect agent-sent messages.
   */
  async resolveAgentUserIds(): Promise<void> {
    const token = await this.graphClient.getAccessToken();

    for (const email of EMAIL_TO_ROLE.keys()) {
      try {
        const res = await fetch(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}?$select=id`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
          const data = (await res.json()) as { id: string };
          AGENT_USER_IDS.add(data.id);
        }
      } catch {
        // Best effort — if we can't resolve, we'll fall back to email checks
      }
    }

    console.log(`[GraphChat] Resolved ${AGENT_USER_IDS.size} agent user IDs`);
  }

  /**
   * Handle an incoming Graph change notification batch.
   * Process each notification: fetch message, identify agent, run, reply.
   */
  async handleNotifications(payload: ChatChangePayload): Promise<void> {
    for (const notification of payload.value) {
      // Validate client state
      if (notification.clientState && notification.clientState !== CLIENT_STATE) {
        console.warn('[GraphChat] Client state mismatch, skipping notification');
        continue;
      }

      // Only process 'created' messages
      if (notification.changeType !== 'created') continue;

      try {
        await this.processNotification(notification);
      } catch (err) {
        console.error(
          `[GraphChat] Error processing notification: ${(err as Error).message}`,
        );
      }
    }
  }

  private async processNotification(notification: ChatChangeNotification): Promise<void> {
    // Resource format: "chats('<chatId>')/messages('<messageId>')"
    // or "chats/{chatId}/messages/{messageId}"
    const resourceMatch = notification.resource.match(
      /chats[/(]'?([^/']+)'?\)?\/messages[/(]'?([^/']+)'?\)?/,
    );
    if (!resourceMatch) {
      console.warn(`[GraphChat] Could not parse resource: ${notification.resource}`);
      return;
    }

    const chatId = resourceMatch[1];
    const messageId = resourceMatch[2];

    // Dedup check
    const dedupKey = `${chatId}:${messageId}`;
    if (processedMessages.has(dedupKey)) return;
    processedMessages.set(dedupKey, Date.now());

    const token = await this.graphClient.getAccessToken();

    // Fetch the actual message
    const message = await this.fetchMessage(token, chatId, messageId);
    if (!message) return;

    // Skip system messages
    if (message.messageType !== 'message') return;

    // Skip messages from applications (bots, etc.)
    if (message.from?.application) return;

    // Skip messages from agent user accounts (prevent loops)
    const senderId = message.from?.user?.id;
    if (senderId && AGENT_USER_IDS.has(senderId)) return;

    // Identify which agent is in this chat by looking at chat members
    const agentRole = await this.identifyAgentInChat(token, chatId);
    if (!agentRole) {
      // Not an agent chat — ignore
      return;
    }

    const senderName = message.from?.user?.displayName ?? 'Unknown';
    const messageText = this.extractText(message);
    if (!messageText) return;

    const displayName = EMAIL_TO_NAME.get(
      AGENT_EMAIL_MAP[agentRole]?.email?.toLowerCase() ?? '',
    ) ?? agentRole;

    console.log(
      `[GraphChat] ${senderName} → ${displayName} (${agentRole}): "${messageText.substring(0, 100)}"`,
    );

    // Run the agent
    let responseText: string;
    try {
      const result = await this.agentRunner(agentRole, 'on_demand', {
        message: `[Message from ${senderName}]: ${messageText}`,
      });

      if (result?.output) {
        const clean = result.output.replace(/<reasoning>[\s\S]*?<\/reasoning>\s*/g, '').trim();
        responseText = clean;
      } else if (result?.error) {
        responseText = `I encountered an error processing your request: ${result.error}`;
      } else {
        responseText = `I've completed the task but have nothing specific to report.`;
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      responseText = `Sorry, I'm having trouble right now: ${errMessage}`;
    }

    // Reply via Bot Framework proactive messaging (as the agent's bot identity)
    if (this.teamsBot) {
      try {
        await this.teamsBot.sendProactiveAsAgent(agentRole, senderId!, responseText);
      } catch (botErr) {
        console.error(`[GraphChat] Bot proactive reply failed: ${(botErr as Error).message}`);
        // Fallback: try Graph API (may fail with app-only permissions)
        await this.replyInChat(token, chatId, responseText);
      }
    } else {
      // No bot handler — fall back to Graph API
      await this.replyInChat(token, chatId, responseText);
    }
  }

  /**
   * Fetch a single chat message by ID.
   */
  private async fetchMessage(
    token: string,
    chatId: string,
    messageId: string,
  ): Promise<ChatMessage | null> {
    const url = `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[GraphChat] Failed to fetch message: ${res.status} ${text.substring(0, 200)}`);
      return null;
    }

    const data = (await res.json()) as ChatMessage;
    data.chatId = chatId;
    return data;
  }

  /**
   * Identify which agent is a member of this chat.
   * For 1:1 chats, one member is the human and one is the agent.
   */
  private chatAgentCache = new Map<string, CompanyAgentRole | null>();

  private async identifyAgentInChat(
    token: string,
    chatId: string,
  ): Promise<CompanyAgentRole | null> {
    // Check cache first
    const cached = this.chatAgentCache.get(chatId);
    if (cached !== undefined) return cached;

    const url = `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/members`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.warn(`[GraphChat] Failed to list chat members: ${res.status}`);
      this.chatAgentCache.set(chatId, null);
      return null;
    }

    const data = (await res.json()) as { value: ChatMember[] };

    // Find an agent among the chat members
    for (const member of data.value) {
      const email = member.email?.toLowerCase();
      if (email) {
        const role = EMAIL_TO_ROLE.get(email);
        if (role) {
          this.chatAgentCache.set(chatId, role);
          return role;
        }
      }
      // Also check by user ID
      if (member.userId && AGENT_USER_IDS.has(member.userId)) {
        // Resolve email from user ID — fetch the user
        const userRes = await fetch(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(member.userId)}?$select=mail,userPrincipalName`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (userRes.ok) {
          const user = (await userRes.json()) as { mail?: string; userPrincipalName?: string };
          const userEmail = (user.mail ?? user.userPrincipalName)?.toLowerCase();
          if (userEmail) {
            const role = EMAIL_TO_ROLE.get(userEmail);
            if (role) {
              this.chatAgentCache.set(chatId, role);
              return role;
            }
          }
        }
      }
    }

    this.chatAgentCache.set(chatId, null);
    return null;
  }

  /**
   * Reply in the chat. Uses app permission (Chat.ReadWrite.All).
   * The message is sent on behalf of the application, not a specific user.
   *
   * Note: To send truly "as" the agent user, you'd need delegated permissions
   * or resource-specific consent. With app-only Chat.ReadWrite.All, messages
   * appear from the app but in the correct chat thread.
   */
  private async replyInChat(
    token: string,
    chatId: string,
    content: string,
  ): Promise<void> {
    const url = `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}/messages`;

    const body = {
      body: {
        contentType: 'html',
        content: this.markdownToHtml(content),
      },
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
      console.error(`[GraphChat] Failed to reply in chat: ${res.status} ${text.substring(0, 200)}`);
    }
  }

  /**
   * Basic markdown → HTML conversion for Teams messages.
   */
  private markdownToHtml(md: string): string {
    return md
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br/>');
  }

  /**
   * Extract plain text from a chat message body.
   */
  private extractText(message: ChatMessage): string {
    if (message.body.contentType === 'text') {
      return message.body.content.trim();
    }
    // HTML — strip tags for the agent input
    return message.body.content
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }

  /**
   * Cleanup resources (timers, caches).
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
