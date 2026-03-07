/**
 * DM Tools — Shared Teams direct message tools for all agents
 *
 * Provides send_teams_dm tool. Primary path uses Agent 365 MCP (mcp_TeamsServer)
 * with delegated permissions to post chat messages. Falls back to Bot Framework
 * proactive messaging if A365 is not configured.
 *
 * Flow (A365 MCP path):
 *   1. Resolve recipient email → Entra Object ID (Graph API, app-only)
 *   2. Create/get a 1:1 chat between sender agent + recipient (Graph API, app-only)
 *   3. Post message in that chat via A365 MCP mcp_graph_chat_postMessage (delegated)
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { AGENT_EMAIL_MAP, type CompanyAgentRole } from '@glyphor/agent-runtime';
import {
  GraphTeamsClient,
  BotDmSender,
  A365TeamsChatClient,
} from '@glyphor/integrations';

/** Founder keys → email addresses */
const FOUNDER_DIR: Record<string, string> = {
  kristina: 'kristina@glyphor.ai',
  andrew: 'andrew@glyphor.ai',
};

/** Cache for email → Entra Object ID lookups */
const userIdCache = new Map<string, string>();

/** Cache for (sender+recipient) → chatId */
const chatIdCache = new Map<string, string>();

/**
 * Resolve a recipient string to an email address.
 * Accepts: 'kristina', 'andrew', agent role slug (e.g. 'cto'),
 * display name (e.g. 'Marcus Reeves'), or a raw email.
 */
function resolveRecipientEmail(recipient: string): string | null {
  const lower = recipient.toLowerCase().trim();

  // Founder key
  if (FOUNDER_DIR[lower]) return FOUNDER_DIR[lower];

  // Agent role slug
  const agentEntry = AGENT_EMAIL_MAP[lower as CompanyAgentRole];
  if (agentEntry) return agentEntry.email;

  // Display name lookup
  for (const entry of Object.values(AGENT_EMAIL_MAP)) {
    if (entry.displayName.toLowerCase() === lower) return entry.email;
  }

  // Raw email
  if (recipient.includes('@')) return recipient;

  return null;
}

/**
 * Resolve email → Entra Object ID via Graph API (app-only token).
 */
async function resolveUserIdByEmail(
  graphClient: GraphTeamsClient,
  email: string,
): Promise<string> {
  const key = email.toLowerCase();
  const cached = userIdCache.get(key);
  if (cached) return cached;

  const token = await graphClient.getAccessToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}?$select=id`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to resolve user "${email}" (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id: string };
  userIdCache.set(key, data.id);
  return data.id;
}

/**
 * Create or get a 1:1 chat between two users via Graph API (app-only token).
 * Graph API returns the existing chat if one already exists (idempotent for oneOnOne).
 */
async function getOrCreateOneOnOneChat(
  graphClient: GraphTeamsClient,
  recipientUserId: string,
  senderUserId?: string,
): Promise<string> {
  const cacheKey = senderUserId ? `${senderUserId}:${recipientUserId}` : recipientUserId;
  const cached = chatIdCache.get(cacheKey);
  if (cached) return cached;

  const token = await graphClient.getAccessToken();

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

  const res = await fetch('https://graph.microsoft.com/v1.0/chats', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chatType: 'oneOnOne', members }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create 1:1 chat (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id: string };
  chatIdCache.set(cacheKey, data.id);
  return data.id;
}

/**
 * Create Teams DM tools. The sender name is resolved at execution time
 * from `ctx.agentRole`, so no constructor-time role is needed.
 */
export function createDmTools(): ToolDefinition[] {
  let graphClient: GraphTeamsClient | null = null;
  let a365Client: A365TeamsChatClient | null = null;
  let dmSender: BotDmSender | null = null;

  try {
    graphClient = GraphTeamsClient.fromEnv();
  } catch {
    // Graph client not configured
  }

  try {
    a365Client = A365TeamsChatClient.fromEnv();
  } catch {
    // A365 not configured
  }

  try {
    if (graphClient) {
      dmSender = BotDmSender.fromEnv(graphClient);
    }
  } catch {
    // Bot Framework not configured
  }

  return [
    {
      name: 'send_teams_dm',
      description:
        'Send a direct message to a person via Teams 1:1 chat. ' +
        'Accepts a founder name (kristina, andrew), an agent role slug ' +
        '(e.g. cto, vp-design), a display name (e.g. "Marcus Reeves"), ' +
        'or an email address. Use for urgent updates, questions, or ' +
        'follow-ups that need immediate attention.',
      parameters: {
        recipient: {
          type: 'string',
          description:
            'Who to DM — founder name (kristina/andrew), agent role ' +
            '(cto, vp-sales), display name ("Maya Brooks"), or email',
          required: true,
        },
        message: {
          type: 'string',
          description: 'Message content (supports markdown bold/italic)',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const recipientStr = params.recipient as string;
        const email = resolveRecipientEmail(recipientStr);
        if (!email) {
          return {
            success: false,
            error: `Could not resolve recipient "${recipientStr}". Use a founder name, agent role, display name, or email address.`,
          };
        }

        // Resolve sender display name from ctx.agentRole
        const role = ctx?.agentRole as CompanyAgentRole | undefined;
        const agentEntry = role ? AGENT_EMAIL_MAP[role] : undefined;
        const senderName = agentEntry?.displayName ?? role ?? 'Glyphor Agent';
        const senderEmail = agentEntry?.email;

        // ── Primary path: A365 MCP (delegated permissions) ────────
        if (a365Client && graphClient) {
          try {
            const recipientUserId = await resolveUserIdByEmail(graphClient, email);
            const senderUserId = senderEmail
              ? await resolveUserIdByEmail(graphClient, senderEmail).catch(() => undefined)
              : undefined;
            const chatId = await getOrCreateOneOnOneChat(graphClient, recipientUserId, senderUserId);

            const content = senderName ? `<b>${senderName}:</b> ${params.message as string}` : (params.message as string);
            await a365Client.postChatMessage(chatId, content);

            return { success: true, data: { sent: true, recipient: recipientStr, email, via: 'a365-mcp' } };
          } catch (err) {
            console.error('[send_teams_dm] A365 MCP path failed, trying fallback:', (err as Error).message);
          }
        }

        // ── Fallback: Bot Framework proactive messaging ───────────
        if (dmSender) {
          try {
            await dmSender.sendToEmail(email, params.message as string, senderName);
            return { success: true, data: { sent: true, recipient: recipientStr, email, via: 'bot-framework' } };
          } catch (err) {
            return {
              success: false,
              error: `Failed to send DM: ${(err as Error).message}`,
            };
          }
        }

        return {
          success: false,
          error: 'Teams DM sender not configured. Ensure AGENT365_ENABLED=true with A365 credentials, or BOT_APP_ID/BOT_APP_SECRET/BOT_TENANT_ID.',
        };
      },
    },
  ];
}
