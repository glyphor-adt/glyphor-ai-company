/**
 * Teams Audio Bridge — Bidirectional audio bridge between a media
 * transport WebSocket (ACS / custom) and OpenAI Realtime WebSocket.
 *
 * Architecture:
 *   Teams call audio ←→ Media WebSocket ←→ TeamsAudioBridge ←→ OpenAI Realtime WebSocket
 *
 * Media transport sends/receives JSON frames with base64 PCM16 audio.
 * OpenAI Realtime uses its own JSON protocol for audio I/O + events.
 *
 * Audio is resampled between 16kHz (media) and 24kHz (OpenAI Realtime).
 */

import WebSocket from 'ws';
import type { CompanyAgentRole, ToolDefinition } from '@glyphor/agent-runtime';
import { getAgentVoiceConfig } from './voiceMap.js';
import { buildVoiceSystemPrompt, type VoicePromptContext } from './voicePrompt.js';
import { toRealtimeTools, executeVoiceTool } from './toolBridge.js';
import { resample16to24, resample24to16 } from './audioResampler.js';
import { REALTIME_MODEL } from '@glyphor/shared/models';
import type { TranscriptEntry, VoiceToolDeclaration } from './types.js';

export interface AudioBridgeOptions {
  sessionId: string;
  agentRole: CompanyAgentRole;
  openaiApiKey: string;
  tools: ToolDefinition[];
  promptContext?: VoicePromptContext;
  /** Called for each transcription event (user or agent speech) */
  onTranscript?: (entry: TranscriptEntry) => void;
  /** Called when the bridge closes (either side disconnects) */
  onClose?: () => void;
  /**
   * Whether the media transport sends audio at 16kHz (true, default)
   * or 24kHz (false, matches OpenAI — no resampling needed).
   */
  mediaIs16kHz?: boolean;
}

export class TeamsAudioBridge {
  private realtimeWs: WebSocket | null = null;
  private mediaWs: WebSocket | null = null;
  private sessionId: string;
  private agentRole: CompanyAgentRole;
  private openaiApiKey: string;
  private tools: ToolDefinition[];
  private voiceConfig: ReturnType<typeof getAgentVoiceConfig>;
  private systemPrompt: string;
  private realtimeTools: VoiceToolDeclaration[];
  private onTranscript?: (entry: TranscriptEntry) => void;
  private onClose?: () => void;
  private mediaIs16kHz: boolean;
  private closed = false;

  constructor(opts: AudioBridgeOptions) {
    this.sessionId = opts.sessionId;
    this.agentRole = opts.agentRole;
    this.openaiApiKey = opts.openaiApiKey;
    this.tools = opts.tools;
    this.voiceConfig = getAgentVoiceConfig(opts.agentRole);
    this.systemPrompt = buildVoiceSystemPrompt(this.voiceConfig, opts.promptContext);
    this.realtimeTools = toRealtimeTools(opts.tools);
    this.onTranscript = opts.onTranscript;
    this.onClose = opts.onClose;
    this.mediaIs16kHz = opts.mediaIs16kHz ?? true;
  }

  // ─── OpenAI Realtime WebSocket ──────────────────────────────

