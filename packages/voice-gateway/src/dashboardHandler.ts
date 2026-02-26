/**
 * Dashboard Voice Handler
 *
 * Handles voice session creation for the Dashboard (browser) mode.
 * The flow:
 *   1. Dashboard POST /voice/dashboard with { agentRole, userId }
 *   2. Gateway loads agent config, creates OpenAI Realtime ephemeral session
 *   3. Returns { sessionId, clientSecret, voice } to browser
 *   4. Browser connects to OpenAI Realtime via WebRTC using clientSecret
 *   5. Voice I/O happens directly between browser and OpenAI Realtime
 *   6. Function calls route back through the gateway → scheduler → agent runtime
 */

import OpenAI from 'openai';
import type { CompanyAgentRole, ToolDefinition } from '@glyphor/agent-runtime';
import { loadGrantedToolNames } from '@glyphor/agent-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SessionManager } from './sessionManager.js';
import { createRealtimeSession } from './realtimeClient.js';
import type { DashboardVoiceRequest, DashboardVoiceResponse, TranscriptEntry } from './types.js';
import { getAgentVoiceConfig } from './voiceMap.js';

export class DashboardVoiceHandler {
  private openai: OpenAI;
  private sessions: SessionManager;
  private supabase: SupabaseClient;
  private transcripts = new Map<string, TranscriptEntry[]>();

  constructor(openai: OpenAI, sessions: SessionManager, supabase: SupabaseClient) {
    this.openai = openai;
    this.sessions = sessions;
    this.supabase = supabase;
  }

  /**
   * Create a new voice session for dashboard chat.
   * Returns credentials the browser uses to connect via WebRTC.
   */
  async createSession(req: DashboardVoiceRequest): Promise<DashboardVoiceResponse> {
    const { agentRole, userId, chatId } = req;

    // Check daily limits
    const limitCheck = this.sessions.canStartSession();
    if (!limitCheck.allowed) {
      throw new Error(limitCheck.reason ?? 'Voice limit reached');
    }

    // Check if this agent already has an active session
    const existing = this.sessions.getActiveForAgent(agentRole);
    if (existing) {
      throw new Error(`${agentRole} already has an active voice session`);
    }

    // Load the agent's granted tool names to build tool declarations
    const grantedTools = await loadGrantedToolNames(agentRole, this.supabase);

    // Build minimal tool declarations for the Realtime session.
    // We use the granted tool names but create lightweight stubs —
    // actual execution goes through the scheduler's tool executor.
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

    // Load personality from agent_profiles table
    const { data: profile } = await this.supabase
      .from('agent_profiles')
      .select('personality_block')
      .eq('role', agentRole)
      .single();

    const personalityBlock = profile?.personality_block ?? undefined;

    // Create OpenAI Realtime session
    const result = await createRealtimeSession(this.openai, {
      agentRole,
      tools: toolDefs,
      personalityBlock,
    });

    // Track the session
    const session = this.sessions.create(agentRole, 'dashboard', { userId, chatId });
    session.realtimeSessionId = result.sessionId;

    this.transcripts.set(session.id, []);

    return {
      sessionId: session.id,
      clientSecret: result.clientSecret,
      voice: result.voice,
      agentDisplayName: result.agentDisplayName,
    };
  }

  /**
   * End a dashboard voice session.
   */
  async endSession(sessionId: string): Promise<void> {
    const usage = this.sessions.end(sessionId);
    if (!usage) return;

    // Save transcript to chat history
    const entries = this.transcripts.get(sessionId) ?? [];
    if (entries.length > 0) {
      const session = this.sessions.get(sessionId);
      const agentRole = session?.agentRole ?? 'unknown';
      const userId = session?.userId ?? 'unknown';

      // Save a combined voice transcript as a single chat message
      const transcript = entries
        .map((e) => `**${e.role === 'user' ? 'You' : getAgentVoiceConfig(agentRole as CompanyAgentRole).displayName}**: ${e.text}`)
        .join('\n\n');

      await this.supabase.from('chat_messages').insert({
        agent_role: agentRole,
        role: 'agent',
        content: `*Voice conversation transcript:*\n\n${transcript}`,
        user_id: userId,
      });
    }

    // Save usage record to Supabase
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
  }

  /**
   * Record a transcript entry from the Realtime session.
   */
  addTranscript(sessionId: string, role: 'user' | 'agent', text: string): void {
    const entries = this.transcripts.get(sessionId);
    if (entries) {
      entries.push({ sessionId, role, text, timestamp: Date.now() });
    }
  }
}
