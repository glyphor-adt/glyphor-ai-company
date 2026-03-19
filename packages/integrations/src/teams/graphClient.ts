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
import type { AdaptiveCard } from './webhooks.js';
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
 *   - TEAMS_CHANNEL_BRIEFING_KRISTINA_ID
 *   - TEAMS_CHANNEL_BRIEFING_ANDREW_ID
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
  briefingKristina: ChannelTarget;
  briefingAndrew: ChannelTarget;
  decisions: ChannelTarget;
  alerts: ChannelTarget;
  deliverables: ChannelTarget;
  general: ChannelTarget;
  engineering: ChannelTarget;
  growth: ChannelTarget;
  financials: ChannelTarget;
  productFuse: ChannelTarget;
  productPulse: ChannelTarget;
}

/**
 * Build channel map from environment variables.
 * Falls back gracefully — missing channels are omitted.
 */
export function buildChannelMap(): Partial<ChannelMap> {
  const teamId = process.env.TEAMS_TEAM_ID?.trim();
  if (!teamId) return {};

  const channelEnvMap: Record<keyof ChannelMap, string[]> = {
    briefingKristina: ['TEAMS_CHANNEL_CEO_BRIEF_ID', 'TEAMS_CHANNEL_BRIEFING_KRISTINA_ID'],
    briefingAndrew: ['TEAMS_CHANNEL_COO_BRIEF_ID', 'TEAMS_CHANNEL_BRIEFING_ANDREW_ID'],
    decisions: ['TEAMS_CHANNEL_DECISIONS_ID'],
    alerts: ['TEAMS_CHANNEL_ALERTS_ID'],
    deliverables: ['TEAMS_CHANNEL_DELIVERABLES_ID'],
    general: ['TEAMS_CHANNEL_GENERAL_ID'],
    engineering: ['TEAMS_CHANNEL_ENGINEERING_ID'],
    growth: ['TEAMS_CHANNEL_GROWTH_ID'],
    financials: ['TEAMS_CHANNEL_FINANCIALS_ID'],
    productFuse: ['TEAMS_CHANNEL_PRODUCT_FUSE_ID'],
    productPulse: ['TEAMS_CHANNEL_PRODUCT_PULSE_ID'],
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

// ─── SEND HELPER ────────────────────────────────────────────────

/**
 * High-level send function — unified interface for posting to Teams.
 * Uses Graph API when configured, falls back to webhook.
 */
export async function sendToTeamsChannel(
  client: GraphTeamsClient,
  target: ChannelTarget,
  card: AdaptiveCard,
): Promise<void> {
  await client.sendCard(target, card);
}