  /**
   * Open a WebSocket connection to OpenAI Realtime and configure the session.
   * Must be called before attaching a media stream.
   */
  async connectRealtime(): Promise<void> {
    if (this.closed) throw new Error('Bridge is closed');

    return new Promise<void>((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`;
      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.openaiApiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      const connectTimeout = setTimeout(() => {
        ws.terminate();
        reject(new Error('OpenAI Realtime connection timed out'));
      }, 15_000);

      ws.on('open', () => {
        clearTimeout(connectTimeout);
        this.realtimeWs = ws;

        // Configure the session
        this.sendRealtime({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            voice: this.voiceConfig.voice,
            instructions: this.systemPrompt,
            tools: this.realtimeTools,
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          },
        });

        console.log(`[AudioBridge] Connected to OpenAI Realtime for ${this.voiceConfig.displayName}`);
        resolve();
      });

      ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString());
          this.handleRealtimeEvent(event);
        } catch (err) {
          console.error('[AudioBridge] Failed to parse Realtime message:', err);
        }
      });

      ws.on('error', (err) => {
        clearTimeout(connectTimeout);
        console.error(`[AudioBridge] Realtime WS error:`, err.message);
        reject(err);
      });

      ws.on('close', (code, reason) => {
        console.log(`[AudioBridge] Realtime WS closed: ${code} ${reason.toString()}`);
        this.close();
      });
    });
  }

  // ─── Media Transport WebSocket ──────────────────────────────

  /**
   * Attach an incoming media transport WebSocket (e.g. from ACS media streaming).
   * Once attached, audio flows bidirectionally through the bridge.
   */
  attachMediaStream(ws: WebSocket): void {
    if (this.closed) {
      ws.close(1000, 'Bridge is closed');
      return;
    }

    this.mediaWs = ws;
    console.log(`[AudioBridge] Media stream attached for session ${this.sessionId}`);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMediaMessage(msg);
      } catch {
        // Binary frame — treat as raw PCM16 audio
        if (Buffer.isBuffer(data)) {
          this.forwardAudioToRealtime(data);
        }
      }
    });

    ws.on('close', () => {
      console.log(`[AudioBridge] Media stream disconnected for session ${this.sessionId}`);
      this.mediaWs = null;
      this.close();
    });

    ws.on('error', (err) => {
      console.error(`[AudioBridge] Media WS error:`, err.message);
    });
  }

  /** True when both the Realtime and media WebSockets are connected. */
  get isFullyConnected(): boolean {
    return (
      this.realtimeWs?.readyState === WebSocket.OPEN &&
      this.mediaWs?.readyState === WebSocket.OPEN
    );
  }

  /** True when Realtime WS is connected and waiting for media. */
  get isWaitingForMedia(): boolean {
    return (
      this.realtimeWs?.readyState === WebSocket.OPEN &&
      !this.mediaWs
    );
  }

  // ─── Media → Realtime ──────────────────────────────────────

  /**
   * Handle incoming JSON message from the media transport.
   * Supports ACS format and a generic format.
   */
  private handleMediaMessage(msg: Record<string, unknown>): void {
    // ACS Call Automation format
    if (msg.kind === 'AudioData') {
      const audioData = msg.audioData as Record<string, unknown> | undefined;
      if (audioData?.data) {
        const pcmBuffer = Buffer.from(audioData.data as string, 'base64');
        this.forwardAudioToRealtime(pcmBuffer);
      }
      return;
    }

    // ACS AudioMetadata — log but don't forward
    if (msg.kind === 'AudioMetadata') {
      const meta = msg.audioMetadata as Record<string, unknown> | undefined;
      console.log(`[AudioBridge] Media metadata:`, JSON.stringify(meta));
      return;
    }

    // Generic format: { type: 'audio', data: '<base64>' }
    if (msg.type === 'audio' && typeof msg.data === 'string') {
      const pcmBuffer = Buffer.from(msg.data, 'base64');
      this.forwardAudioToRealtime(pcmBuffer);
      return;
    }
  }

  /**
   * Forward PCM audio from the media transport to OpenAI Realtime.
   * Resamples 16kHz → 24kHz if needed.
   */
  private forwardAudioToRealtime(pcm16Buffer: Buffer): void {
    if (this.realtimeWs?.readyState !== WebSocket.OPEN) return;

    const resampled = this.mediaIs16kHz
      ? resample16to24(pcm16Buffer)
      : pcm16Buffer;

    this.sendRealtime({
      type: 'input_audio_buffer.append',
      audio: resampled.toString('base64'),
    });
  }

  // ─── Realtime → Media ──────────────────────────────────────

  /**
   * Handle events from the OpenAI Realtime WebSocket.
   */
  private handleRealtimeEvent(event: Record<string, unknown>): void {
    switch (event.type) {
      // ── Audio output from the AI agent ──
      case 'response.audio.delta':
        this.forwardAudioToMedia(event.delta as string);
        break;

      // ── User speech transcription ──
      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript && this.onTranscript) {
          this.onTranscript({
            sessionId: this.sessionId,
            role: 'user',
            text: event.transcript as string,
            timestamp: Date.now(),
          });
        }
        break;

      // ── Agent response transcription ──
      case 'response.audio_transcript.done':
        if (event.transcript && this.onTranscript) {
          this.onTranscript({
            sessionId: this.sessionId,
            role: 'agent',
            text: event.transcript as string,
            timestamp: Date.now(),
          });
        }
        break;

      // ── Tool / function call ──
      case 'response.function_call_arguments.done':
        void this.handleFunctionCall(event);
        break;

      // ── Session created ──
      case 'session.created':
      case 'session.updated':
        console.log(`[AudioBridge] Session ${event.type}`);
        break;

      // ── Interruption — user started speaking during agent output ──
      case 'input_audio_buffer.speech_started':
        // OpenAI Realtime handles interruption internally;
        // we just need to stop forwarding the current response audio
        break;

      // ── Error ──
      case 'error': {
        const err = event.error as Record<string, unknown> | undefined;
        console.error(`[AudioBridge] Realtime error:`, err?.message ?? event.error);
        break;
      }
    }
  }

  /**
   * Forward audio from OpenAI Realtime back to the Teams call.
   * Resamples 24kHz → 16kHz if needed.
   */
  private forwardAudioToMedia(base64Audio: string): void {
    if (!base64Audio || this.mediaWs?.readyState !== WebSocket.OPEN) return;

    const pcm24 = Buffer.from(base64Audio, 'base64');
    const outputPcm = this.mediaIs16kHz ? resample24to16(pcm24) : pcm24;
    const outputBase64 = outputPcm.toString('base64');

    // Send in ACS-compatible format
    this.mediaWs.send(
      JSON.stringify({
        kind: 'AudioData',
        audioData: { data: outputBase64 },
      }),
    );
  }

  // ─── Tool / Function calls ─────────────────────────────────

  private async handleFunctionCall(event: Record<string, unknown>): Promise<void> {
    const callId = event.call_id as string;
    const name = event.name as string;
    const argsJson = event.arguments as string;

    console.log(`[AudioBridge] Tool call: ${name}(${argsJson?.slice(0, 100)})`);

    try {
      const result = await executeVoiceTool(
        this.tools,
        name,
        argsJson ?? '{}',
        {
          agentId: this.agentRole,
          agentRole: this.agentRole,
          turnNumber: 0,
          abortSignal: AbortSignal.timeout(30_000),
          memoryBus: null as never, // tools are stubs in voice mode
          emitEvent: () => {},
        },
      );

      // Send tool result back to Realtime
      this.sendRealtime({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: result,
        },
      });

      // Trigger a response now that the tool result is available
      this.sendRealtime({ type: 'response.create' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[AudioBridge] Tool call failed:`, message);

      this.sendRealtime({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ success: false, error: message }),
        },
      });
      this.sendRealtime({ type: 'response.create' });
    }
  }

  // ─── Helpers ───────────────────────────────────────────────

  private sendRealtime(event: Record<string, unknown>): void {
    if (this.realtimeWs?.readyState === WebSocket.OPEN) {
      this.realtimeWs.send(JSON.stringify(event));
    }
  }

  /**
   * Close both WebSocket connections and clean up.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    console.log(`[AudioBridge] Closing bridge for session ${this.sessionId}`);

    if (this.realtimeWs) {
      if (this.realtimeWs.readyState === WebSocket.OPEN) {
        this.realtimeWs.close(1000, 'Bridge closing');
      }
      this.realtimeWs = null;
    }

    if (this.mediaWs) {
      if (this.mediaWs.readyState === WebSocket.OPEN) {
        this.mediaWs.close(1000, 'Bridge closing');
      }
      this.mediaWs = null;
    }

    this.onClose?.();
  }
}
