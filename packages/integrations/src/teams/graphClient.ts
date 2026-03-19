/**
 * Microsoft Graph API Teams Client
 *
 * Sends messages to Teams channels using app-only authentication
 * via Entra ID client credentials flow (MSAL).
 *
 * Required environment variables:
 *   - AZURE_TENANT_ID: Microsoft Entra (Azure AD) tenant ID
 *   - AZURE_TEAMS_CHANNEL_CLIENT_ID: Dedicated Teams-channel app client ID (preferred)
 *   - AZURE_TEAMS_CHANNEL_CLIENT_SECRET: Dedicated Teams-channel app secret (preferred)
 *   - AZURE_CLIENT_ID: Shared Entra app client ID (fallback)
 *   - AZURE_CLIENT_SECRET: Shared Entra app secret (fallback)
 *   - TEAMS_TEAM_ID: Microsoft Teams team ID
 *   - TEAMS_CHANNEL_GENERAL_ID: Channel ID for #general
 *   - TEAMS_CHANNEL_ENGINEERING_ID: Channel ID for #engineering
 *   (see buildChannelMap() for full list of supported channels)
 *
 * The dedicated glyphor-teams-channels app has ChannelMessage.Send
 * permission. The shared app may not — prefer the dedicated one.
 *
 * Required Graph API permissions (Application):
 *   - ChannelMessage.Send: Required to post messages to channels
 *   - Channel.ReadBasic.All: Required to list channels
 *   - Team.ReadBasic.All: Required to access team information
 *
 * Troubleshooting:
 *   - "Invalid URL" error: Check that TEAMS_TEAM_ID and channel IDs are set
 *   - "Forbidden" error: Verify app has ChannelMessage.Send permission
 *   - "Unauthorized" error: Check AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
 *
 * Testing:
 *   Run `node test-teams.cjs` from repo root to validate configuration
 */

import { ConfidentialClientApplication } from '@azure/msal-node';
import type { AdaptiveCard, TeamsWebhookPayload } from './webhooks.js';
import { sendTeamsWebhook } from './webhooks.js';
import { markdownToTeamsHtml } from './messageFormatter.js';

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
    const url = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(target.teamId)}/channels/${encodeURIComponent(target.channelId)}/messages`;

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
    const url = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(target.teamId)}/channels/${encodeURIComponent(target.channelId)}/messages`;

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
 *   - TEAMS_CHANNEL_CEO_BRIEF_ID
 *   - TEAMS_CHANNEL_COO_BRIEF_ID
 *   - TEAMS_CHANNEL_DECISIONS_ID
 *   - TEAMS_CHANNEL_ALERTS_ID
 *   - TEAMS_CHANNEL_DELIVERABLES_ID
 *   - TEAMS_CHANNEL_GROWTH_ID
 *   - TEAMS_CHANNEL_FINANCIALS_ID
 *   - TEAMS_CHANNEL_PRODUCT_FUSE_ID
 *   - TEAMS_CHANNEL_PRODUCT_PULSE_ID
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

// ─── CHANNEL WEBHOOK MAP ────────────────────────────────────────

/**
 * Maps channel names to env vars containing their webhook URLs.
 *
 * Webhooks are the PRIMARY posting method because Microsoft Graph
 * does not support ChannelMessage.Send as an application permission —
 * it is delegated-only. App-only POST to /teams/{id}/channels/{id}/messages
 * returns 401 ("Message POST is allowed in application-only context only
 * for import purposes").
 *
 * Power Automate Workflow webhooks bypass this limitation entirely.
 */
const CHANNEL_WEBHOOK_ENV: Record<string, string> = {
  decisions: 'TEAMS_WEBHOOK_DECISIONS',
  general: 'TEAMS_WEBHOOK_GENERAL',
  engineering: 'TEAMS_WEBHOOK_ENGINEERING',
  briefings: 'TEAMS_WEBHOOK_BRIEFINGS',
  growth: 'TEAMS_WEBHOOK_GROWTH',
  financials: 'TEAMS_WEBHOOK_FINANCIALS',
  alerts: 'TEAMS_WEBHOOK_ALERTS',
  productFuse: 'TEAMS_WEBHOOK_PRODUCT_FUSE',
  productPulse: 'TEAMS_WEBHOOK_PRODUCT_PULSE',
  deliverables: 'TEAMS_WEBHOOK_DELIVERABLES',
};

function getChannelWebhookUrl(channelName: string): string | undefined {
  const envVar = CHANNEL_WEBHOOK_ENV[channelName];
  return envVar ? process.env[envVar]?.trim() || undefined : undefined;
}

// ─── SEND HELPERS ───────────────────────────────────────────────

export type PostResult = { method: 'webhook' | 'graph' | 'none'; error?: string };

/**
 * Post an Adaptive Card to a Teams channel.
 *
 * Tries webhook first (works with app-only auth), then Graph API as fallback.
 * Accepts either a TeamsWebhookPayload or a raw AdaptiveCard.
 */
export async function postCardToChannel(
  channelName: string,
  payload: TeamsWebhookPayload | AdaptiveCard,
  graphClient?: GraphTeamsClient | null,
): Promise<PostResult> {
  const webhookUrl = getChannelWebhookUrl(channelName);

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

  // Extract the raw card for Graph API path
  const card = webhookPayload.attachments[0].content;

  // 1. Webhook — works for app-only contexts
  if (webhookUrl) {
    await sendTeamsWebhook(webhookUrl, webhookPayload);
    return { method: 'webhook' };
  }

  // 2. Graph API — only works with delegated auth (not app-only)
  const channels = buildChannelMap();
  const target = channels[channelName as keyof ChannelMap];
  if (graphClient && target) {
    await graphClient.sendCard(target, card);
    return { method: 'graph' };
  }

  return { method: 'none', error: `No webhook URL (${CHANNEL_WEBHOOK_ENV[channelName] ?? 'TEAMS_WEBHOOK_???'}) or Graph channel configured for "${channelName}"` };
}

/**
 * Post a plain-text message to a Teams channel.
 *
 * Tries webhook first (wraps text in a minimal Adaptive Card), then Graph API.
 */
export async function postTextToChannel(
  channelName: string,
  text: string,
  graphClient?: GraphTeamsClient | null,
): Promise<PostResult> {
  const webhookUrl = getChannelWebhookUrl(channelName);

  if (webhookUrl) {
    const payload: TeamsWebhookPayload = {
      type: 'message',
      attachments: [{
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.5',
          body: [{ type: 'TextBlock', text, wrap: true }],
        },
      }],
    };
    await sendTeamsWebhook(webhookUrl, payload);
    return { method: 'webhook' };
  }

  const channels = buildChannelMap();
  const target = channels[channelName as keyof ChannelMap];
  if (graphClient && target) {
    await graphClient.sendText(target, text);
    return { method: 'graph' };
  }

  return { method: 'none', error: `No webhook URL or Graph channel configured for "${channelName}"` };
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
