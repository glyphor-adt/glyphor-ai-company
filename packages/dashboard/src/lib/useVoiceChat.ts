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
      audioElRef.current.srcObject = null;
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      const pc = new RTCPeerConnection();
      peerConnectionRef.current = pc;

      // Set up audio playback for agent responses
      const audioEl = new Audio();
      audioEl.autoplay = true;
      audioElRef.current = audioEl;

      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
        audioEl.play().catch(() => { /* autoplay blocked */ });
      };

      // Add mic track to peer connection
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Create data channel for events (transcripts, function calls)
      const dc = pc.createDataChannel('oai-events');
      dataChannelRef.current = dc;

      dc.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleRealtimeEvent(msg, sessionId);
        } catch { /* ignore parse errors */ }
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
        body: offer.sdp,
      });

      if (!sdpRes.ok) {
        throw new Error(`OpenAI Realtime SDP exchange failed: ${sdpRes.status}`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

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
    }).catch(() => { /* best effort */ });
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
      }).catch(() => { /* best effort */ });
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
