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
  type TeamsBotHandler,
  type NotificationType,
  type NotificationCardData,
  type ChannelMap,
} from '@glyphor/integrations';

// Agent role → display name
const AGENT_NAMES: Record<string, string> = {
  'chief-of-staff': 'Sarah Chen', cto: 'Marcus Reeves', cpo: 'Elena Vasquez',
  cfo: 'Nadia Okafor', cmo: 'Maya Brooks', 'vp-customer-success': 'James Turner',
  'vp-sales': 'Rachel Kim', 'vp-design': 'Mia Tanaka', ops: 'Atlas Vega',
  'platform-engineer': 'Alex Park', 'quality-engineer': 'Sam DeLuca',
  'devops-engineer': 'Jordan Hayes', 'user-researcher': 'Priya Sharma',
  'competitive-intel': 'Daniel Ortiz', 'revenue-analyst': 'Anna Park',
  'cost-analyst': 'Omar Hassan', 'content-creator': 'Tyler Reed',
  'seo-analyst': 'Lisa Chen', 'social-media-manager': 'Kai Johnson',
  'onboarding-specialist': 'Emma Wright', 'support-triage': 'David Santos',
  'account-research': 'Nathan Cole', 'm365-admin': 'Riley Morgan',
  'global-admin': 'Morgan Blake', 'head-of-hr': 'Ava Martinez',
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
  private readonly botHandler: TeamsBotHandler;
  private readonly founderIds: Record<string, string>;
  private readonly channels: Partial<ChannelMap>;

  constructor(botHandler: TeamsBotHandler) {
    this.botHandler = botHandler;
    this.founderIds = {
      kristina: process.env.TEAMS_USER_KRISTINA_ID ?? '',
      andrew: process.env.TEAMS_USER_ANDREW_ID ?? '',
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
          const userId = this.founderIds[target];
          if (!userId) {
            console.warn(`[AgentNotifier] No Entra ID configured for ${target}, falling back to channel`);
            await this.sendToFallbackChannel(agentRole, cardContent);
            continue;
          }

          try {
            await this.botHandler.sendProactiveCardToUser(userId, cardContent);
            console.log(`[AgentNotifier] ${agentName} → DM to ${target}: ${notif.title}`);
            sent++;
          } catch (err) {
            // DM failed — fall back to channel post
            console.warn(`[AgentNotifier] DM to ${target} failed, posting to channel:`, (err as Error).message);
            await this.sendToFallbackChannel(agentRole, cardContent);
            sent++;
          }
        }
      } catch (err) {
        console.error(`[AgentNotifier] Failed to process notification from ${agentName}:`, (err as Error).message);
      }
    }

    return sent;
  }

  /**
   * Send a notification card to the general channel as a fallback.
   */
  private async sendToFallbackChannel(
    agentRole: string,
    cardContent: Record<string, unknown>,
  ): Promise<void> {
    // Try the agent's department channel first, then fall back to general
    const channelKey = this.getDepartmentChannel(agentRole) as keyof ChannelMap;
    const channel = this.channels[channelKey] ?? this.channels['general' as keyof ChannelMap];
    if (!channel) return;

    await this.botHandler.sendProactiveCardToChannel(
      channel.teamId,
      channel.channelId,
      cardContent,
    ).catch((err: unknown) => console.error('[AgentNotifier] Channel fallback failed:', err));
  }

  /**
   * Map agent role to their department channel.
   */
  private getDepartmentChannel(agentRole: string): string {
    const map: Record<string, string> = {
      cto: 'engineering', 'platform-engineer': 'engineering', 'quality-engineer': 'engineering',
      'devops-engineer': 'engineering', cpo: 'product', 'user-researcher': 'product',
      'competitive-intel': 'product', cfo: 'finance', 'revenue-analyst': 'finance',
      'cost-analyst': 'finance', cmo: 'marketing', 'content-creator': 'marketing',
      'seo-analyst': 'marketing', 'social-media-manager': 'marketing',
      'vp-customer-success': 'customer-success', 'onboarding-specialist': 'customer-success',
      'support-triage': 'customer-success', 'vp-sales': 'sales', 'account-research': 'sales',
      'vp-design': 'design', 'ui-ux-designer': 'design', 'frontend-engineer': 'design',
      'design-critic': 'design', 'template-architect': 'design',
    };
    return map[agentRole] ?? 'general';
  }
}
