/**
 * Teams Bot Handler
 *
 * Processes incoming messages from Microsoft Teams Bot Framework.
 * Supports @mention in channels, 1:1 chat, and slash-style commands.
 *
 * Architecture:
 *   Teams → Bot Framework → POST /api/teams/messages → this handler → agentExecutor → response
 *
 * Commands:
 *   ask [agent] [question] — Route a question to a specific agent
 *   briefing               — Get Sarah Chen's daily briefing
 *   status                 — Get Atlas Vega's system health check
 *   agents                 — List all agents and their current status
 *   (free text)            — Defaults to chief-of-staff
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { IncomingMessage } from 'node:http';

// ─── Types ──────────────────────────────────────────────────────

export interface BotConfig {
  appId: string;
  appSecret: string;
  tenantId: string;
}

export interface TeamsActivity {
  type: string;
  id: string;
  timestamp: string;
  serviceUrl: string;
  channelId: string;
  from: { id: string; name: string; aadObjectId?: string };
  conversation: { id: string; conversationType?: string; tenantId?: string; isGroup?: boolean };
  recipient: { id: string; name: string };
  text?: string;
  entities?: Array<{ type: string; mentioned?: { id: string; name: string }; text?: string }>;
  channelData?: Record<string, unknown>;
}

export interface BotResponse {
  type: 'message';
  text: string;
  textFormat?: 'plain' | 'markdown';
}

export type AgentRunner = (
  agentRole: string,
  task: string,
  payload: Record<string, unknown>,
) => Promise<{ output?: string | null; status?: string; error?: string } | void>;

// ─── Agent Name Resolution ──────────────────────────────────────

const AGENT_ALIASES: Record<string, string> = {
  'sarah': 'chief-of-staff', 'sarah chen': 'chief-of-staff', 'cos': 'chief-of-staff', 'chief of staff': 'chief-of-staff',
  'marcus': 'cto', 'marcus reeves': 'cto',
  'elena': 'cpo', 'elena vasquez': 'cpo',
  'nadia': 'cfo', 'nadia okafor': 'cfo',
  'maya': 'cmo', 'maya brooks': 'cmo',
  'james': 'vp-customer-success', 'james turner': 'vp-customer-success',
  'rachel': 'vp-sales', 'rachel kim': 'vp-sales',
  'mia': 'vp-design', 'mia tanaka': 'vp-design',
  'atlas': 'ops', 'atlas vega': 'ops',
  'alex': 'platform-engineer', 'alex park': 'platform-engineer',
  'sam': 'quality-engineer', 'sam deluca': 'quality-engineer',
  'jordan': 'devops-engineer', 'jordan hayes': 'devops-engineer',
  'priya': 'user-researcher', 'priya sharma': 'user-researcher',
  'daniel': 'competitive-intel', 'daniel ortiz': 'competitive-intel',
  'anna': 'revenue-analyst', 'anna park': 'revenue-analyst',
  'omar': 'cost-analyst', 'omar hassan': 'cost-analyst',
  'tyler': 'content-creator', 'tyler reed': 'content-creator',
  'lisa': 'seo-analyst', 'lisa chen': 'seo-analyst',
  'kai': 'social-media-manager', 'kai johnson': 'social-media-manager',
  'emma': 'onboarding-specialist', 'emma wright': 'onboarding-specialist',
  'david': 'support-triage', 'david santos': 'support-triage',
  'nathan': 'account-research', 'nathan cole': 'account-research',
};

const AGENT_DISPLAY: Record<string, string> = {
  'chief-of-staff': 'Sarah Chen', cto: 'Marcus Reeves', cpo: 'Elena Vasquez',
  cfo: 'Nadia Okafor', cmo: 'Maya Brooks', 'vp-customer-success': 'James Turner',
  'vp-sales': 'Rachel Kim', 'vp-design': 'Mia Tanaka', ops: 'Atlas Vega',
  'platform-engineer': 'Alex Park', 'quality-engineer': 'Sam DeLuca',
  'devops-engineer': 'Jordan Hayes', 'user-researcher': 'Priya Sharma',
  'competitive-intel': 'Daniel Ortiz', 'revenue-analyst': 'Anna Park',
  'cost-analyst': 'Omar Hassan', 'content-creator': 'Tyler Reed',
  'seo-analyst': 'Lisa Chen', 'social-media-manager': 'Kai Johnson',
  'onboarding-specialist': 'Emma Wright', 'support-triage': 'David Santos',
  'account-research': 'Nathan Cole',
};

function resolveAgent(input: string): string | null {
  const lower = input.toLowerCase().trim();
  if (AGENT_ALIASES[lower]) return AGENT_ALIASES[lower];
  // Try direct role match
  if (AGENT_DISPLAY[lower]) return lower;
  // Partial match
  for (const [alias, role] of Object.entries(AGENT_ALIASES)) {
    if (alias.startsWith(lower) || lower.startsWith(alias)) return role;
  }
  return null;
}

// ─── Bot Token Validation ───────────────────────────────────────

/**
 * Validate the Bot Framework JWT token from the Authorization header.
 * In production, this would verify against the Bot Framework OpenID metadata.
 * For now, we check the header format and trust the Bot Framework service.
 */
