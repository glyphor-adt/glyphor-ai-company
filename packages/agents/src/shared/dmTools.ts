/**
 * DM Tools — Shared Teams direct message tools for all agents
 *
 * Provides send_teams_dm tool. Uses Bot Framework proactive messaging
 * to send 1:1 DMs to any user by email address, founder key, or agent role.
 *
 * Note: Graph API app-only tokens cannot post chat messages (restricted to
 * import-only). Bot Framework proactive messaging is the correct approach.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { AGENT_EMAIL_MAP, type CompanyAgentRole } from '@glyphor/agent-runtime';
import {
  GraphTeamsClient,
  BotDmSender,
} from '@glyphor/integrations';

/** Founder keys → email addresses */
const FOUNDER_DIR: Record<string, string> = {
  kristina: 'kristina@glyphor.ai',
  andrew: 'andrew@glyphor.ai',
};

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
 * Create Teams DM tools. The sender name is resolved at execution time
 * from `ctx.agentRole`, so no constructor-time role is needed.
 */
export function createDmTools(): ToolDefinition[] {
  let dmSender: BotDmSender | null = null;
  try {
    const graphClient = GraphTeamsClient.fromEnv();
    dmSender = BotDmSender.fromEnv(graphClient);
  } catch {
    // Bot Framework not configured — tool will return an error
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
        if (!dmSender) {
          return {
            success: false,
            error: 'Teams DM sender not configured. Ensure BOT_APP_ID, BOT_APP_SECRET, and BOT_TENANT_ID are set.',
          };
        }

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

        try {
          await dmSender.sendToEmail(email, params.message as string, senderName);
          return { success: true, data: { sent: true, recipient: recipientStr, email } };
        } catch (err) {
          return {
            success: false,
            error: `Failed to send DM: ${(err as Error).message}`,
          };
        }
      },
    },
  ];
}
