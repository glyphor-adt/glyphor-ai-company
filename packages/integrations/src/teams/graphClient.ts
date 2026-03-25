/**
 * Microsoft Graph API Teams Client
 *
 * Sends messages to Teams channels. Primary method is delegated auth
 * (ChannelMessage.Send) via a cached refresh token. Falls back to
 * app-only auth for read operations.
 *
 * Posting flow:
 *   0. Agent identity (A365 Graph token — posts as the agent)
 *   1. Webhook (posts as bot)
 *   2. Delegated Graph API (refresh token → ChannelMessage.Send — posts as token owner)
 *   3. App-only Graph API (fallback — only works for reads)
 *
 * Required environment variables:
 *   - AZURE_TENANT_ID: Microsoft Entra (Azure AD) tenant ID
 *   - AZURE_CLIENT_ID: Entra app client ID
 *   - GRAPH_DELEGATED_REFRESH_TOKEN: Offline refresh token for delegated posting
 *   - TEAMS_TEAM_ID: Microsoft Teams team ID
 *   - TEAMS_CHANNEL_*_ID: Channel IDs (see buildChannelMap())
 */

import { ConfidentialClientApplication } from '@azure/msal-node';
import type { AdaptiveCard, TeamsWebhookPayload } from './webhooks.js';
import { sendTeamsWebhook } from './webhooks.js';
import { markdownToTeamsHtml } from './messageFormatter.js';
import { getAgenticGraphToken } from '../agent365/index.js';
import type { GraphChannelMention } from './founderMentions.js';

/** Optional HTML footer + Graph mentions for channel posts (see founderMentions.ts). */
export interface TeamsChannelTextOptions {
  appendHtml?: string;
  mentions?: GraphChannelMention[];
}

function buildGraphChannelMessageBody(
  markdown: string,
  rich?: TeamsChannelTextOptions,
): Record<string, unknown> {
  let html = markdownToTeamsHtml(markdown);
  if (rich?.appendHtml) {
    html += rich.appendHtml;
  }
  const body: Record<string, unknown> = {
    body: { contentType: 'html', content: html },
  };
  if (rich?.mentions?.length) {
    body.mentions = rich.mentions;
  }
  return body;
}

/** Plain footer for webhook Adaptive Cards (Graph @mentions are not supported there). */
function plainFounderFooterFromRich(rich?: TeamsChannelTextOptions): string {
  if (!rich?.mentions?.length) return '';
  const names = rich.mentions.map((m) => m.mentioned.user.displayName).join(' & ');
  return `\n\n${names} — review requested.`;
}

// ─── DELEGATED AUTH (refresh token) ─────────────────────────────

let _delegatedTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Acquire a delegated Graph access token using the stored refresh token.
 * ChannelMessage.Send is delegated-only — this is how we post to channels.
 */
async function getDelegatedGraphToken(): Promise<string | null> {
  const now = Date.now();
  if (_delegatedTokenCache && _delegatedTokenCache.expiresAt > now + 60_000) {
    return _delegatedTokenCache.token;
  }

  const tenantId = process.env.AZURE_TENANT_ID?.trim();
  const clientId = process.env.AZURE_CLIENT_ID?.trim();
  const refreshToken = process.env.GRAPH_DELEGATED_REFRESH_TOKEN?.trim();
  if (!tenantId || !clientId || !refreshToken) return null;

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      scope: 'https://graph.microsoft.com/ChannelMessage.Send offline_access',
    });

    const res = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() },
    );
    if (!res.ok) {
      const text = await res.text();
      console.error(`[GraphClient] Delegated token refresh failed (${res.status}): ${text.substring(0, 200)}`);
      return null;
    }

    const data = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
    _delegatedTokenCache = {
      token: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };
    return data.access_token;
  } catch (err) {
    console.error('[GraphClient] Delegated token refresh error:', err);
    return null;
  }
}

/**
 * Post a channel message using the delegated Graph token.
 * Returns true on success, false if unavailable or failed.
 */
async function postWithDelegatedToken(
  target: ChannelTarget,
  body: Record<string, unknown>,
): Promise<boolean> {
  const token = await getDelegatedGraphToken();
  if (!token) return false;

  const url = `https://graph.microsoft.com/v1.0/teams/${target.teamId}/channels/${target.channelId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[GraphClient] Delegated post failed (${res.status}): ${text.substring(0, 300)}`);
    return false;
  }
  return true;
}

// ─── POWER PLATFORM AUTH (for direct-API webhook URLs) ────────

