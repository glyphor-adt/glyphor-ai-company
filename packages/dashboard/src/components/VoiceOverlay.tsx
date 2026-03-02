/**
 * VoiceOverlay — Displayed during an active voice chat session.
 * Shows live transcript, duration, and controls.
 */

import { type VoiceTranscriptEntry } from '../lib/useVoiceChat';

interface VoiceOverlayProps {
  agentName: string;
  agentRole: string;
  durationSec: number;
  transcript: VoiceTranscriptEntry[];
  onStop: () => void;
  error: string | null;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function VoiceOverlay({
  agentName,
  agentRole,
  durationSec,
  transcript,
  onStop,
  error,
}: VoiceOverlayProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Voice session header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img
              src={`/avatars/${agentRole}.png`}
              alt={agentName}
              className="h-10 w-10 rounded-full object-cover ring-2 ring-prism-fill-2/60"
            />
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-prism-fill-2 border-2 border-[var(--color-surface)] animate-pulse" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-txt-primary">
              Voice Chat with {agentName}
            </p>
            <p className="text-[11px] text-prism-teal font-mono">
              {formatDuration(durationSec)} · Listening…
            </p>
          </div>
        </div>
        <button
          onClick={onStop}
          className="flex items-center gap-1.5 rounded-lg bg-prism-critical/15 border border-prism-critical/30 px-3 py-1.5 text-[12px] font-medium text-prism-critical hover:bg-prism-critical/25 transition-colors"
        >
          End Voice
        </button>
      </div>

      {/* Live transcript */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {transcript.length === 0 && !error && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="flex justify-center gap-1.5 mb-3">
                <span className="animate-breathe h-2 w-2 rounded-full bg-prism-fill-2" style={{ animationDelay: '0ms' }} />
                <span className="animate-breathe h-2 w-2 rounded-full bg-prism-fill-2" style={{ animationDelay: '200ms' }} />
                <span className="animate-breathe h-2 w-2 rounded-full bg-prism-fill-2" style={{ animationDelay: '400ms' }} />
              </div>
              <p className="text-[12px] text-txt-muted">Start speaking — {agentName} is listening</p>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-prism-critical/10 border border-prism-critical/20 px-3 py-2">
            <p className="text-[12px] text-prism-critical">{error}</p>
          </div>
        )}

        {transcript.map((entry, i) => (
          <div
            key={i}
            className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                entry.role === 'user'
                  ? 'bg-cyan/10 text-txt-secondary border border-cyan/20'
                  : 'bg-raised text-txt-secondary border border-border'
              }`}
            >
              <p className="whitespace-pre-wrap">{entry.text}</p>
              <p className="mt-1 text-[10px] text-txt-faint">
                {entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Voice activity indicator */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center justify-center gap-2">
          <div className="flex gap-0.5 items-end">
            {[...Array(5)].map((_, i) => (
              <span
                key={i}
                className="w-1 bg-prism-fill-2 rounded-full animate-voice-bar"
                style={{
                  animationDelay: `${i * 100}ms`,
                  height: '8px',
                }}
              />
            ))}
          </div>
          <p className="text-[11px] text-txt-muted">Voice active · speak naturally</p>
        </div>
      </div>
    </div>
  );
}
