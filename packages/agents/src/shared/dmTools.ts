/**
 * DM Tools — Shared Teams direct message tools for all agents
 *
 * Provides send_teams_dm and read_teams_dm. Primary send path uses Bot
 * Framework proactive messaging. Teams MCP is used for chat creation and
 * DM history reads where available.
 *
 * Flow (Bot Framework path):
 *   1. Resolve recipient email → Entra Object ID (Graph API, app-only)
 *   2. Acquire Bot Framework token with https://api.botframework.com/.default
 *   3. Create conversation + send message via Bot Framework REST API
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
  'kristina denney': 'kristina@glyphor.ai',
  andrew: 'andrew@glyphor.ai',
  'andrew zwelling': 'andrew@glyphor.ai',
};

/**
 * Email aliases that exist outside Entra (e.g. Google Workspace) but should
 * resolve to the corresponding Entra UPN for Graph API lookups.
 */
const EMAIL_ALIASES: Record<string, string> = {
  'devops@glyphor.ai': 'kristina@glyphor.ai',
};

/** Cache for email → Entra Object ID lookups */
const userIdCache = new Map<string, string>();

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

  // Raw email — resolve through alias map first
  if (recipient.includes('@')) return EMAIL_ALIASES[recipient.toLowerCase()] ?? recipient;

  return null;
}

/**
 * Resolve email → Entra Object ID via Graph API (app-only token).
 */
async function resolveUserIdByEmail(
  graphClient: GraphTeamsClient,
  email: string,
): Promise<string> {
  // Translate non-Entra aliases before Graph lookup
  const resolved = EMAIL_ALIASES[email.toLowerCase()] ?? email;
  const key = resolved.toLowerCase();
  const cached = userIdCache.get(key);
  if (cached) return cached;

  const token = await graphClient.getAccessToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(resolved)}?$select=id`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to resolve user "${resolved}" (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { id: string };
  userIdCache.set(key, data.id);
  return data.id;
}

function htmlToText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

function extractMessageSender(message: Record<string, unknown>): string {
  const from = message.from;
  if (!from || typeof from !== 'object') return 'Unknown sender';

  const user = (from as { user?: { displayName?: unknown } }).user;
  if (user && typeof user.displayName === 'string' && user.displayName) return user.displayName;

  const application = (from as { application?: { displayName?: unknown } }).application;
  if (application && typeof application.displayName === 'string' && application.displayName) return application.displayName;

  return 'Unknown sender';
}

function extractMessageText(message: Record<string, unknown>): string {
  const body = message.body;
  if (!body || typeof body !== 'object') return '';
  const content = (body as { content?: unknown }).content;
  if (typeof content !== 'string') return '';
  return htmlToText(content);
}

/**
 * Create Teams DM tools. The sender name is resolved at execution time
 * from `ctx.agentRole`, so no constructor-time role is needed.
 */
export function createDmTools(): ToolDefinition[] {
  let graphClient: GraphTeamsClient | null = null;
  let dmSender: BotDmSender | null = null;

  try {
    graphClient = GraphTeamsClient.fromEnv();
  } catch {
    // Graph client not configured
  }

  try {
    if (graphClient) {
      dmSender = BotDmSender.fromEnv(graphClient);
    }
  } catch {
    // Bot Framework not configured
  }

  function getA365Client(role?: CompanyAgentRole): A365TeamsChatClient | null {
    try {
      return A365TeamsChatClient.fromEnv(role);
    } catch {
      return null;
    }
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
        const a365Client = getA365Client(role);

        // ── Primary path: Bot Framework proactive messaging ──────
        // Bot Framework is the correct approach for proactive DMs —
        // it supports app-level credentials for initiating conversations.
        if (dmSender) {
          try {
            await dmSender.sendToEmail(email, params.message as string, senderName);
            return { success: true, data: { sent: true, recipient: recipientStr, email, via: 'bot-framework' } };
          } catch (err) {
            console.error('[send_teams_dm] Bot Framework path failed, trying A365 MCP:', (err as Error).message);
          }
        }

        // ── Fallback: A365 MCP (delegated permissions) ───────────
        // Works for posting in chats where the agent blueprint has access.
        // CreateChat accepts UPNs (emails) directly, no Graph userId lookup needed.
        if (a365Client) {
          try {
            const chatId = await a365Client.createOrGetOneOnOneChat(email, senderEmail);

            const content = senderName ? `${senderName}: ${params.message as string}` : (params.message as string);
            await a365Client.postChatMessage(chatId, content, role);

            return { success: true, data: { sent: true, recipient: recipientStr, email, via: 'a365-mcp' } };
          } catch (err) {
            console.error('[send_teams_dm] A365 MCP path failed:', (err as Error).message);
            return {
              success: false,
              error: `Failed to send DM: ${(err as Error).message}`,
            };
          }
        }

        return {
          success: false,
          error: 'Teams DM sender not configured. Set BOT_APP_ID/BOT_APP_SECRET/BOT_TENANT_ID for Bot Framework, or AGENT365_ENABLED=true for A365 MCP.',
        };
      },
    },
    {
      name: 'read_teams_dm',
      description:
        'Read recent messages from a Teams 1:1 chat with a person. ' +
        'Accepts a founder name, agent role slug, display name, or email address.',
      parameters: {
        recipient: {
          type: 'string',
          description:
            'Who to inspect DMs with — founder name (kristina/andrew), agent role, display name, or email',
          required: true,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of recent messages to return (default: 10, max: 25)',
          required: false,
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

        const role = ctx?.agentRole as CompanyAgentRole | undefined;
        const a365Client = getA365Client(role);
        if (!a365Client) {
          return {
            success: false,
            error: 'Teams DM reading requires Agent 365 credentials for the current agent role.',
          };
        }

        const senderEmail = role ? AGENT_EMAIL_MAP[role]?.email : undefined;

        try {
          const chatId = await a365Client.createOrGetOneOnOneChat(email, senderEmail);

          const requestedLimit = typeof params.limit === 'number' ? params.limit : Number(params.limit ?? 10);
          const limit = Number.isFinite(requestedLimit)
            ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 25)
            : 10;

          const messages = await a365Client.listChatMessages(chatId, limit);
          const orderedMessages = [...messages].reverse().map((message) => ({
            id: typeof message.id === 'string' ? message.id : undefined,
            createdAt: typeof message.createdDateTime === 'string' ? message.createdDateTime : undefined,
            sender: extractMessageSender(message),
            text: extractMessageText(message),
          }));

          return {
            success: true,
            data: {
              recipient: recipientStr,
              email,
              chatId,
              messageCount: orderedMessages.length,
              messages: orderedMessages,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Failed to read Teams DM: ${(err as Error).message}`,
          };
        }
      },
    },
  ];
}
