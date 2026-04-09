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
import { loadGrantedToolNames } from '@glyphor/agent-runtime';
import type { CompanyAgentRole, ToolDefinition } from '@glyphor/agent-runtime';
import { SessionManager } from './sessionManager.js';
import { getAgentVoiceConfig } from './voiceMap.js';
import { TeamsAudioBridge } from './teamsAudioBridge.js';
import type { AcsCallAutomationClient } from './acsMediaClient.js';
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
  /** Map from Graph call ID → sessionId (reverse lookup) */
  private callToSession = new Map<string, string>();
  /** Meeting transcripts */
  private transcripts = new Map<string, TranscriptEntry[]>();
  /** Active audio bridges per session */
  private bridges = new Map<string, TeamsAudioBridge>();
  /** Token cache for Graph API */
  private tokenCache: { token: string; expiresAt: number } | null = null;
  /** Optional ACS Call Automation client for media streaming */
  private acsClient: AcsCallAutomationClient | null = null;
  /** Sessions that use ACS (vs Graph-only) for disconnect routing */
  private acsSessions = new Set<string>();

  constructor(
    graphConfig: GraphCallConfig,
    openai: OpenAI,
    sessions: SessionManager,
    gatewayUrl: string,
    acsClient?: AcsCallAutomationClient,
  ) {
    this.graphConfig = graphConfig;
    this.openai = openai;
    this.sessions = sessions;
    this.gatewayUrl = gatewayUrl;
    this.acsClient = acsClient ?? null;
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

    // ── ACS path: media streaming with bidirectional audio ──
    if (this.acsClient) {
      try {
        // Pre-create the audio bridge so it's ready when ACS opens the media WebSocket
        await this.startAudioBridge(session.id);

        // Build the WebSocket URL ACS will connect to for media streaming
        const wsUrl = this.gatewayUrl
          .replace(/^http:/, 'ws:')
          .replace(/^https:/, 'wss:');

        const acsResult = await this.acsClient.connectToTeamsMeeting({
          meetingLink: meetingUrl,
          callbackUri: `${this.gatewayUrl}/voice/teams/acs-callback`,
          mediaTransportUrl: `${wsUrl}/ws/media/${session.id}`,
          displayName: `${voiceConfig.displayName} (AI)`,
        });

        session.callConnectionId = acsResult.callConnectionId;
        this.calls.set(session.id, acsResult.callConnectionId);
        this.callToSession.set(acsResult.callConnectionId, session.id);
        this.acsSessions.add(session.id);
        this.transcripts.set(session.id, []);

        console.log(`[Voice] ${voiceConfig.displayName} joining Teams meeting via ACS: ${acsResult.callConnectionId}`);

        return {
          sessionId: session.id,
          callConnectionId: acsResult.callConnectionId,
          agent: agentRole,
          displayName: voiceConfig.displayName,
        };
      } catch (err) {
        // Clean up bridge if ACS connect failed
        const bridge = this.bridges.get(session.id);
        if (bridge) {
          bridge.close();
          this.bridges.delete(session.id);
        }
        this.sessions.end(session.id);
        throw err;
      }
    }

    // ── Graph-only path (no media streaming — presence only) ──
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
    this.callToSession.set(callData.id, session.id);
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

    // Close audio bridge
    const bridge = this.bridges.get(sessionId);
    if (bridge) {
      bridge.close();
      this.bridges.delete(sessionId);
    }

    const callId = this.calls.get(sessionId);
    if (callId) {
      try {
        if (this.acsSessions.has(sessionId) && this.acsClient) {
          await this.acsClient.hangUp(callId);
        } else {
          const token = await this.getGraphToken();
          await fetch(`https://graph.microsoft.com/v1.0/communications/calls/${encodeURIComponent(callId)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      } catch (err) {
        console.warn(`[Voice] Error hanging up call: ${err}`);
      }
      this.callToSession.delete(callId);
      this.calls.delete(sessionId);
      this.acsSessions.delete(sessionId);
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

      // Handle established calls — start the audio bridge
      if (callState === 'established' && callId) {
        const sessionId = this.callToSession.get(callId);
        if (sessionId) {
          void this.startAudioBridge(sessionId);
        }
      }

      // Handle terminated calls — clean up session
      if (callState === 'terminated' && callId) {
        const sessionId = this.callToSession.get(callId);
        if (sessionId) {
          await this.leaveMeeting({ sessionId });
        }
      }
    }
  }

  /**
   * Start the audio bridge for an established call.
   * Creates an OpenAI Realtime WebSocket session and prepares
   * for a media transport WebSocket to attach.
   */
  private async startAudioBridge(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Don't create a duplicate bridge
    if (this.bridges.has(sessionId)) return;

    try {
      // Load the agent's granted tool names
      const grantedTools = await loadGrantedToolNames(session.agentRole);
      const toolDefs: ToolDefinition[] = grantedTools.map((name) => ({
        name,
        description: `Execute the ${name} tool`,
        parameters: {
          args: {
            type: 'string' as const,
            description: 'JSON-encoded arguments for the tool',
          },
        },
        execute: async () => ({ success: true }),
      }));

      // Load personality & identity from agent_profiles
      const profileRows = await systemQuery<{
        personality_summary: string | null;
        backstory: string | null;
        communication_traits: string[] | null;
      }>(
        'SELECT personality_summary, backstory, communication_traits FROM agent_profiles WHERE agent_id = $1 LIMIT 1',
        [session.agentRole],
      );
      const profile = profileRows[0] ?? null;

      // Load role-specific system prompt from agent_briefs
      const briefRows = await systemQuery<{ system_prompt: string | null }>(
        'SELECT system_prompt FROM agent_briefs WHERE agent_id = $1 LIMIT 1',
        [session.agentRole],
      );
      const brief = briefRows[0] ?? null;

      const bridge = new TeamsAudioBridge({
        sessionId,
        agentRole: session.agentRole,
        tools: toolDefs,
        promptContext: {
          personalitySummary: profile?.personality_summary ?? undefined,
          backstory: profile?.backstory ?? undefined,
          communicationTraits: profile?.communication_traits ?? undefined,
          systemPrompt: brief?.system_prompt ?? undefined,
        },
        onTranscript: (entry) => this.addTranscript(sessionId, entry.role, entry.text),
        onClose: () => {
          this.bridges.delete(sessionId);
          console.log(`[Voice] Audio bridge closed for session ${sessionId}`);
        },
      });

      // Connect to OpenAI Realtime (blocks until WebSocket opens)
      await bridge.connectRealtime();
      this.bridges.set(sessionId, bridge);
      session.realtimeSessionId = sessionId;

      const voiceConfig = getAgentVoiceConfig(session.agentRole);
      console.log(
        `[Voice] Audio bridge started for ${voiceConfig.displayName} — ` +
        `waiting for media stream at /ws/media/${sessionId}`,
      );
    } catch (err) {
      console.error(`[Voice] Failed to start audio bridge for session ${sessionId}:`, err);
    }
  }

  /**
   * Get the audio bridge for a session (used by WebSocket server to attach media).
   */
  getBridge(sessionId: string): TeamsAudioBridge | undefined {
    return this.bridges.get(sessionId);
  }

  /**
   * Handle ACS Call Automation CloudEvents callbacks.
   *
   * ACS sends events like CallConnected, CallDisconnected,
   * MediaStreamingStarted, etc. as CloudEvents arrays.
   */
  async handleAcsCallback(events: Record<string, unknown>[]): Promise<void> {
    for (const event of events) {
      const eventType = event.type as string | undefined;
      const data = event.data as Record<string, unknown> | undefined;
      const callConnectionId = data?.callConnectionId as string | undefined;

      console.log(`[Voice] ACS callback: type=${eventType}, callConnectionId=${callConnectionId}`);

      switch (eventType) {
        case 'Microsoft.Communication.CallConnected':
          console.log(`[Voice] ACS call connected: ${callConnectionId}`);
          break;

        case 'Microsoft.Communication.MediaStreamingStarted':
          console.log(`[Voice] ACS media streaming started for ${callConnectionId}`);
          break;

        case 'Microsoft.Communication.MediaStreamingStopped':
          console.log(`[Voice] ACS media streaming stopped for ${callConnectionId}`);
          break;

        case 'Microsoft.Communication.CallDisconnected': {
          if (callConnectionId) {
            const sessionId = this.callToSession.get(callConnectionId);
            if (sessionId) {
              await this.leaveMeeting({ sessionId });
            }
          }
          break;
        }
      }
    }
  }
}
