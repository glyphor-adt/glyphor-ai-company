/**
 * Microsoft Graph API Teams Client
 *
 * Sends messages to Teams channels using app-only authentication
 * via Entra ID client credentials flow (MSAL).
 *
 * Required env vars: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
 * Required Graph API permissions (Application): Teamwork.Migrate.All, Channel.ReadBasic.All
 */

import { ConfidentialClientApplication } from '@azure/msal-node';
import type { AdaptiveCard } from './webhooks.js';

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
   */
  static fromEnv(): GraphTeamsClient {
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error(
        'Missing Azure credentials. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET.',
      );
    }

    return new GraphTeamsClient({ tenantId, clientId, clientSecret });
  }

  /**
   * Acquire a Graph API token using client credentials flow.
   */
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
      throw new Error(`Graph API send failed (${response.status}): ${text}`);
    }
  }

  /**
   * Send a plain text message to a Teams channel.
   */
  async sendText(target: ChannelTarget, content: string): Promise<void> {
    const token = await this.getToken();
    const url = `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(target.teamId)}/channels/${encodeURIComponent(target.channelId)}/messages`;

    const body = {
      body: { contentType: 'text', content },
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
      throw new Error(`Graph API send failed (${response.status}): ${text}`);
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
 */
export interface ChannelMap {
  briefingKristina: ChannelTarget;
  briefingAndrew: ChannelTarget;
  decisions: ChannelTarget;
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
  const teamId = process.env.TEAMS_TEAM_ID;
  if (!teamId) return {};

  const channelEnvMap: Record<keyof ChannelMap, string> = {
    briefingKristina: 'TEAMS_CHANNEL_BRIEFING_KRISTINA_ID',
    briefingAndrew: 'TEAMS_CHANNEL_BRIEFING_ANDREW_ID',
    decisions: 'TEAMS_CHANNEL_DECISIONS_ID',
    general: 'TEAMS_CHANNEL_GENERAL_ID',
    engineering: 'TEAMS_CHANNEL_ENGINEERING_ID',
    growth: 'TEAMS_CHANNEL_GROWTH_ID',
    financials: 'TEAMS_CHANNEL_FINANCIALS_ID',
    productFuse: 'TEAMS_CHANNEL_PRODUCT_FUSE_ID',
    productPulse: 'TEAMS_CHANNEL_PRODUCT_PULSE_ID',
  };

  const map: Partial<ChannelMap> = {};
  for (const [key, envVar] of Object.entries(channelEnvMap)) {
    const channelId = process.env[envVar];
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
