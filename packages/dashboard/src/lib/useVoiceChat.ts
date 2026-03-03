/**
 * useVoiceChat — React hook for Dashboard voice chat sessions.
 *
 * Handles:
 *  - Creating an OpenAI Realtime voice session via the Voice Gateway
 *  - WebRTC connection to OpenAI for speech-to-speech
 *  - Real-time transcript display
 *  - Session lifecycle (start, stop, timeout)
 */

import { useState, useRef, useCallback, useEffect } from 'react';

const VOICE_GATEWAY_URL = import.meta.env.VITE_VOICE_GATEWAY_URL || '';

export interface VoiceTranscriptEntry {
  role: 'user' | 'agent';
  text: string;
  timestamp: Date;
}

export interface UseVoiceChatReturn {
  /** Whether voice chat is currently active */
  isActive: boolean;
  /** Whether we're connecting (loading state) */
  isConnecting: boolean;
  /** Live transcript entries */
  transcript: VoiceTranscriptEntry[];
  /** Duration of current session in seconds */
  durationSec: number;
  /** Start a voice session with the given agent */
  startVoice: (agentRole: string, userId: string) => Promise<void>;
  /** Stop the current voice session */
  stopVoice: () => Promise<void>;
  /** Error message if something went wrong */
  error: string | null;
  /** Whether the voice gateway is configured */
  isAvailable: boolean;
}

