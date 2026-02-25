/**
 * OpenAI Realtime Client — Manages Realtime API sessions for voice I/O
 *
 * Creates ephemeral sessions via the REST API, then clients connect
 * via WebRTC using the returned client_secret. For Teams mode, the
 * gateway acts as the WebSocket client piping ACS audio.
 */

import OpenAI from 'openai';
import type { CompanyAgentRole, ToolDefinition } from '@glyphor/agent-runtime';
import type { RealtimeVoice, VoiceToolDeclaration } from './types.js';
import { getAgentVoiceConfig } from './voiceMap.js';
import { buildVoiceSystemPrompt } from './voicePrompt.js';
import { toRealtimeTools } from './toolBridge.js';

const REALTIME_MODEL = 'gpt-4o-realtime-preview';

export interface RealtimeSessionResult {
  sessionId: string;
  clientSecret: string;
  voice: RealtimeVoice;
  agentDisplayName: string;
}

export interface RealtimeSessionOptions {
  agentRole: CompanyAgentRole;
  tools: ToolDefinition[];
  personalityBlock?: string;
}

/**
 * Create an OpenAI Realtime ephemeral session.
 * Returns credentials the browser can use to connect via WebRTC.
 */
export async function createRealtimeSession(
  openaiClient: OpenAI,
  options: RealtimeSessionOptions,
): Promise<RealtimeSessionResult> {
  const { agentRole, tools, personalityBlock } = options;
  const voiceConfig = getAgentVoiceConfig(agentRole);
  const systemPrompt = buildVoiceSystemPrompt(voiceConfig, personalityBlock);
  const realtimeTools = toRealtimeTools(tools);

  // Use the OpenAI Realtime sessions REST endpoint
  // POST https://api.openai.com/v1/realtime/sessions
  const response = await openaiClient.post('/realtime/sessions', {
    body: {
      model: REALTIME_MODEL,
      modalities: ['text', 'audio'],
      voice: voiceConfig.voice,
      instructions: systemPrompt,
      tools: realtimeTools,
      input_audio_transcription: { model: 'whisper-1' },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
      },
    },
  }) as { id: string; client_secret: { value: string } };

  return {
    sessionId: response.id,
    clientSecret: response.client_secret.value,
    voice: voiceConfig.voice,
    agentDisplayName: voiceConfig.displayName,
  };
}