let _powerPlatformTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Power Platform direct API webhook URLs require a bearer token.
 * Uses client_credentials via v1.0 token endpoint with resource parameter.
 * The v2.0 endpoint with scope/.default returns tokens that don't match
 * the flow's OAuth access control policy (MisMatchingOAuthClaims).
 * The Teams message posts as the Power Automate flow bot, not any user.
 */
async function getPowerPlatformToken(): Promise<string | null> {
  const now = Date.now();
  if (_powerPlatformTokenCache && _powerPlatformTokenCache.expiresAt > now + 60_000) {
    return _powerPlatformTokenCache.token;
  }

  const tenantId = process.env.AZURE_TENANT_ID?.trim();
  const clientId = process.env.AZURE_CLIENT_ID?.trim();
  const clientSecret = process.env.AZURE_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) {
    console.warn('[GraphClient] Missing AZURE_CLIENT_SECRET — cannot get Power Platform token');
    return null;
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      resource: 'https://service.flow.microsoft.com/',
    });

    const res = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/token`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() },
    );
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[GraphClient] Power Platform token failed (${res.status}): ${text.substring(0, 200)}`);
      return null;
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    _powerPlatformTokenCache = {
      token: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };
    console.log('[GraphClient] Power Platform token acquired');
    return data.access_token;
  } catch (err) {
    console.warn('[GraphClient] Power Platform token error:', err);
    return null;
  }
}

/** Returns true if the webhook URL is a Power Platform direct API that requires auth */
function isPowerPlatformDirectUrl(url: string): boolean {
  return url.includes('.api.powerplatform.com') || url.includes('/powerautomate/automations/direct/');
}

// ─── CONFIG ─────────────────────────────────────────────────────

export interface GraphTeamsConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface ChannelTarget {
  teamId: string;
  channelId: string;
}

// ─── CLIENT ─────────────────────────────────────────────────────

export class GraphTeamsClient {
  private readonly msalApp: ConfidentialClientApplication;
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(private readonly config: GraphTeamsConfig) {
    this.msalApp = new ConfidentialClientApplication({
      auth: {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
      },
    });
  }

  /**
   * Create a GraphTeamsClient from environment variables.
   *
   * Prefers the dedicated Teams-channel app registration
   * (AZURE_TEAMS_CHANNEL_CLIENT_ID / _CLIENT_SECRET) which has
   * ChannelMessage.Send permission. Falls back to the shared
   * AZURE_CLIENT_ID / AZURE_CLIENT_SECRET for backward compat.
   */
  static fromEnv(): GraphTeamsClient {
    const tenantId = process.env.AZURE_TENANT_ID?.trim();

    // Prefer the scoped Teams-channel app registration
    const clientId =
      process.env.AZURE_TEAMS_CHANNEL_CLIENT_ID?.trim() ||
      process.env.AZURE_CLIENT_ID?.trim();
    const clientSecret =
      process.env.AZURE_TEAMS_CHANNEL_CLIENT_SECRET?.trim() ||
      process.env.AZURE_CLIENT_SECRET?.trim();

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error(
        'Missing Azure credentials. Set AZURE_TENANT_ID and AZURE_TEAMS_CHANNEL_CLIENT_ID/SECRET (or AZURE_CLIENT_ID/SECRET).',
      );
    }

