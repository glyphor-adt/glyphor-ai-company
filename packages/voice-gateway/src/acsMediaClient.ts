/**
 * ACS Call Automation Client — Azure Communication Services REST API
 * for joining Teams meetings with bidirectional media streaming.
 *
 * Uses HMAC-SHA256 authentication with the ACS connection string key.
 *
 * Env vars:
 *   - ACS_CONNECTION_STRING (endpoint=https://...;accesskey=...)
 */

import { createHmac, createHash } from 'node:crypto';

export interface AcsConfig {
  endpoint: string;
  accessKey: string;
}

/**
 * Parse an ACS connection string into endpoint + accessKey.
 * Format: endpoint=https://{resource}.communication.azure.com/;accesskey={base64key}
 */
export function parseAcsConnectionString(connectionString: string): AcsConfig {
  const parts: Record<string, string> = {};
  for (const segment of connectionString.split(';')) {
    const idx = segment.indexOf('=');
    if (idx > 0) {
      const key = segment.slice(0, idx).trim().toLowerCase();
      const val = segment.slice(idx + 1).trim();
      parts[key] = val;
    }
  }

  if (!parts.endpoint || !parts.accesskey) {
    throw new Error('Invalid ACS connection string — must contain endpoint and accesskey');
  }

  return {
    endpoint: parts.endpoint.replace(/\/$/, ''),
    accessKey: parts.accesskey,
  };
}

/**
 * Compute HMAC-SHA256 auth headers for an ACS REST API request.
 */
function computeHmacAuth(
  method: string,
  url: URL,
  body: string,
  accessKey: string,
): Record<string, string> {
  const utcNow = new Date().toUTCString();
  const contentHash = createHash('sha256').update(body, 'utf-8').digest('base64');
  const host = url.host;
  const pathAndQuery = url.pathname + url.search;

  const stringToSign = `${method}\n${pathAndQuery}\n${utcNow};${host};${contentHash}`;
  const key = Buffer.from(accessKey, 'base64');
  const signature = createHmac('sha256', key).update(stringToSign, 'utf-8').digest('base64');

  return {
    'x-ms-date': utcNow,
    'x-ms-content-sha256': contentHash,
    Authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
    'Content-Type': 'application/json',
  };
}

export class AcsCallAutomationClient {
  private config: AcsConfig;
  private apiVersion = '2024-09-15';

  constructor(config: AcsConfig) {
    this.config = config;
  }

  /**
   * Join a Teams meeting and start bidirectional media streaming.
   * ACS opens a WebSocket to the specified transportUrl for PCM16 audio I/O.
   */
  async connectToTeamsMeeting(opts: {
    meetingLink: string;
    callbackUri: string;
    mediaTransportUrl: string;
    displayName: string;
  }): Promise<{ callConnectionId: string }> {
    const url = new URL(
      `/calling/callConnections:connect?api-version=${this.apiVersion}`,
      this.config.endpoint,
    );

    const bodyObj = {
      callLocator: {
        kind: 'teamsMeetingLink',
        teamsMeetingLink: opts.meetingLink,
      },
      callbackUri: opts.callbackUri,
      sourceDisplayName: opts.displayName,
      mediaStreamingOptions: {
        transportUrl: opts.mediaTransportUrl,
        transportType: 'websocket',
        contentType: 'audio',
        audioChannelType: 'mixed',
        startMediaStreaming: true,
        enableBidirectional: true,
        audioFormat: 'pcm16KMono',
      },
    };

    const body = JSON.stringify(bodyObj);
    const headers = computeHmacAuth('POST', url, body, this.config.accessKey);

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`ACS connect failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { callConnectionId: string };
    return { callConnectionId: data.callConnectionId };
  }

  /**
   * Leave a call without ending it for other participants.
   */
  async hangUp(callConnectionId: string): Promise<void> {
    const url = new URL(
      `/calling/callConnections/${encodeURIComponent(callConnectionId)}:hangUp?api-version=${this.apiVersion}`,
      this.config.endpoint,
    );

    const bodyObj = { forEveryone: false };
    const body = JSON.stringify(bodyObj);
    const headers = computeHmacAuth('POST', url, body, this.config.accessKey);

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[ACS] Hang up failed (${res.status}): ${errText}`);
    }
  }
}
