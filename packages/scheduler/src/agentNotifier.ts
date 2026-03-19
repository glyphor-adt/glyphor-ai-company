/**
 * Agent Notifier — Proactive agent-to-founder communication
 *
 * Parses agent outputs for notification intents and delivers them
 * to founders via Teams DM or channel posts. Agents can include
 * structured notification blocks in their output to trigger
 * proactive outreach.
 *
 * Notification intent format (embedded in agent output):
 *   <notify type="update|question|blocker|completed|fyi" to="kristina|andrew|both" title="...">
 *     Message body here
 *   </notify>
 *
 * Examples:
 *   <notify type="question" to="kristina" title="Content approval needed">
 *     Maya drafted a case study. Should we publish it this week or wait for metrics?
 *     Options: Publish now | Wait for next week's data | Revise angle
 *   </notify>
 *
 *   <notify type="update" to="both" title="API costs trending up 22%">
 *     Gemini costs rose from $180 to $220 this week due to hero section variants.
 *   </notify>
 */

import {
  formatNotificationCard,
  buildChannelMap,
  A365TeamsChatClient,
  type GraphTeamsClient,
  type NotificationType,
  type NotificationCardData,
  type ChannelMap,
  type AdaptiveCard,
} from '@glyphor/integrations';

// Agent role → display name
const AGENT_NAMES: Record<string, string> = {
  'chief-of-staff': 'Sarah Chen', cto: 'Marcus Reeves', cpo: 'Elena Vasquez',
  cfo: 'Nadia Okafor', cmo: 'Maya Brooks',
  'vp-sales': 'Rachel Kim', 'vp-design': 'Mia Tanaka', ops: 'Atlas Vega',
  'platform-engineer': 'Alex Park', 'quality-engineer': 'Sam DeLuca',
  'devops-engineer': 'Jordan Hayes', 'user-researcher': 'Priya Sharma',
  'competitive-intel': 'Daniel Ortiz',
  'content-creator': 'Tyler Reed',
  'seo-analyst': 'Lisa Chen', 'social-media-manager': 'Kai Johnson',
  'm365-admin': 'Riley Morgan',
  'global-admin': 'Morgan Blake', 'head-of-hr': 'Ava Martinez',
  clo: 'Legal', 'vp-research': 'Research Lead',
  'platform-intel': 'Nexus',
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

        // Determine recipients
        const targets: string[] = notif.to === 'both'
          ? ['kristina', 'andrew']
          : [notif.to];

        for (const target of targets) {
          const upn = this.founderUpns[target];

          // Try A365 MCP DM first (plain text — Adaptive Cards not supported)
          if (this.a365Client && upn) {
            try {
              const chatId = await this.a365Client.createOrGetOneOnOneChat(upn, undefined, agentRole);
              const textMessage = this.formatNotificationText(agentName, notif);
              await this.a365Client.postChatMessage(chatId, textMessage, agentRole);
              console.log(`[AgentNotifier] ${agentName} → DM to ${target}: ${notif.title}`);
              sent++;
              continue;
            } catch (err) {
              console.warn(`[AgentNotifier] A365 DM to ${target} failed, falling back to channel:`, (err as Error).message);
            }
          }

          // Fall back to channel post (Adaptive Card via Graph API)
          await this.sendToFallbackChannel(agentRole, cardContent);
          sent++;
        }
      } catch (err) {
        console.error(`[AgentNotifier] Failed to process notification from ${agentName}:`, (err as Error).message);
      }
    }

    return sent;
  }

  /**
   * Send a notification card to the agent's department channel as a fallback.
   */
  private async sendToFallbackChannel(
    agentRole: string,
    cardContent: Record<string, unknown>,
  ): Promise<void> {
    if (!this.graphClient) return;

    // Try the agent's department channel first, then fall back to general
    const channelKey = this.getDepartmentChannel(agentRole) as keyof ChannelMap;
    const channel = this.channels[channelKey] ?? this.channels['general' as keyof ChannelMap];
    if (!channel) return;

    await this.graphClient.sendCard(
      { teamId: channel.teamId, channelId: channel.channelId },
      cardContent as unknown as AdaptiveCard,
    ).catch((err: unknown) => console.error('[AgentNotifier] Channel fallback failed:', err));
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

  /**
   * Map agent role to their department channel.
   */
  private getDepartmentChannel(agentRole: string): string {
    const map: Record<string, string> = {
      cto: 'engineering', 'platform-engineer': 'engineering', 'quality-engineer': 'engineering',
      'devops-engineer': 'engineering', cpo: 'product', 'user-researcher': 'product',
      'competitive-intel': 'product', cfo: 'finance',
      cmo: 'marketing', 'content-creator': 'marketing',
      'seo-analyst': 'marketing', 'social-media-manager': 'marketing',
      'vp-sales': 'sales',
      'vp-design': 'design', 'ui-ux-designer': 'design', 'frontend-engineer': 'design',
      'design-critic': 'design', 'template-architect': 'design',
    };
    return map[agentRole] ?? 'general';
  }
}