    return new GraphTeamsClient({ tenantId, clientId, clientSecret });
  }

  /**
   * Acquire a Graph API token using client credentials flow.
   * Public so that tool implementations can make arbitrary Graph API calls.
   */
  async getAccessToken(): Promise<string> {
    return this.getToken();
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60_000) {
      return this.cachedToken.token;
    }

    const result = await this.msalApp.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    });

    if (!result?.accessToken) {
      throw new Error('Failed to acquire Graph API token');
    }

    this.cachedToken = {
      token: result.accessToken,
      expiresAt: result.expiresOn?.getTime() ?? now + 3600_000,
    };

    return result.accessToken;
  }

  /**
   * Send an Adaptive Card to a Teams channel.
   */
  async sendCard(target: ChannelTarget, card: AdaptiveCard): Promise<void> {
    if (!target.teamId || !target.channelId) {
      throw new Error(
        `Invalid Teams channel target: teamId=${target.teamId}, channelId=${target.channelId}. ` +
        `Check TEAMS_TEAM_ID and TEAMS_CHANNEL_*_ID environment variables.`
      );
    }

    const token = await this.getToken();
    const url = `https://graph.microsoft.com/v1.0/teams/${target.teamId}/channels/${target.channelId}/messages`;

    const body = {
      body: {
        contentType: 'html',
        content: '<attachment id="adaptiveCard"></attachment>',
      },
      attachments: [
        {
          id: 'adaptiveCard',
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: JSON.stringify(card),
        },
      ],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Graph API sendCard failed (${response.status}): ${response.statusText} - ${text}. ` +
        `URL: ${url.substring(0, 100)}...`
      );
    }
  }

  /**
   * Send a message to a Teams channel. Markdown is converted to HTML for proper rendering.
   */
  async sendText(target: ChannelTarget, content: string): Promise<void> {
    if (!target.teamId || !target.channelId) {
      throw new Error(
        `Invalid Teams channel target: teamId=${target.teamId}, channelId=${target.channelId}. ` +
        `Check TEAMS_TEAM_ID and TEAMS_CHANNEL_*_ID environment variables.`
      );
    }

    const token = await this.getToken();
    const url = `https://graph.microsoft.com/v1.0/teams/${target.teamId}/channels/${target.channelId}/messages`;

    const body = {
      body: { contentType: 'html', content: markdownToTeamsHtml(content) },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Graph API sendText failed (${response.status}): ${response.statusText} - ${text}. ` +
        `URL: ${url.substring(0, 100)}...`
      );
    }
  }

  /**
   * List channels in a team (useful for discovery/configuration).
   */
  async listChannels(teamId: string): Promise<Array<{ id: string; displayName: string }>> {
    const token = await this.getToken();
    const url = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels?$select=id,displayName`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Graph API list channels failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { value: Array<{ id: string; displayName: string }> };
    return data.value;
  }
}

// ─── CHANNEL MAP ────────────────────────────────────────────────

/**
 * Known Glyphor Teams channels. Configure via env vars:
 *   TEAMS_TEAM_ID — the Team ID in Microsoft Teams
 *   TEAMS_CHANNEL_<NAME>_ID — channel IDs within that team
 *
 * Example channel environment variables:
 *   - TEAMS_CHANNEL_GENERAL_ID
 *   - TEAMS_CHANNEL_ENGINEERING_ID
 *   - TEAMS_CHANNEL_BRIEFINGS_ID
 *   - TEAMS_CHANNEL_DECISIONS_ID
 *   - TEAMS_CHANNEL_ALERTS_ID
 *   - TEAMS_CHANNEL_DELIVERABLES_ID
 *   - TEAMS_CHANNEL_GROWTH_ID
 *   - TEAMS_CHANNEL_FINANCIALS_ID
 */
export interface ChannelMap {
  briefings: ChannelTarget;
  decisions: ChannelTarget;
  alerts: ChannelTarget;
  deliverables: ChannelTarget;
  general: ChannelTarget;
  engineering: ChannelTarget;
  growth: ChannelTarget;
  financials: ChannelTarget;
}

/**
 * Build channel map from environment variables.
 * Falls back gracefully — missing channels are omitted.
 */
export function buildChannelMap(): Partial<ChannelMap> {
  const teamId = process.env.TEAMS_TEAM_ID?.trim();
  if (!teamId) return {};

  const channelEnvMap: Record<keyof ChannelMap, string[]> = {
    briefings: ['TEAMS_CHANNEL_BRIEFINGS_ID'],
    decisions: ['TEAMS_CHANNEL_DECISIONS_ID'],
    alerts: ['TEAMS_CHANNEL_ALERTS_ID'],
    deliverables: ['TEAMS_CHANNEL_DELIVERABLES_ID'],
    general: ['TEAMS_CHANNEL_GENERAL_ID'],
    engineering: ['TEAMS_CHANNEL_ENGINEERING_ID'],
    growth: ['TEAMS_CHANNEL_GROWTH_ID'],
    financials: ['TEAMS_CHANNEL_FINANCIALS_ID'],
  };

  const map: Partial<ChannelMap> = {};
  for (const [key, envVars] of Object.entries(channelEnvMap)) {
    const channelId = envVars
      .map((envVar) => process.env[envVar]?.trim())
      .find((value): value is string => Boolean(value));
    if (channelId) {
      map[key as keyof ChannelMap] = { teamId, channelId };
    }
  }

  return map;
}

// ─── CHANNEL POSTING ────────────────────────────────────────────

/**
 * Channel posting uses delegated auth (ChannelMessage.Send) via a cached
 * refresh token. ChannelMessage.Send is delegated-only — app-only Graph
 * cannot post to channels (returns 401). The refresh token is obtained
 * once via device-code flow and stored in GRAPH_DELEGATED_REFRESH_TOKEN.
 */
const CHANNEL_WEBHOOK_ENV: Record<string, string> = {
  decisions: 'TEAMS_WEBHOOK_DECISIONS',
  general: 'TEAMS_WEBHOOK_GENERAL',
  engineering: 'TEAMS_WEBHOOK_ENGINEERING',
  briefings: 'TEAMS_WEBHOOK_BRIEFINGS',
  growth: 'TEAMS_WEBHOOK_GROWTH',
  financials: 'TEAMS_WEBHOOK_FINANCIALS',
  alerts: 'TEAMS_WEBHOOK_ALERTS',
  deliverables: 'TEAMS_WEBHOOK_DELIVERABLES',
};

function getChannelWebhookUrl(channelName: string): string | undefined {
  const envVar = CHANNEL_WEBHOOK_ENV[channelName];
  return envVar ? process.env[envVar]?.trim() || undefined : undefined;
}

// ─── SEND HELPERS ───────────────────────────────────────────────

export type PostResult = { method: 'webhook' | 'graph' | 'agent' | 'none'; error?: string };

/**
 * Post a raw Graph message body to a channel using the agent's own A365 Graph token.
 * Returns true if the agent has an identity and the post succeeded.
 */
async function postAsAgentIdentity(
  target: ChannelTarget,
  body: Record<string, unknown>,
  agentRole: string,
): Promise<boolean> {
  try {
    const token = await getAgenticGraphToken(agentRole);
    if (!token) return false;

    const url = `https://graph.microsoft.com/v1.0/teams/${target.teamId}/channels/${target.channelId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`[GraphClient] Agent identity post failed for ${agentRole} (${res.status}): ${text.substring(0, 200)}`);
      return false;
    }
    console.log(`[GraphClient] ${agentRole} posted to channel as own identity`);
    return true;
  } catch (err) {
    console.warn(`[GraphClient] Agent identity post error for ${agentRole}:`, (err as Error).message);
    return false;
  }
}

/**
 * Post an Adaptive Card to a Teams channel.
 *
 * Tries webhook first (posts as bot), then delegated Graph API as fallback.
 * Accepts either a TeamsWebhookPayload or a raw AdaptiveCard.
 */
export async function postCardToChannel(
  channelName: string,
  payload: TeamsWebhookPayload | AdaptiveCard,
  graphClient?: GraphTeamsClient | null,
  agentRole?: string,
): Promise<PostResult> {
  // Normalise: if we got a raw AdaptiveCard, wrap it
  const webhookPayload: TeamsWebhookPayload = 'type' in payload && payload.type === 'message'
    ? payload as TeamsWebhookPayload
    : {
        type: 'message',
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: payload as AdaptiveCard,
        }],
      };

  const card = webhookPayload.attachments[0].content;
  const channels = buildChannelMap();
  const target = channels[channelName as keyof ChannelMap];
  const webhookUrl = getChannelWebhookUrl(channelName);
  const delegatedAgentPostsExplicitlyEnabled = process.env.TEAMS_ALLOW_DELEGATED_FOR_AGENT_POSTS === 'true';
  // Keep attribution clean: for agent-role posts, delegated fallback must be explicit opt-in.
  const skipDelegatedFallback = Boolean(agentRole) && !delegatedAgentPostsExplicitlyEnabled;

  // 0. Agent identity (posts as the agent, not a human or bot)
  if (agentRole && target) {
    const graphBody = {
      body: { contentType: 'html', content: '<attachment id="adaptiveCard"></attachment>' },
      attachments: [{ id: 'adaptiveCard', contentType: 'application/vnd.microsoft.card.adaptive', content: JSON.stringify(card) }],
    };
    const ok = await postAsAgentIdentity(target, graphBody, agentRole);
    if (ok) return { method: 'agent' };
  }

  // 1. Webhook (posts as bot, not as a user)
  if (webhookUrl) {
    try {
      // Power Platform direct API URLs require a bearer token
      let authToken: string | undefined;
      if (isPowerPlatformDirectUrl(webhookUrl)) {
        authToken = (await getPowerPlatformToken()) ?? undefined;
        if (!authToken) {
          console.warn(`[GraphClient] No Power Platform token for ${channelName} webhook — trying unauthenticated`);
        }
      }
      await sendTeamsWebhook(webhookUrl, webhookPayload, authToken);
      return { method: 'webhook' };
    } catch (err) {
      console.warn(`[GraphClient] Webhook failed for ${channelName}:`, (err as Error).message);
    }
  }

  // 2. Delegated Graph API (ChannelMessage.Send via refresh token — posts as token owner)
  if (target && !skipDelegatedFallback) {
    const graphBody = {
      body: { contentType: 'html', content: '<attachment id="adaptiveCard"></attachment>' },
      attachments: [{ id: 'adaptiveCard', contentType: 'application/vnd.microsoft.card.adaptive', content: JSON.stringify(card) }],
    };
    const ok = await postWithDelegatedToken(target, graphBody);
    if (ok) return { method: 'graph' };
  }

  // 3. App-only Graph API (will likely 401 for posting, but try anyway)
  if (graphClient && target) {
    try {
      await graphClient.sendCard(target, card);
      return { method: 'graph' };
    } catch { /* fall through */ }
  }

  return { method: 'none', error: `No webhook, delegated token, or Graph channel configured for "${channelName}"` };
}

/**
 * Post a plain-text message to a Teams channel.
 *
 * Tries agent identity (A365), then webhook (bot), then delegated Graph (human token owner), then app-only.
 */
export async function postTextToChannel(
  channelName: string,
  text: string,
  graphClient?: GraphTeamsClient | null,
  agentRole?: string,
  rich?: TeamsChannelTextOptions,
): Promise<PostResult> {
  const channels = buildChannelMap();
  const target = channels[channelName as keyof ChannelMap];
  const webhookUrl = getChannelWebhookUrl(channelName);
  const delegatedAgentPostsExplicitlyEnabled = process.env.TEAMS_ALLOW_DELEGATED_FOR_AGENT_POSTS === 'true';
  // Keep attribution clean: for agent-role posts, delegated fallback must be explicit opt-in.
  const skipDelegatedFallback = Boolean(agentRole) && !delegatedAgentPostsExplicitlyEnabled;

  // 0. Agent identity (posts as the agent, not a human or bot)
  if (agentRole && target) {
    const graphBody = buildGraphChannelMessageBody(text, rich);
    const ok = await postAsAgentIdentity(target, graphBody, agentRole);
    if (ok) return { method: 'agent' };
  }

  // 1. Webhook (posts as bot, not as a user)
  if (webhookUrl) {
    const cardText = text + plainFounderFooterFromRich(rich);
    const payload: TeamsWebhookPayload = {
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.5',
          body: [{ type: 'TextBlock', text: cardText, wrap: true }],
        },
      }],
    };
    try {
      // Power Platform direct API URLs require a bearer token
      let authToken: string | undefined;
      if (isPowerPlatformDirectUrl(webhookUrl)) {
        authToken = (await getPowerPlatformToken()) ?? undefined;
        if (!authToken) {
          console.warn(`[GraphClient] No Power Platform token for ${channelName} webhook — trying unauthenticated`);
        }
      }
      await sendTeamsWebhook(webhookUrl, payload, authToken);
      return { method: 'webhook' };
    } catch (err) {
      console.warn(`[GraphClient] Webhook failed for ${channelName}:`, (err as Error).message);
    }
  }

  // 2. Delegated Graph API (ChannelMessage.Send via refresh token — posts as token owner)
  if (target && !skipDelegatedFallback) {
    const graphBody = buildGraphChannelMessageBody(text, rich);
    const ok = await postWithDelegatedToken(target, graphBody);
    if (ok) {
      console.warn(
        '[GraphClient] Channel message sent with GRAPH_DELEGATED_REFRESH_TOKEN — appears as that user. ' +
        'For agent attribution, fix Agent365 channel post (per-role entraUserId in agentIdentities.json) or use TEAMS_WEBHOOK_*.',
      );
      return { method: 'graph' };
    }
  }

  // 3. App-only Graph API fallback (no Graph @mentions — app token often cannot post anyway)
  if (graphClient && target) {
    try {
      const fallbackText = text + plainFounderFooterFromRich(rich);
      await graphClient.sendText(target, fallbackText);
      return { method: 'graph' };
    } catch { /* fall through */ }
  }

  return { method: 'none', error: `No webhook, delegated token, or Graph channel configured for "${channelName}"` };
}

/**
 * @deprecated Use postCardToChannel() instead — Graph API ChannelMessage.Send
 * is delegated-only, so sendToTeamsChannel (which calls graphClient.sendCard)
 * will fail with 401 in app-only contexts.
 */
export async function sendToTeamsChannel(
  client: GraphTeamsClient,
  target: ChannelTarget,
  card: AdaptiveCard,
): Promise<void> {
  await client.sendCard(target, card);
}
