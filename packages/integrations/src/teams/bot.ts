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
import { formatTeamsMessage } from './messageFormatter.js';
import { setConversationRef, getConversationRef, loadConversationRefs } from './conversationStore.js';

// ─── Types ──────────────────────────────────────────────────────

export interface BotConfig {
  appId: string;
  appSecret: string;
  tenantId: string;
}

/** An individual agent bot registration (extends BotConfig with role mapping). */
export interface AgentBotConfig {
  appId: string;
  appSecret: string;
  role: string;
  name: string;
}

export interface TeamsFileAttachment {
  contentType: string;
  contentUrl?: string;
  content?: unknown;
  name?: string;
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
  attachments?: TeamsFileAttachment[];
  entities?: Array<{ type: string; mentioned?: { id: string; name: string }; text?: string }>;
  channelData?: Record<string, unknown>;
}

export interface BotResponse {
  type: 'message';
  text?: string;
  textFormat?: 'plain' | 'markdown';
  attachments?: Array<{
    contentType: string;
    content: unknown;
  }>;
}

export type AgentRunner = (
  agentRole: string,
  task: string,
  payload: Record<string, unknown>,
) => Promise<{ output?: string | null; status?: string; error?: string } | void>;

// ─── Agent Name Resolution ──────────────────────────────────────

const AGENT_ALIASES: Record<string, string> = {
  // C-Suite & Chiefs
  'sarah': 'chief-of-staff', 'sarah chen': 'chief-of-staff', 'cos': 'chief-of-staff', 'chief of staff': 'chief-of-staff',
  'marcus': 'cto', 'marcus reeves': 'cto',
  'elena': 'cpo', 'elena vasquez': 'cpo',
  'nadia': 'cfo', 'nadia okafor': 'cfo',
  'maya': 'cmo', 'maya brooks': 'cmo',
  'victoria': 'clo', 'victoria chase': 'clo', 'chief legal': 'clo',
  // VPs
  'james': 'vp-customer-success', 'james turner': 'vp-customer-success',
  'rachel': 'vp-sales', 'rachel kim': 'vp-sales',
  'mia': 'vp-design', 'mia tanaka': 'vp-design',
  'sophia': 'vp-research', 'sophia lin': 'vp-research',
  // Engineering
  'alex': 'platform-engineer', 'alex park': 'platform-engineer',
  'sam': 'quality-engineer', 'sam deluca': 'quality-engineer',
  'jordan': 'devops-engineer', 'jordan hayes': 'devops-engineer',
  'ava': 'frontend-engineer', 'ava chen': 'frontend-engineer',
  // Design
  'leo': 'ui-ux-designer', 'leo vargas': 'ui-ux-designer',
  'sofia': 'design-critic', 'sofia marchetti': 'design-critic',
  'ryan': 'template-architect', 'ryan park': 'template-architect',
  // Research
  'priya': 'user-researcher', 'priya sharma': 'user-researcher',
  'daniel ortiz': 'competitive-intel',
  'daniel okafor': 'market-research-analyst',
  'anna': 'revenue-analyst', 'anna park': 'revenue-analyst',
  'lena': 'competitive-research-analyst', 'lena park': 'competitive-research-analyst',
  'kai nakamura': 'technical-research-analyst',
  'amara': 'industry-research-analyst', 'amara diallo': 'industry-research-analyst',
  // Marketing
  'tyler': 'content-creator', 'tyler reed': 'content-creator',
  'lisa': 'seo-analyst', 'lisa chen': 'seo-analyst',
  'kai johnson': 'social-media-manager',
  'zara': 'marketing-intelligence-analyst', 'zara petrov': 'marketing-intelligence-analyst',
  // Finance
  'omar': 'cost-analyst', 'omar hassan': 'cost-analyst',
  'bob': 'bob-the-tax-pro', 'bob finley': 'bob-the-tax-pro',
  'mariana': 'tax-strategy-specialist', 'mariana solis': 'tax-strategy-specialist',
  // Customer Success
  'emma': 'onboarding-specialist', 'emma wright': 'onboarding-specialist',
  'david': 'support-triage', 'david santos': 'support-triage',
  'nathan': 'account-research', 'nathan cole': 'account-research',
  'ethan': 'enterprise-account-researcher', 'ethan morse': 'enterprise-account-researcher',
  // Sales
  'derek': 'lead-gen-specialist', 'derek owens': 'lead-gen-specialist',
  // Legal & Compliance
  'grace': 'data-integrity-auditor', 'grace hwang': 'data-integrity-auditor',
  // People & Culture
  'jasmine': 'head-of-hr', 'jasmine rivera': 'head-of-hr', 'hr': 'head-of-hr',
  // Ops & IT
  'atlas': 'ops', 'atlas vega': 'ops',
  'riley': 'm365-admin', 'riley morgan': 'm365-admin', 'm365': 'm365-admin', 'it': 'm365-admin',
  'morgan': 'global-admin', 'morgan blake': 'global-admin', 'global admin': 'global-admin',
  // Executive Assistant
  'adi': 'adi-rose', 'adi rose': 'adi-rose',
};

