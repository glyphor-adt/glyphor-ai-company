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
import { systemQuery } from '@glyphor/shared/db';
import { SessionManager } from './sessionManager.js';
import { createRealtimeSession } from './realtimeClient.js';
import type { DashboardVoiceRequest, DashboardVoiceResponse, TranscriptEntry } from './types.js';
import { getAgentVoiceConfig } from './voiceMap.js';

export class DashboardVoiceHandler {
  private openai: OpenAI;
  private sessions: SessionManager;
  private transcripts = new Map<string, TranscriptEntry[]>();

  constructor(openai: OpenAI, sessions: SessionManager) {
    this.openai = openai;
    this.sessions = sessions;
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
    console.log(`[Voice] createSession: loading tool grants for ${agentRole}`);
    const grantedTools = await loadGrantedToolNames(agentRole);
    console.log(`[Voice] createSession: loaded ${grantedTools.length} granted tools`);

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

    // Load personality & identity from agent_profiles
    console.log(`[Voice] createSession: loading agent profile`);
    const profileRows = await systemQuery<{ personality_summary: string | null; backstory: string | null; communication_traits: string[] | null }>(
      'SELECT personality_summary, backstory, communication_traits FROM agent_profiles WHERE agent_id = $1 LIMIT 1',
      [agentRole],
    );
    const profile = profileRows[0] ?? null;
    console.log(`[Voice] createSession: profile loaded (${profile ? 'found' : 'not found'})`);

    // Load role-specific system prompt from agent_briefs
    console.log(`[Voice] createSession: loading agent brief`);
    const briefRows = await systemQuery<{ system_prompt: string | null }>(
      'SELECT system_prompt FROM agent_briefs WHERE agent_id = $1 LIMIT 1',
      [agentRole],
    );
    const brief = briefRows[0] ?? null;
    console.log(`[Voice] createSession: brief loaded (${brief ? 'found' : 'not found'})`);

    // Create OpenAI Realtime session
    console.log(`[Voice] createSession: creating OpenAI Realtime session`);
    const result = await createRealtimeSession(this.openai, {
      agentRole,
      tools: toolDefs,
      promptContext: {
        personalitySummary: profile?.personality_summary ?? undefined,
        backstory: profile?.backstory ?? undefined,
        communicationTraits: profile?.communication_traits ?? undefined,
        systemPrompt: brief?.system_prompt ?? undefined,
      },
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

      await systemQuery(
        'INSERT INTO chat_messages (agent_role, role, content, user_id) VALUES ($1, $2, $3, $4)',
        [agentRole, 'agent', `*Voice conversation transcript:*\n\n${transcript}`, userId],
      );
    }

    // Save usage record
    if (usage) {
      await systemQuery(
        'INSERT INTO voice_usage (session_id, agent_role, mode, duration_sec, estimated_cost, user_id, started_at, ended_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [usage.sessionId, usage.agentRole, usage.mode, usage.durationSec, usage.estimatedCost, usage.userId, usage.startedAt, usage.endedAt],
      );
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
