/**
 * Teams Call Handler — Microsoft Graph-based Teams meeting participation
 *
 * Uses Microsoft Graph Communications API to:
 *   1. Join a Teams meeting as a bot participant via joinWebUrl
 *   2. Manage call lifecycle (join, leave, state tracking)
 *   3. Save meeting transcripts and summaries
 *
 * Requires:
 *   - BOT_APP_ID (Azure app registration with Calls.JoinGroupCall.All permission)
 *   - BOT_APP_SECRET
 *   - AZURE_TENANT_ID
 *   - The app registration must have "Calls.JoinGroupCall.All" application permission
 *     granted with admin consent in Microsoft Graph.
 */

import OpenAI from 'openai';
import { systemQuery } from '@glyphor/shared/db';
import { SessionManager } from './sessionManager.js';
import { getAgentVoiceConfig } from './voiceMap.js';
import type { TeamsJoinRequest, TeamsJoinResponse, TeamsLeaveRequest, TranscriptEntry } from './types.js';

export interface GraphCallConfig {
  appId: string;
  appSecret: string;
  tenantId: string;
}

export class TeamsCallHandler {
  private graphConfig: GraphCallConfig;
  private openai: OpenAI;
  private sessions: SessionManager;
  private gatewayUrl: string;
  /** Map from sessionId → Graph call ID */
  private calls = new Map<string, string>();
  /** Meeting transcripts */
  private transcripts = new Map<string, TranscriptEntry[]>();
  /** Token cache for Graph API */
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(
    graphConfig: GraphCallConfig,
    openai: OpenAI,
    sessions: SessionManager,
    gatewayUrl: string,
  ) {
    this.graphConfig = graphConfig;
    this.openai = openai;
    this.sessions = sessions;
    this.gatewayUrl = gatewayUrl;
  }