const AGENT_DISPLAY: Record<string, string> = {
  // C-Suite & Chiefs
  'chief-of-staff': 'Sarah Chen', cto: 'Marcus Reeves', cpo: 'Elena Vasquez',
  cfo: 'Nadia Okafor', cmo: 'Maya Brooks', clo: 'Victoria Chase',
  // VPs
  'vp-customer-success': 'James Turner', 'vp-sales': 'Rachel Kim',
  'vp-design': 'Mia Tanaka', 'vp-research': 'Sophia Lin',
  // Engineering
  'platform-engineer': 'Alex Park', 'quality-engineer': 'Sam DeLuca',
  'devops-engineer': 'Jordan Hayes', 'frontend-engineer': 'Ava Chen',
  // Design
  'ui-ux-designer': 'Leo Vargas', 'design-critic': 'Sofia Marchetti',
  'template-architect': 'Ryan Park',
  // Research
  'user-researcher': 'Priya Sharma', 'competitive-intel': 'Daniel Ortiz',
  'market-research-analyst': 'Daniel Okafor', 'competitive-research-analyst': 'Lena Park',
  'technical-research-analyst': 'Kai Nakamura', 'industry-research-analyst': 'Amara Diallo',
  // Marketing
  'content-creator': 'Tyler Reed', 'seo-analyst': 'Lisa Chen',
  'social-media-manager': 'Kai Johnson', 'marketing-intelligence-analyst': 'Zara Petrov',
  // Finance
  'revenue-analyst': 'Anna Park', 'cost-analyst': 'Omar Hassan',
  'bob-the-tax-pro': 'Bob Finley', 'tax-strategy-specialist': 'Mariana Solis',
  // Customer Success
  'onboarding-specialist': 'Emma Wright', 'support-triage': 'David Santos',
  'account-research': 'Nathan Cole', 'enterprise-account-researcher': 'Ethan Morse',
  // Sales
  'lead-gen-specialist': 'Derek Owens',
  // Legal & Compliance
  'data-integrity-auditor': 'Grace Hwang',
  // People & Culture
  'head-of-hr': 'Jasmine Rivera',
  // Ops & IT
  ops: 'Atlas Vega', 'm365-admin': 'Riley Morgan', 'global-admin': 'Morgan Blake',
  // Executive Assistant
  'adi-rose': 'Adi Rose',
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
 * Extract the bearer token from the Authorization header.
 */
export function extractBearerToken(req: IncomingMessage): string | null {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

// Bot Framework OpenID Connect metadata URLs
const BF_OPENID_URL = 'https://login.botframework.com/v1/.well-known/openidconfiguration';
const ENTRA_OPENID_URL = (tenantId: string) =>
  `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`;

/**
 * Validates incoming JWT tokens from Bot Framework.
 * Checks signature (via JWKS), issuer, audience, and expiry.
 * Supports multiple bot app IDs as valid audiences.
 */
export class BotTokenValidator {
  private bfJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private entraJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private readonly validAudiences: string[];
  private readonly tenantId: string;

  constructor(appId: string, tenantId: string, additionalAudiences?: string[]) {
    // SingleTenant bots receive tokens with audience 'api://botid-{appId}' from Bot Framework
    const audiences = [appId, `api://botid-${appId}`];
    for (const extra of additionalAudiences ?? []) {
      audiences.push(extra, `api://botid-${extra}`);
    }
    this.validAudiences = audiences;
    this.tenantId = tenantId;
  }

  /**
   * Lazily fetch and cache the JWKS (JSON Web Key Set) for Bot Framework tokens.
   */
  private async getBfJwks(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    if (this.bfJwks) return this.bfJwks;
    const res = await fetch(BF_OPENID_URL);
    const config = (await res.json()) as { jwks_uri: string };
    this.bfJwks = createRemoteJWKSet(new URL(config.jwks_uri));
    return this.bfJwks;
  }

  /**
   * Lazily fetch and cache the JWKS for Entra ID (SingleTenant) tokens.
   */
  private async getEntraJwks(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    if (this.entraJwks) return this.entraJwks;
    const res = await fetch(ENTRA_OPENID_URL(this.tenantId));
    const config = (await res.json()) as { jwks_uri: string };
    this.entraJwks = createRemoteJWKSet(new URL(config.jwks_uri));
    return this.entraJwks;
  }

  /**
   * Validate a JWT token from an incoming Bot Framework request.
   * Tries Bot Framework issuer first, then Entra ID (SingleTenant).
   * Returns the validated payload, or throws on failure.
   */
  async validate(token: string): Promise<JWTPayload> {
    // Try each valid audience against each issuer
    const issuers = [
      { getJwks: () => this.getBfJwks(), issuer: 'https://api.botframework.com' },
      { getJwks: () => this.getEntraJwks(), issuer: `https://login.microsoftonline.com/${this.tenantId}/v2.0` },
      { getJwks: () => this.getEntraJwks(), issuer: `https://sts.windows.net/${this.tenantId}/` },
    ];

    for (const { getJwks, issuer } of issuers) {
      for (const audience of this.validAudiences) {
        try {
          const jwks = await getJwks();
          const { payload } = await jwtVerify(token, jwks, {
            audience,
            issuer,
            clockTolerance: 300,
          });
          return payload;
        } catch {
          // Try next combination
        }
      }
    }

    throw new Error('Bot token validation failed: no valid issuer/audience combination');
  }
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

  // Free text — check if message starts with an agent name (with or without @)
  const freeWords = text.replace(/^@/, '').split(/\s+/);
  // Try two-word name first
  if (freeWords.length >= 2) {
    const twoWord = `${freeWords[0]} ${freeWords[1]}`;
    const agent = resolveAgent(twoWord);
    if (agent) {
      return { command: 'ask', agentRole: agent, message: freeWords.slice(2).join(' ') || 'Hello!' };
    }
  }
  // Try single word name
  if (freeWords.length >= 1) {
    const agent = resolveAgent(freeWords[0]);
    if (agent) {
      return { command: 'ask', agentRole: agent, message: freeWords.slice(1).join(' ') || 'Hello!' };
    }
  }

  // No agent name detected — route to chief-of-staff
  return { command: 'freetext', agentRole: 'chief-of-staff', message: text };
}

// ─── Bot Handler ────────────────────────────────────────────────

/**
 * Build a lookup from Entra Object ID → founder display name.
 * Uses the same TEAMS_USER_*_ID env vars as the DM client.
 */
function buildEntraIdLookup(): Map<string, string> {
  const map = new Map<string, string>();
  const kristinaId = process.env.TEAMS_USER_KRISTINA_ID;
  if (kristinaId) map.set(kristinaId, 'Kristina Denney');
  const andrewId = process.env.TEAMS_USER_ANDREW_ID;
  if (andrewId) map.set(andrewId, 'Andrew Zwelling');
  return map;
}

export class TeamsBotHandler {
  private readonly config: BotConfig;
  private readonly agentRunner: AgentRunner;
  private readonly tokenValidator: BotTokenValidator;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  /** Maps bot appId → { role, name, appSecret } for individual agent bots. */
  private readonly agentBots: Map<string, AgentBotConfig & { appSecret: string }>;
  /** Per-bot token cache for replying as the correct bot identity. */
  private readonly agentTokenCache = new Map<string, { token: string; expiresAt: number }>();
  /** Cached Graph API token for proactive app installation. */
  private _graphTokenCache: { token: string; expiresAt: number } | null = null;
  /** Maps Entra Object ID → founder display name for authenticated identity resolution. */
  private readonly entraIdLookup: Map<string, string>;

  constructor(config: BotConfig, agentRunner: AgentRunner, agentBots?: AgentBotConfig[]) {
    this.config = config;
    this.agentRunner = agentRunner;

    // Build agent bot map
    this.agentBots = new Map();
    const additionalAudiences: string[] = [];
    for (const ab of agentBots ?? []) {
      this.agentBots.set(ab.appId, ab);
      additionalAudiences.push(ab.appId);
    }

    this.tokenValidator = new BotTokenValidator(config.appId, config.tenantId, additionalAudiences);
    this.entraIdLookup = buildEntraIdLookup();
  }

  static fromEnv(agentRunner: AgentRunner): TeamsBotHandler | null {
    const appId = process.env.BOT_APP_ID;
    const appSecret = process.env.BOT_APP_SECRET;
    const tenantId = process.env.BOT_TENANT_ID ?? process.env.AZURE_TENANT_ID;

    if (!appId || !appSecret || !tenantId) return null;

    // Parse individual agent bot configs from AGENT_BOTS env var (JSON array)
    let agentBots: AgentBotConfig[] = [];
    if (process.env.AGENT_BOTS) {
      try {
        agentBots = JSON.parse(process.env.AGENT_BOTS) as AgentBotConfig[];
        console.log(`[TeamsBot] Loaded ${agentBots.length} individual agent bots`);
      } catch (err) {
        console.error('[TeamsBot] Failed to parse AGENT_BOTS:', (err as Error).message);
      }
    }

    return new TeamsBotHandler({ appId, appSecret, tenantId }, agentRunner, agentBots);
  }

  /**
   * Validate an incoming Bot Framework JWT token.
   * Returns true if valid, false if invalid.
   */
  async validateToken(token: string): Promise<boolean> {
    try {
      await this.tokenValidator.validate(token);
      return true;
    } catch (err) {
      // Decode token claims for debugging (without verification)
      try {
        const [, payloadB64] = token.split('.');
        const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
        console.error(`[TeamsBot] Token validation failed: ${(err as Error).message} | aud=${claims.aud} iss=${claims.iss}`);
      } catch {
        console.error('[TeamsBot] Token validation failed:', (err as Error).message);
      }
      return false;
    }
  }

  /**
   * Download file attachments from a Teams activity.
   * Teams sends file attachments with contentType 'application/vnd.microsoft.teams.file.download.info'
   * and the actual download URL is inside content.downloadUrl.
   */
  private async downloadTeamsAttachments(
    activity: TeamsActivity,
  ): Promise<Array<{ name: string; mimeType: string; data: string }>> {
    if (!activity.attachments || activity.attachments.length === 0) {
      return [];
    }

    const results: Array<{ name: string; mimeType: string; data: string }> = [];

    for (const att of activity.attachments) {
      // Teams file downloads have this specific content type
      if (att.contentType !== 'application/vnd.microsoft.teams.file.download.info') {
        continue;
      }

      const downloadUrl = (att.content as { downloadUrl?: string })?.downloadUrl;
      if (!downloadUrl) {
        console.warn('[TeamsBot] File attachment missing downloadUrl:', att.name);
        continue;
      }

      // Validate the download URL is from a trusted Microsoft domain
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(downloadUrl);
      } catch {
        console.warn('[TeamsBot] Invalid download URL for attachment:', att.name);
        continue;
      }
      const trustedDomains = ['.sharepoint.com', '.microsoft.com', '.office.com', '.office365.com'];
      if (!trustedDomains.some((d) => parsedUrl.hostname.endsWith(d))) {
        console.warn('[TeamsBot] Untrusted download domain:', parsedUrl.hostname);
        continue;
      }

      try {
        const token = await this.getBotToken();
        const res = await fetch(downloadUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          console.warn(`[TeamsBot] Failed to download attachment ${att.name}: ${res.status}`);
          continue;
        }

        const buffer = Buffer.from(await res.arrayBuffer());
        const base64 = buffer.toString('base64');
        const mimeType = att.contentType === 'application/vnd.microsoft.teams.file.download.info'
          ? this.inferMimeType(att.name ?? 'unknown')
          : att.contentType;

        results.push({
          name: att.name ?? 'unknown',
          mimeType,
          data: base64,
        });

        console.log(`[TeamsBot] Downloaded attachment: ${att.name} (${mimeType}, ${buffer.length} bytes)`);
      } catch (err) {
        console.warn(`[TeamsBot] Error downloading attachment ${att.name}:`, err);
      }
    }

    return results;
  }

  private inferMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      doc: 'application/msword',
      xls: 'application/vnd.ms-excel',
      ppt: 'application/vnd.ms-powerpoint',
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      txt: 'text/plain',
      csv: 'text/csv',
      json: 'application/json',
    };
    return mimeMap[ext ?? ''] ?? 'application/octet-stream';
  }

  /**
   * Acquire a Bot Framework token for replying to messages.
   * If botAppId is provided, uses that bot's credentials; otherwise uses the main bot.
   */
  private async getBotToken(botAppId?: string): Promise<string> {
    const now = Date.now();

    // Determine which credentials and cache to use
    const useAgent = botAppId && this.agentBots.has(botAppId);
    let clientId: string;
    let clientSecret: string;
    let cache: { token: string; expiresAt: number } | null;

    if (useAgent) {
      const agentBot = this.agentBots.get(botAppId)!;
      clientId = agentBot.appId;
      clientSecret = agentBot.appSecret;
      cache = this.agentTokenCache.get(botAppId) ?? null;
    } else {
      clientId = this.config.appId;
      clientSecret = this.config.appSecret;
      cache = this.tokenCache;
    }

    if (cache && cache.expiresAt > now + 60_000) {
      return cache.token;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
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
      const errBody = await res.text().catch(() => '');
      throw new Error(`Failed to get bot token for ${clientId}: ${res.status} ${errBody}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    const newCache = {
      token: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };

    if (useAgent) {
      this.agentTokenCache.set(botAppId!, newCache);
    } else {
      this.tokenCache = newCache;
    }

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
    botAppId?: string,
  ): Promise<void> {
    const token = await this.getBotToken(botAppId);
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
    botAppId?: string,
  ): Promise<void> {
    const token = await this.getBotToken(botAppId);
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
   * Ensure the Glyphor AI Teams app is installed for a user so we get a conversationUpdate
   * with a usable conversation reference. Uses Microsoft Graph API.
   */
  private async ensureTeamsAppInstalled(userAadObjectId: string): Promise<void> {
    const teamsAppExternalId = process.env.TEAMS_APP_ID ?? '0d2c6770-cd9e-4f78-a78d-46725494e391';
    try {
      const graphToken = await this.getGraphToken();

      // Look up the internal Teams app ID from the catalog
      const catalogRes = await fetch(
        `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps?$filter=externalId eq '${encodeURIComponent(teamsAppExternalId)}'`,
        { headers: { Authorization: `Bearer ${graphToken}` } },
      );
      if (!catalogRes.ok) {
        console.warn(`[TeamsBot] Graph catalog lookup failed (${catalogRes.status})`);
        return;
      }
      const catalogData = (await catalogRes.json()) as { value: Array<{ id: string }> };
      const internalAppId = catalogData.value?.[0]?.id;
      if (!internalAppId) {
        console.warn(`[TeamsBot] Teams app not found in catalog (externalId=${teamsAppExternalId})`);
        return;
      }

      // Check if already installed
      const checkRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userAadObjectId)}/teamwork/installedApps?$expand=teamsApp&$filter=teamsApp/id eq '${encodeURIComponent(internalAppId)}'`,
        { headers: { Authorization: `Bearer ${graphToken}` } },
      );
      if (checkRes.ok) {
        const checkData = (await checkRes.json()) as { value: unknown[] };
        if (checkData.value?.length > 0) {
          // Already installed — conversationUpdate may have been missed; give it a moment
          await new Promise((r) => setTimeout(r, 1000));
          return;
        }
      }

      // Install the app for the user
      const installRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userAadObjectId)}/teamwork/installedApps`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${graphToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            'teamsApp@odata.bind': `https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/${encodeURIComponent(internalAppId)}`,
          }),
        },
      );
      if (!installRes.ok) {
        const errText = await installRes.text();
        console.warn(`[TeamsBot] Graph app install failed (${installRes.status}): ${errText}`);
        return;
      }
      console.log(`[TeamsBot] Installed Teams app for user ${userAadObjectId}, waiting for conversationUpdate…`);

      // Wait for the conversationUpdate webhook to fire and store the reference
      await new Promise((r) => setTimeout(r, 3000));
    } catch (err) {
      console.warn(`[TeamsBot] ensureTeamsAppInstalled error:`, (err as Error).message);
    }
  }

  /**
   * Acquire a Microsoft Graph token using the bot's own Entra credentials.
   */
  private async getGraphToken(): Promise<string> {
    const now = Date.now();
    if (this._graphTokenCache && this._graphTokenCache.expiresAt > now + 60_000) {
      return this._graphTokenCache.token;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      scope: 'https://graph.microsoft.com/.default',
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
      const errBody = await res.text().catch(() => '');
      throw new Error(`Failed to get Graph token: ${res.status} ${errBody}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this._graphTokenCache = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
    return data.access_token;
  }

  /**
   * Send a proactive 1:1 DM to a user via Bot Framework REST API.
   *
   * Creates a personal conversation with the user and sends a message.
   * The bot must be installed in the user's personal scope for this to work.
   *
   * @param userAadObjectId - The user's Entra ID (AAD Object ID)
   * @param message - The message text (plain text or markdown)
   * @param serviceUrl - Bot Framework service URL (default: North America)
   */
  async sendProactiveToUser(
    userAadObjectId: string,
    message: string,
    serviceUrl = 'https://smba.trafficmanager.net/amer/',
  ): Promise<void> {
    const token = await this.getBotToken();

    // Check for a stored conversation reference (from a previous interaction).
    let ref = getConversationRef(userAadObjectId);
    if (!ref) {
      // Try proactive app installation via Graph API to trigger conversationUpdate
      await this.ensureTeamsAppInstalled(userAadObjectId);
      ref = getConversationRef(userAadObjectId);
    }

    if (ref) {
      const url = `${ref.serviceUrl}v3/conversations/${encodeURIComponent(ref.conversationId)}/activities`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'message', text: message, textFormat: 'markdown' }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`[TeamsBot] Proactive DM failed (${res.status}): ${errText}`);
      }
      return;
    }

    // No stored reference — fall back to creating a new conversation.
    // This only works for single-tenant bots or users where the bot is installed.
    const appId = this.config.appId;
    const createUrl = `${serviceUrl}v3/conversations`;
    const createBody = {
      bot: { id: `28:${appId}`, name: 'Glyphor Bot' },
      members: [{ id: `29:${userAadObjectId}` }],
      tenantId: this.config.tenantId,
      activity: {
        type: 'message',
        text: message,
        textFormat: 'markdown',
      },
    };

    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`[TeamsBot] Proactive DM failed (${createRes.status}): ${errText}`);
    }
  }

  /**
   * Send a proactive Adaptive Card as a 1:1 DM to a user.
   *
   * @param userAadObjectId - The user's Entra ID (AAD Object ID)
   * @param cardContent - The Adaptive Card JSON object
   * @param serviceUrl - Bot Framework service URL (default: North America)
   */
  async sendProactiveCardToUser(
    userAadObjectId: string,
    cardContent: Record<string, unknown>,
    serviceUrl = 'https://smba.trafficmanager.net/amer/',
  ): Promise<void> {
    const token = await this.getBotToken();

    // Check for a stored conversation reference first
    let ref = getConversationRef(userAadObjectId);
    if (!ref) {
      await this.ensureTeamsAppInstalled(userAadObjectId);
      ref = getConversationRef(userAadObjectId);
    }

    if (ref) {
      const url = `${ref.serviceUrl}v3/conversations/${encodeURIComponent(ref.conversationId)}/activities`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'message',
          attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: cardContent }],
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`[TeamsBot] Proactive card DM failed (${res.status}): ${errText}`);
      }
      return;
    }

    // Fall back to creating a new conversation
    const appId = this.config.appId;
    const createUrl = `${serviceUrl}v3/conversations`;
    const createBody = {
      bot: { id: `28:${appId}`, name: 'Glyphor Bot' },
      members: [{ id: `29:${userAadObjectId}` }],
      tenantId: this.config.tenantId,
      activity: {
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: cardContent,
          },
        ],
      },
    };

    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`[TeamsBot] Proactive card DM failed (${createRes.status}): ${errText}`);
    }
  }

  /**
   * Send a proactive message to a Teams channel without being @mentioned.
   *
   * Uses the Bot Framework REST API to create/resume a conversation in a channel.
   * The bot must be installed in the team for this to work.
   *
   * @param teamId - The Teams team ID (TEAMS_TEAM_ID env var)
   * @param channelId - The Teams channel ID (e.g. TEAMS_CHANNEL_ENGINEERING_ID)
   * @param message - The message text (plain text or markdown)
   * @param serviceUrl - Bot Framework service URL (default: North America)
   */
  async sendProactiveToChannel(
    teamId: string,
    channelId: string,
    message: string,
    serviceUrl = 'https://smba.trafficmanager.net/amer/',
  ): Promise<void> {
    const token = await this.getBotToken();
    const appId = this.config.appId;

    // Create a new conversation in the channel
    const createUrl = `${serviceUrl}v3/conversations`;
    const createBody = {
      bot: { id: `28:${appId}`, name: 'Glyphor Bot' },
      isGroup: true,
      tenantId: this.config.tenantId,
      channelData: {
        channel: { id: channelId },
        team: { id: teamId },
      },
      activity: {
        type: 'message',
        text: message,
      },
    };

    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`[TeamsBot] Proactive channel post failed (${createRes.status}): ${errText}`);
    }
  }

  /**
   * Send a proactive Adaptive Card to a Teams channel.
   *
   * Uses the Bot Framework REST API to post a card (decision, briefing, alert)
   * to a channel without requiring an incoming message context.
   *
   * @param teamId - The Teams team ID (TEAMS_TEAM_ID env var)
   * @param channelId - The Teams channel ID
   * @param cardContent - The Adaptive Card JSON object (the `content` field, not the full attachment wrapper)
   * @param serviceUrl - Bot Framework service URL (default: North America)
   */
  async sendProactiveCardToChannel(
    teamId: string,
    channelId: string,
    cardContent: Record<string, unknown>,
    serviceUrl = 'https://smba.trafficmanager.net/amer/',
  ): Promise<void> {
    const token = await this.getBotToken();
    const appId = this.config.appId;

    const createUrl = `${serviceUrl}v3/conversations`;
    const createBody = {
      bot: { id: `28:${appId}`, name: 'Glyphor Bot' },
      isGroup: true,
      tenantId: this.config.tenantId,
      channelData: {
        channel: { id: channelId },
        team: { id: teamId },
      },
      activity: {
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: cardContent,
          },
        ],
      },
    };

    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`[TeamsBot] Proactive card post failed (${createRes.status}): ${errText}`);
    }
  }

  /**
   * Send a proactive 1:1 DM as a specific agent bot (by role).
   * Uses the agent bot's own credentials so the message appears from that agent.
   */
  async sendProactiveAsAgent(
    agentRole: string,
    userAadObjectId: string,
    message: string,
    serviceUrl = 'https://smba.trafficmanager.net/amer/',
  ): Promise<void> {
    // Find the agent bot by role
    let agentBot: (AgentBotConfig & { appSecret: string }) | undefined;
    for (const ab of this.agentBots.values()) {
      if (ab.role === agentRole) {
        agentBot = ab;
        break;
      }
    }
    if (!agentBot) {
      throw new Error(`[TeamsBot] No agent bot registered for role: ${agentRole}`);
    }

    const token = await this.getBotToken(agentBot.appId);

    const createUrl = `${serviceUrl}v3/conversations`;
    const createBody = {
      bot: { id: `28:${agentBot.appId}`, name: agentBot.name },
      members: [{ id: `29:${userAadObjectId}` }],
      tenantId: this.config.tenantId,
      activity: {
        type: 'message',
        text: message,
        textFormat: 'markdown',
      },
    };

    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(createBody),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`[TeamsBot] Proactive DM as ${agentRole} failed (${createRes.status}): ${errText}`);
    }
  }

  /**
   * Handle an incoming Bot Framework activity.
   * If the recipient is an individual agent bot, route directly to that agent.
   * Otherwise, use command parsing (ask, briefing, status, etc.).
   */
  async handleActivity(activity: TeamsActivity): Promise<void> {
    if (activity.type === 'conversationUpdate') {
      // Store conversation reference for any added members.
      // This fires when the Teams app is installed for a user.
      const membersAdded = (activity as unknown as Record<string, unknown>).membersAdded as
        Array<{ id: string; aadObjectId?: string }> | undefined;
      if (membersAdded) {
        for (const member of membersAdded) {
          if (member.aadObjectId && member.id !== activity.recipient?.id) {
            setConversationRef(member.aadObjectId, {
              serviceUrl: activity.serviceUrl,
              conversationId: activity.conversation.id,
              userId: member.id,
              botId: activity.recipient?.id ?? '',
            });
            console.log(`[TeamsBot] Stored ref from conversationUpdate for ${member.aadObjectId}`);
          }
        }
      }
      // Also capture from the activity sender if available
      if (activity.from?.aadObjectId && activity.conversation?.id) {
        setConversationRef(activity.from.aadObjectId, {
          serviceUrl: activity.serviceUrl,
          conversationId: activity.conversation.id,
          userId: activity.from.id,
          botId: activity.recipient?.id ?? '',
        });
      }
      console.log('[TeamsBot] Conversation update');
      return;
    }

    if (activity.type !== 'message') {
      console.log(`[TeamsBot] Ignoring activity type: ${activity.type}`);
      return;
    }

    // Store conversation reference for proactive messaging later.
    // This captures the correct pairwise user ID and service URL.
    if (activity.from?.aadObjectId && activity.conversation?.id) {
      setConversationRef(activity.from.aadObjectId, {
        serviceUrl: activity.serviceUrl,
        conversationId: activity.conversation.id,
        userId: activity.from.id,
        botId: activity.recipient?.id ?? '',
      });
    }

    // Check if this message was sent to an individual agent bot.
    // Teams uses '28:<appId>' format for recipient.id, so strip the prefix.
    const recipientId = activity.recipient?.id;
    let agentBot = recipientId ? this.agentBots.get(recipientId) : undefined;
    if (!agentBot && recipientId?.includes(':')) {
      const rawId = recipientId.split(':').pop()!;
      agentBot = this.agentBots.get(rawId);
    }

    let agentRole: string;
    let message: string;
    let botAppId: string | undefined;

    if (agentBot) {
      // Individual agent bot — route directly, no command parsing needed
      agentRole = agentBot.role;
      message = activity.text?.trim() || 'Hello!';
      botAppId = agentBot.appId;
      console.log(`[TeamsBot] ${activity.from.name} → ${agentBot.name} (${agentRole}): "${message}"`);
    } else {
      // Main Glyphor AI bot — use command parsing
      const parsed = parseMessage(activity, 'Glyphor AI');
      agentRole = parsed.agentRole;
      message = parsed.message;
      console.log(`[TeamsBot] ${activity.from.name}: "${parsed.command}" → ${agentRole}: "${message}"`);

      // Handle agent listing command
      if (parsed.command === 'agents') {
        const agentList = Object.entries(AGENT_DISPLAY)
          .map(([role, name]) => `• **${name}** (\`${role}\`)`)
          .join('\n');
        const responseText = `## Glyphor AI Agents\n\n${agentList}\n\n_Use \`ask [name] [question]\` to chat with any agent._`;
        await this.replyToActivity(activity.serviceUrl, activity.conversation.id, activity.id, {
          type: 'message',
          text: responseText,
          textFormat: 'markdown',
        }, botAppId);
        return;
      }
    }

    // Send typing indicator
    await this.sendTyping(activity.serviceUrl, activity.conversation.id, botAppId);

    // Resolve sender identity from Entra-authenticated aadObjectId, fall back to display name
    const senderName = (activity.from?.aadObjectId && this.entraIdLookup.get(activity.from.aadObjectId))
      || activity.from?.name;
    const contextualMessage = senderName
      ? `[Message from ${senderName}]: ${message}`
      : message;

    // Download file attachments from Teams (if any)
    const fileAttachments = await this.downloadTeamsAttachments(activity);

    try {
      const result = await this.agentRunner(agentRole, 'on_demand', {
        message: contextualMessage,
        ...(fileAttachments.length > 0 ? { attachments: fileAttachments } : {}),
      });
      const displayName = AGENT_DISPLAY[agentRole] ?? agentRole;

      if (result?.output) {
        const clean = result.output.replace(/<reasoning>[\s\S]*?<\/reasoning>\s*/g, '').trim();
        const formatted = formatTeamsMessage(displayName, clean);

        if (formatted.kind === 'card' && formatted.card) {
          await this.replyToActivity(activity.serviceUrl, activity.conversation.id, activity.id, {
            type: 'message',
            attachments: [{
              contentType: 'application/vnd.microsoft.card.adaptive',
              content: formatted.card,
            }],
          }, botAppId);
        } else {
          await this.replyToActivity(activity.serviceUrl, activity.conversation.id, activity.id, {
            type: 'message',
            text: formatted.text ?? `**${displayName}:**\n\n${clean}`,
            textFormat: 'markdown',
          }, botAppId);
        }
      } else if (result?.error) {
        await this.replyToActivity(activity.serviceUrl, activity.conversation.id, activity.id, {
          type: 'message',
          text: `**${displayName}** encountered an error: ${result.error}`,
          textFormat: 'markdown',
        }, botAppId);
      } else {
        await this.replyToActivity(activity.serviceUrl, activity.conversation.id, activity.id, {
          type: 'message',
          text: `**${displayName}** completed the task but had nothing to report.`,
          textFormat: 'markdown',
        }, botAppId);
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      const displayName = AGENT_DISPLAY[agentRole] ?? agentRole;
      await this.replyToActivity(activity.serviceUrl, activity.conversation.id, activity.id, {
        type: 'message',
        text: `Sorry, I couldn't reach **${displayName}**: ${errMessage}`,
        textFormat: 'markdown',
      }, botAppId);
    }
  }
}
