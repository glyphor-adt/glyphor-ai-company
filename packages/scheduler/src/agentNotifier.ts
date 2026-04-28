/**
 * Agent Notifier — LEGACY fallback for <notify> blocks
 *
 * Primary path: Agents call `post_to_briefings` tool during their run to post
 * updates as their own identity via Agent 365.
 *
 * Fallback path (this file): If an agent still emits old-style <notify> blocks
 * in their output, this parser catches them and posts to #briefings via the
 * shared delegated Graph token. This exists for backward compatibility during
 * the transition to direct agent channel posting.
 */

import {
  formatNotificationCard,
  buildChannelMap,
  postCardToChannel,
  A365TeamsChatClient,
  type GraphTeamsClient,
  type NotificationType,
  type NotificationCardData,
  type ChannelMap,
  type AdaptiveCard,
} from '@glyphor/integrations';
import { systemQuery } from '@glyphor/shared/db';

// Agent role → display name
const AGENT_NAMES: Record<string, string> = {
  'chief-of-staff': 'Sarah Chen', cto: 'Marcus Reeves', cpo: 'Elena Vasquez',
  cfo: 'Nadia Okafor', cmo: 'Maya Brooks',
  'vp-design': 'Mia Tanaka', ops: 'Atlas Vega',
  'platform-engineer': 'Alex Park', 'quality-engineer': 'Sam DeLuca',
  'devops-engineer': 'Jordan Hayes',
  clo: 'Legal', 'vp-research': 'Research Lead',
};

export interface ParsedNotification {
  type: NotificationType;
  to: 'kristina' | 'andrew' | 'both';
  title: string;
  message: string;
  options?: string[];
}

/**
 * Parse <notify> blocks from agent output text.
 */
export function parseNotifications(output: string): ParsedNotification[] {
  const notifications: ParsedNotification[] = [];
  const regex = /<notify\s+type="(update|question|blocker|completed|fyi)"\s+to="(kristina|andrew|both)"\s+title="([^"]+)">\s*([\s\S]*?)\s*<\/notify>/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(output)) !== null) {
    const [, type, to, title, body] = match;
    const lines = body.trim().split('\n').map(l => l.trim()).filter(Boolean);

    // Extract "Options: ..." line if present
    let options: string[] | undefined;
    const message: string[] = [];
    for (const line of lines) {
      if (line.toLowerCase().startsWith('options:')) {
        options = line.slice(8).split('|').map(o => o.trim()).filter(Boolean);
      } else {
        message.push(line);
      }
    }

    notifications.push({
      type: type as NotificationType,
      to: to as 'kristina' | 'andrew' | 'both',
      title,
      message: message.join('\n'),
      options,
    });
  }

  return notifications;
}

export class AgentNotifier {
  private readonly graphClient: GraphTeamsClient | null;
  private readonly a365Client: A365TeamsChatClient | null;
  private readonly founderUpns: Record<string, string>;
  private readonly channels: Partial<ChannelMap>;

  constructor(graphClient: GraphTeamsClient | null, a365Client?: A365TeamsChatClient | null) {
    this.graphClient = graphClient;
    this.a365Client = a365Client ?? A365TeamsChatClient.fromEnv();
    this.founderUpns = {
      kristina: process.env.TEAMS_USER_KRISTINA_EMAIL ?? 'kristina@glyphor.ai',
      andrew: process.env.TEAMS_USER_ANDREW_EMAIL ?? 'andrew@glyphor.ai',
    };
    this.channels = buildChannelMap();
  }

  /**
   * Process an agent's output and deliver any notification intents.
   * Posts to #briefings channel AS THE AGENT'S OWN IDENTITY via A365 Graph token.
   * Falls back to webhook/delegated Graph, then DMs.
   * Returns the number of notifications sent.
   */
  async processAgentOutput(
    agentRole: string,
    output: string,
  ): Promise<number> {
    const notifications = parseNotifications(output);
    if (notifications.length === 0) return 0;

    const agentName = AGENT_NAMES[agentRole] ?? agentRole;
    let sent = 0;

    for (const notif of notifications) {
      try {
        const cardData: NotificationCardData = {
          type: notif.type,
          agent: agentName,
          agentRole,
          title: notif.title,
          message: notif.message,
          options: notif.options,
        };

        const card = formatNotificationCard(cardData);
        const cardContent = card.attachments[0].content as unknown as Record<string, unknown>;

        let delivered = false;
        let deliveryMethod = 'none';
        let deliveryError: string | undefined;

        // Post to #briefings — passes agentRole so it tries A365 identity first
        try {
          const result = await postCardToChannel('briefings', cardContent as unknown as AdaptiveCard, this.graphClient, agentRole);
          if (result.method !== 'none') {
            delivered = true;
            deliveryMethod = result.method;
            console.log(`[AgentNotifier] ${agentName} → #briefings (${result.method}): ${notif.title}`);
          } else {
            throw new Error(result.error ?? 'No channel delivery method');
          }
        } catch (err) {
          deliveryError = (err as Error).message;
          console.warn(`[AgentNotifier] Channel post failed for ${agentName}:`, deliveryError);
        }

        // Fallback: DM both founders via A365
        if (!delivered && this.a365Client) {
          const textMessage = this.formatNotificationText(agentName, notif);
          for (const target of ['kristina', 'andrew'] as const) {
            const upn = this.founderUpns[target];
            if (!upn) continue;
            try {
              const chatId = await this.a365Client.createOrGetOneOnOneChat(upn, undefined, agentRole);
              await this.a365Client.postChatMessage(chatId, textMessage, agentRole);
              console.log(`[AgentNotifier] ${agentName} → DM fallback to ${target}: ${notif.title}`);
            } catch (dmErr) {
              console.warn(`[AgentNotifier] DM fallback to ${target} also failed:`, (dmErr as Error).message);
            }
          }
          delivered = true;
          deliveryMethod = 'dm_fallback';
        }

        // Log to activity_log
        try {
          await systemQuery(
            `INSERT INTO activity_log (agent_role, action, details, created_at)
             VALUES ($1, $2, $3, NOW())`,
            [
              agentRole,
              delivered ? 'alert' : 'alert_failed',
              delivered
                ? `${deliveryMethod} → ${notif.title}`
                : `Failed to deliver notification: ${notif.title} — ${deliveryError ?? 'unknown error'}`,
            ],
          );
        } catch (logErr) {
          console.warn('[AgentNotifier] Failed to log to activity_log:', (logErr as Error).message);
        }

        if (delivered) sent++;
      } catch (err) {
        console.error(`[AgentNotifier] Failed to process notification from ${agentName}:`, (err as Error).message);
      }
    }

    return sent;
  }

  /**
   * Format a notification as plain text for A365 MCP DMs (no Adaptive Card support).
   */
  private formatNotificationText(agentName: string, notif: ParsedNotification): string {
    const lines: string[] = [
      `[${notif.type.toUpperCase()}] ${notif.title}`,
      `From: ${agentName}`,
      '',
      notif.message,
    ];
    if (notif.options?.length) {
      lines.push('', 'Options: ' + notif.options.join(' | '));
    }
    return lines.join('\n');
  }
}