  /**
   * Acquire a Microsoft Graph token using client credentials flow.
   */
  private async getGraphToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.token;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.graphConfig.appId,
      client_secret: this.graphConfig.appSecret,
      scope: 'https://graph.microsoft.com/.default',
    });

    const res = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(this.graphConfig.tenantId)}/oauth2/v2.0/token`,
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
    this.tokenCache = {
      token: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };
    return data.access_token;
  }

  /**
   * Join a Teams meeting with the specified agent via Microsoft Graph Communications API.
   */
  async joinMeeting(req: TeamsJoinRequest): Promise<TeamsJoinResponse> {
    const { agentRole, meetingUrl, invitedBy } = req;
    const voiceConfig = getAgentVoiceConfig(agentRole);

    // Check limits
    const limitCheck = this.sessions.canStartSession();
    if (!limitCheck.allowed) {
      throw new Error(limitCheck.reason ?? 'Voice limit reached');
    }

    // Check if agent is already in a call
    const existing = this.sessions.getActiveForAgent(agentRole);
    if (existing?.mode === 'teams') {
      throw new Error(`${voiceConfig.displayName} is already in a Teams call`);
    }

    // Create session
    const session = this.sessions.create(agentRole, 'teams', {
      userId: invitedBy,
      meetingUrl,
    });

    // Join via Microsoft Graph Communications API
    const token = await this.getGraphToken();
    const graphResponse = await fetch('https://graph.microsoft.com/v1.0/communications/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.call',
        callbackUri: `${this.gatewayUrl}/voice/teams/callback`,
        requestedModalities: ['audio'],
        mediaConfig: {
          '@odata.type': '#microsoft.graph.serviceHostedMediaConfig',
        },
        source: {
          '@odata.type': '#microsoft.graph.participantInfo',
          identity: {
            '@odata.type': '#microsoft.graph.identitySet',
            application: {
              '@odata.type': '#microsoft.graph.identity',
              displayName: `${voiceConfig.displayName} (AI)`,
              id: this.graphConfig.appId,
            },
          },
        },
        tenantId: this.graphConfig.tenantId,
        joinWebUrl: meetingUrl,
      }),
    });

    if (!graphResponse.ok) {
      const errText = await graphResponse.text();
      this.sessions.end(session.id);
      throw new Error(`Failed to join Teams meeting (${graphResponse.status}): ${errText}`);
    }

    const callData = (await graphResponse.json()) as { id: string; state: string };
    session.callConnectionId = callData.id;
    this.calls.set(session.id, callData.id);
    this.transcripts.set(session.id, []);

    console.log(`[Voice] ${voiceConfig.displayName} joined Teams meeting: ${callData.id} (state: ${callData.state})`);

    return {
      sessionId: session.id,
      callConnectionId: callData.id,
      agent: agentRole,
      displayName: voiceConfig.displayName,
    };
  }

  /**
   * Leave a Teams meeting via Graph API.
   */
  async leaveMeeting(req: TeamsLeaveRequest): Promise<void> {
    const { sessionId } = req;
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const callId = this.calls.get(sessionId);
    if (callId) {
      try {
        const token = await this.getGraphToken();
        await fetch(`https://graph.microsoft.com/v1.0/communications/calls/${encodeURIComponent(callId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        console.warn(`[Voice] Error hanging up call: ${err}`);
      }
      this.calls.delete(sessionId);
    }

    // Save transcript
    const entries = this.transcripts.get(sessionId) ?? [];
    if (entries.length > 0) {
      const voiceConfig = getAgentVoiceConfig(session.agentRole);
      const summary = entries
        .map((e) => `[${e.role}] ${e.text}`)
        .join('\n');

      // Save meeting notes to knowledge graph
      await systemQuery(
        'INSERT INTO activity_log (agent_role, action, product, summary, details) VALUES ($1, $2, $3, $4, $5)',
        [
          session.agentRole,
          'briefing',
          'company',
          `Meeting notes — ${voiceConfig.displayName} participated in a Teams call`,
          JSON.stringify({ transcript: summary, meetingUrl: session.meetingUrl }),
        ],
      );
    }

    // Save usage
    const usage = this.sessions.end(sessionId);
    if (usage) {
      await systemQuery(
        'INSERT INTO voice_usage (session_id, agent_role, mode, duration_sec, estimated_cost, user_id, started_at, ended_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [usage.sessionId, usage.agentRole, usage.mode, usage.durationSec, usage.estimatedCost, usage.userId, usage.startedAt, usage.endedAt],
      );
    }

    this.transcripts.delete(sessionId);
    console.log(`[Voice] ${session.agentRole} left Teams meeting`);
  }

  /**
   * Record transcript entry.
   */
  addTranscript(sessionId: string, role: 'user' | 'agent', text: string): void {
    const entries = this.transcripts.get(sessionId);
    if (entries) {
      entries.push({ sessionId, role, text, timestamp: Date.now() });
    }
  }

  /**
   * Handle Graph Communications API call state notifications.
   *
   * Graph sends commsNotifications to the callbackUri when call state changes.
   */
  async handleCallback(notification: Record<string, unknown>): Promise<void> {
    // Graph Communications API sends commsNotifications
    const values = (notification.value ?? [notification]) as Record<string, unknown>[];
    for (const entry of values) {
      const resourceData = entry.resourceData as Record<string, unknown> | undefined;
      const changeType = entry.changeType as string | undefined;

      if (!resourceData) continue;

      const callState = resourceData.state as string | undefined;
      const callId = resourceData.id as string | undefined;

      console.log(`[Voice] Graph callback: changeType=${changeType}, state=${callState}, callId=${callId}`);

      // Handle terminated calls — clean up session
      if (callState === 'terminated' && callId) {
        for (const [sessionId, storedCallId] of this.calls.entries()) {
          if (storedCallId === callId) {
            await this.leaveMeeting({ sessionId });
            break;
          }
        }
      }
    }
  }
}