export function extractBearerToken(req: IncomingMessage): string | null {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

// ─── Message Parsing ────────────────────────────────────────────

interface ParsedCommand {
  command: 'ask' | 'briefing' | 'status' | 'agents' | 'freetext';
  agentRole: string;
  message: string;
}

function stripBotMention(text: string, botName: string): string {
  // Remove @mention of the bot
  const mentionPattern = new RegExp(`<at>${botName}</at>`, 'gi');
  return text.replace(mentionPattern, '').trim();
}

function parseMessage(activity: TeamsActivity, botName: string): ParsedCommand {
  let text = activity.text ?? '';

  // Strip bot @mention from text
  if (activity.entities) {
    for (const entity of activity.entities) {
      if (entity.type === 'mention' && entity.mentioned?.id === activity.recipient.id && entity.text) {
        text = text.replace(entity.text, '').trim();
      }
    }
  }
  text = stripBotMention(text, botName).trim();

  if (!text) {
    return { command: 'freetext', agentRole: 'chief-of-staff', message: 'Hello!' };
  }

  const lower = text.toLowerCase();

  // Command: briefing
  if (lower === 'briefing' || lower === 'daily briefing' || lower.startsWith('briefing ')) {
    return { command: 'briefing', agentRole: 'chief-of-staff', message: text };
  }

  // Command: status
  if (lower === 'status' || lower === 'health' || lower.startsWith('status ')) {
    return { command: 'status', agentRole: 'ops', message: text };
  }

  // Command: agents / list
  if (lower === 'agents' || lower === 'list agents' || lower === 'list') {
    return { command: 'agents', agentRole: 'ops', message: '' };
  }

  // Command: ask [agent] [question]
  if (lower.startsWith('ask ')) {
    const rest = text.slice(4).trim();
    // Try to match agent name (1 or 2 words)
    const words = rest.split(/\s+/);
    // Try two-word name first
    if (words.length >= 3) {
      const twoWord = `${words[0]} ${words[1]}`;
      const agent = resolveAgent(twoWord);
      if (agent) {
        return { command: 'ask', agentRole: agent, message: words.slice(2).join(' ') };
      }
    }
    // Try single word
    if (words.length >= 2) {
      const agent = resolveAgent(words[0]);
      if (agent) {
        return { command: 'ask', agentRole: agent, message: words.slice(1).join(' ') };
      }
    }
    // No agent found — default to chief-of-staff
    return { command: 'ask', agentRole: 'chief-of-staff', message: rest };
  }

  // Free text — route to chief-of-staff
  return { command: 'freetext', agentRole: 'chief-of-staff', message: text };
}

// ─── Bot Handler ────────────────────────────────────────────────

export class TeamsBotHandler {
  private readonly config: BotConfig;
  private readonly agentRunner: AgentRunner;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(config: BotConfig, agentRunner: AgentRunner) {
    this.config = config;
    this.agentRunner = agentRunner;
  }

  static fromEnv(agentRunner: AgentRunner): TeamsBotHandler | null {
    const appId = process.env.BOT_APP_ID;
    const appSecret = process.env.BOT_APP_SECRET;
    const tenantId = process.env.BOT_TENANT_ID ?? process.env.AZURE_TENANT_ID;

    if (!appId || !appSecret || !tenantId) return null;

    return new TeamsBotHandler({ appId, appSecret, tenantId }, agentRunner);
  }

  /**
   * Acquire a Bot Framework token for replying to messages.
   */
  private async getBotToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.token;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      scope: 'https://api.botframework.com/.default',
    });

    const res = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(this.config.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    );

    if (!res.ok) {
      throw new Error(`Failed to get bot token: ${res.status}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.tokenCache = {
      token: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };

    return data.access_token;
  }

  /**
   * Reply to a Teams activity using the Bot Framework REST API.
   */
  private async replyToActivity(
    serviceUrl: string,
    conversationId: string,
    activityId: string,
    response: BotResponse,
  ): Promise<void> {
    const token = await this.getBotToken();
    const url = `${serviceUrl}v3/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(activityId)}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(response),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[TeamsBot] Reply failed (${res.status}): ${text}`);
    }
  }

  /**
   * Send a typing indicator to show the bot is "thinking."
   */
  private async sendTyping(
    serviceUrl: string,
    conversationId: string,
  ): Promise<void> {
    const token = await this.getBotToken();
    const url = `${serviceUrl}v3/conversations/${encodeURIComponent(conversationId)}/activities`;

    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'typing' }),
    }).catch(() => {}); // Best-effort
  }

  /**
   * Handle an incoming Bot Framework activity.
   */
  async handleActivity(activity: TeamsActivity): Promise<void> {
    if (activity.type === 'conversationUpdate') {
      // Bot was added to a conversation — send welcome message
      console.log('[TeamsBot] Conversation update');
      return;
    }

    if (activity.type !== 'message') {
      console.log(`[TeamsBot] Ignoring activity type: ${activity.type}`);
      return;
    }

    const parsed = parseMessage(activity, 'Glyphor AI');

    console.log(`[TeamsBot] ${activity.from.name}: "${parsed.command}" → ${parsed.agentRole}: "${parsed.message}"`);

    // Send typing indicator
    await this.sendTyping(activity.serviceUrl, activity.conversation.id);

    let responseText: string;

    if (parsed.command === 'agents') {
      // List all agents
      const agentList = Object.entries(AGENT_DISPLAY)
        .map(([role, name]) => `• **${name}** (\`${role}\`)`)
        .join('\n');
      responseText = `## Glyphor AI Agents\n\n${agentList}\n\n_Use \`ask [name] [question]\` to chat with any agent._`;
    } else {
      // Run the agent
      try {
        const result = await this.agentRunner(parsed.agentRole, 'on_demand', {
          message: parsed.message,
        });

        const displayName = AGENT_DISPLAY[parsed.agentRole] ?? parsed.agentRole;

        if (result?.output) {
          // Strip reasoning tags
          const clean = result.output.replace(/<reasoning>[\s\S]*?<\/reasoning>\s*/g, '').trim();
          responseText = `**${displayName}:**\n\n${clean}`;
        } else if (result?.error) {
          responseText = `**${displayName}** encountered an error: ${result.error}`;
        } else {
          responseText = `**${displayName}** completed the task but had nothing to report.`;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        responseText = `Sorry, I couldn't reach **${AGENT_DISPLAY[parsed.agentRole] ?? parsed.agentRole}**: ${message}`;
      }
    }

    await this.replyToActivity(activity.serviceUrl, activity.conversation.id, activity.id, {
      type: 'message',
      text: responseText,
      textFormat: 'markdown',
    });
  }
}