export function useVoiceChat(): UseVoiceChatReturn {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcript, setTranscript] = useState<VoiceTranscriptEntry[]>([]);
  const [durationSec, setDurationSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  const isAvailable = !!VOICE_GATEWAY_URL;

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      cleanupWebRTC();
    };
  }, []);

  function cleanupWebRTC() {
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.srcObject = null;
      audioElRef.current.remove();
      audioElRef.current = null;
    }
  }

  const startVoice = useCallback(async (agentRole: string, userId: string) => {
    if (!VOICE_GATEWAY_URL) {
      setError('Voice gateway not configured');
      return;
    }

    setIsConnecting(true);
    setError(null);
    setTranscript([]);
    setDurationSec(0);

    try {
      // 1. Request mic permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      // 2. Create voice session via gateway
      const res = await fetch(`${VOICE_GATEWAY_URL}/voice/dashboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentRole, userId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const { sessionId, clientSecret, voice, agentDisplayName } = await res.json();
      sessionIdRef.current = sessionId;

      // 3. Set up WebRTC connection to OpenAI Realtime
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      peerConnectionRef.current = pc;

      // Monitor connection state for silent failures
      pc.oniceconnectionstatechange = () => {
        console.log('[VoiceChat] ICE state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
          setError('Voice connection failed — check your network or firewall settings');
          cleanupWebRTC();
          setIsActive(false);
        }
      };
      pc.onconnectionstatechange = () => {
        console.log('[VoiceChat] Connection state:', pc.connectionState);
        if (pc.connectionState === 'failed') {
          setError('Voice connection failed');
          cleanupWebRTC();
          setIsActive(false);
        }
      };

      // Set up audio playback for agent responses — must be in DOM for autoplay
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      audioElRef.current = audioEl;

      pc.ontrack = (event) => {
        console.log('[VoiceChat] Received remote track:', event.track.kind);
        audioEl.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        audioEl.play().catch((e) => {
          console.error('[VoiceChat] Audio playback blocked:', e);
          setError('Audio playback blocked — click anywhere on the page and try again');
        });
      };

      // Add mic track to peer connection
      stream.getTracks().forEach((track) => {
        console.log('[VoiceChat] Mic track:', track.kind, 'enabled:', track.enabled, 'muted:', track.muted);
        pc.addTrack(track, stream);
      });

      // Create data channel for events (transcripts, function calls)
      const dc = pc.createDataChannel('oai-events');
      dataChannelRef.current = dc;

      dc.onopen = () => console.log('[VoiceChat] Data channel open');
      dc.onclose = () => console.log('[VoiceChat] Data channel closed');
      dc.onerror = (e) => console.error('[VoiceChat] Data channel error:', e);
      dc.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type) console.log('[VoiceChat] Event:', msg.type);
          handleRealtimeEvent(msg, sessionId);
        } catch { /* ignore parse errors */ }
      };

      // Also handle server-initiated data channels
      pc.ondatachannel = (event) => {
        console.log('[VoiceChat] Server data channel:', event.channel.label);
        event.channel.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type) console.log('[VoiceChat] Server event:', msg.type);
            handleRealtimeEvent(msg, sessionId);
          } catch { /* ignore parse errors */ }
        };
      };

      // Create and set local SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send offer to OpenAI Realtime with the ephemeral client secret
      const sdpRes = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${clientSecret}`,
          'Content-Type': 'application/sdp',
        },
        body: pc.localDescription!.sdp,
      });

      if (!sdpRes.ok) {
        const errText = await sdpRes.text().catch(() => '');
        throw new Error(`OpenAI Realtime SDP exchange failed: ${sdpRes.status} ${errText}`);
      }

      const answerSdp = await sdpRes.text();
      console.log('[VoiceChat] SDP exchange complete, setting remote description');
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      // Log transceiver state for diagnostics
      pc.getTransceivers().forEach((t, i) => {
        console.log(`[VoiceChat] Transceiver ${i}: kind=${t.mid} dir=${t.direction} currentDir=${t.currentDirection}`);
      });

      // 4. Start duration timer
      const startTime = Date.now();
      durationTimerRef.current = setInterval(() => {
        setDurationSec(Math.round((Date.now() - startTime) / 1000));
      }, 1000);

      setIsActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      cleanupWebRTC();
    } finally {
      setIsConnecting(false);
    }
  }, []);

  function handleRealtimeEvent(msg: Record<string, unknown>, sessionId: string) {
    const type = msg.type as string;

    // Input audio transcription (what the user said)
    if (type === 'conversation.item.input_audio_transcription.completed') {
      const text = msg.transcript as string;
      if (text?.trim()) {
        setTranscript((prev) => [...prev, { role: 'user', text: text.trim(), timestamp: new Date() }]);
        // Report transcript to gateway
        reportTranscript(sessionId, 'user', text.trim());
      }
    }

    // Input audio transcription failed
    if (type === 'conversation.item.input_audio_transcription.failed') {
      const err = msg.error as Record<string, unknown> | undefined;
      console.warn('[VoiceChat] Transcription failed:', err?.message ?? err?.code ?? 'unknown');
    }

    // Response audio transcript (what the agent said)
    if (type === 'response.audio_transcript.done') {
      const text = msg.transcript as string;
      if (text?.trim()) {
        setTranscript((prev) => [...prev, { role: 'agent', text: text.trim(), timestamp: new Date() }]);
        reportTranscript(sessionId, 'agent', text.trim());
      }
    }

    // Error
    if (type === 'error') {
      const errorMsg = (msg.error as Record<string, unknown>)?.message as string;
      if (errorMsg) setError(errorMsg);
    }
  }

  function reportTranscript(sessionId: string, role: 'user' | 'agent', text: string) {
    if (!VOICE_GATEWAY_URL) return;
    fetch(`${VOICE_GATEWAY_URL}/voice/dashboard/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, role, text }),
    }).catch((err) => { console.error('[VoiceChat] Failed to report transcript:', err); });
  }

  const stopVoice = useCallback(async () => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    cleanupWebRTC();

    // End session on gateway
    if (sessionIdRef.current && VOICE_GATEWAY_URL) {
      fetch(`${VOICE_GATEWAY_URL}/voice/dashboard/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      }).catch((err) => { console.error('[VoiceChat] Failed to end session — transcript may not be saved:', err); });
    }

    sessionIdRef.current = null;
    setIsActive(false);
    setDurationSec(0);
  }, []);

  return {
    isActive,
    isConnecting,
    transcript,
    durationSec,
    startVoice,
    stopVoice,
    error,
    isAvailable,
  };
}
