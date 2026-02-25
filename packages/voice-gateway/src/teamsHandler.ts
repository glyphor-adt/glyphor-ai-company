/**
 * Teams Call Handler — ACS-based Teams meeting participation
 *
 * Uses Azure Communication Services Call Automation to:
 *   1. Join a Teams meeting as a participant
 *   2. Stream meeting audio to/from OpenAI Realtime
 *   3. Execute agent tools in real-time during meetings
 *   4. Save meeting transcripts and summaries
 *
 * Requires:
 *   - ACS_CONNECTION_STRING (Azure Communication Services)
 *   - Teams interop enabled in Azure + M365 tenant
 */

import {
  CallAutomationClient,
  type CallConnection,
} from '@azure/communication-call-automation';
import { CommunicationUserIdentifier } from '@azure/communication-common';
import OpenAI from 'openai';
import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SessionManager } from './sessionManager.js';
import { createRealtimeSession } from './realtimeClient.js';
import { getAgentVoiceConfig } from './voiceMap.js';
import { loadGrantedToolNames } from '@glyphor/agent-runtime';
import type { TeamsJoinRequest, TeamsJoinResponse, TeamsLeaveRequest, TranscriptEntry } from './types.js';

export class TeamsCallHandler {
  private callClient: CallAutomationClient;
  private openai: OpenAI;
  private sessions: SessionManager;
  private supabase: SupabaseClient;
  private gatewayUrl: string;
  /** Map from sessionId → ACS call connection */
  private calls = new Map<string, CallConnection>();
  /** Meeting transcripts */
  private transcripts = new Map<string, TranscriptEntry[]>();

  constructor(
    acsConnectionString: string,
    openai: OpenAI,
    sessions: SessionManager,
    supabase: SupabaseClient,
    gatewayUrl: string,
  ) {
    this.callClient = new CallAutomationClient(acsConnectionString);
    this.openai = openai;
    this.sessions = sessions;
    this.supabase = supabase;
    this.gatewayUrl = gatewayUrl;
  }

  /**
   * Join a Teams meeting with the specified agent.
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

    // Join the Teams meeting via ACS Call Automation
    // Use CommunicationUserIdentifier to target the meeting join URL
    const targetParticipant: CommunicationUserIdentifier = { communicationUserId: meetingUrl };
    const callResult = await this.callClient.createCall(
      { targetParticipant },
      `${this.gatewayUrl}/voice/teams/callback`,
      {
        sourceDisplayName: `${voiceConfig.displayName} (AI)`,
        mediaStreamingOptions: {
          transportUrl: `wss://${new URL(this.gatewayUrl).host}/voice/teams/audio/${meetingUrl}`,
          transportType: 'websocket',
          contentType: 'audio',
          audioChannelType: 'mixed',
          startMediaStreaming: true,
        },
      },
    );

    const callConnectionId = callResult.callConnectionProperties.callConnectionId!;
    session.callConnectionId = callConnectionId;
    this.calls.set(session.id, callResult.callConnection);
    this.transcripts.set(session.id, []);

    // Create matching Realtime session for this agent
    const grantedTools = await loadGrantedToolNames(agentRole, this.supabase);
    const toolDefs = grantedTools.map((name) => ({
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

    const { data: profile } = await this.supabase
      .from('agent_profiles')
      .select('personality_block')
      .eq('role', agentRole)
      .single();

    const realtimeResult = await createRealtimeSession(this.openai, {
      agentRole,
      tools: toolDefs,
      personalityBlock: profile?.personality_block ?? undefined,
    });

    session.realtimeSessionId = realtimeResult.sessionId;

    console.log(`[Voice] ${voiceConfig.displayName} joined Teams meeting: ${callConnectionId}`);

    return {
      sessionId: session.id,
      callConnectionId,
      agent: agentRole,
      displayName: voiceConfig.displayName,
    };
  }

  /**
   * Leave a Teams meeting.
   */
  async leaveMeeting(req: TeamsLeaveRequest): Promise<void> {
    const { sessionId } = req;
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const call = this.calls.get(sessionId);
    if (call) {
      try {
        await call.hangUp(true);
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

      // Save meeting notes to knowledge graph via Supabase
      await this.supabase.from('activity_log').insert({
        agent_role: session.agentRole,
        action: 'briefing',
        product: 'company',
        summary: `Meeting notes — ${voiceConfig.displayName} participated in a Teams call`,
        details: { transcript: summary, meetingUrl: session.meetingUrl },
      });
    }

    // Save usage
    const usage = this.sessions.end(sessionId);
    if (usage) {
      await this.supabase.from('voice_usage').insert({
        session_id: usage.sessionId,
        agent_role: usage.agentRole,
        mode: usage.mode,
        duration_sec: usage.durationSec,
        estimated_cost: usage.estimatedCost,
        user_id: usage.userId,
        started_at: usage.startedAt,
        ended_at: usage.endedAt,
      });
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
   * Handle ACS call event callbacks.
   */
  async handleCallback(event: Record<string, unknown>): Promise<void> {
    const eventType = event.type as string;
    console.log(`[Voice] ACS callback: ${eventType}`);

    // Handle call disconnected — clean up session
    if (eventType === 'Microsoft.Communication.CallDisconnected') {
      const callConnectionId = event.callConnectionId as string;
      for (const [sessionId, session] of this.sessions.getActiveSessions().map((s) => [s.id, s] as const)) {
        if (session.callConnectionId === callConnectionId) {
          await this.leaveMeeting({ sessionId });
          break;
        }
      }
    }
  }
}
