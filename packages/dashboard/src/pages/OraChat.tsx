import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Markdown from 'react-markdown';
import { Orbit } from 'lucide-react';
import { apiCall, SCHEDULER_URL } from '../lib/firebase';
import { getModelsByProvider, PROVIDER_LABELS } from '../lib/models';
import { useAuth, getEmailAliases } from '../lib/auth';

/* ── Triangulation types (mirrored from @glyphor/shared) ───── */

type QueryTier = 'SIMPLE' | 'STANDARD' | 'DEEP';

interface ProviderScores {
  accuracy: number;
  completeness: number;
  reasoning: number;
  relevance: number;
  actionability: number;
  total: number;
}

interface Divergence {
  claim: string;
  providersAgree: string[];
  providerDisagrees: string[];
  likelyCorrect: string;
}

interface TriangulationResult {
  tier: QueryTier;
  selectedProvider: 'claude' | 'gemini' | 'openai';
  selectedResponse: string;
  confidence: number;
  consensusLevel: 'high' | 'moderate' | 'low' | 'n/a';
  reasoning: string;
  scores: Record<string, ProviderScores | null>;
  divergences: Divergence[];
  allResponses: Record<string, string>;
  cost: { perProvider: Record<string, number>; total: number };
  latencyMs: Record<string, number>;
  durationMs?: number;
}

interface SingleModelResult {
  mode: 'single-model';
  model: string;
  provider: 'gemini' | 'openai' | 'anthropic';
  durationMs: number;
  thinkingEnabled: boolean;
  webSearch: boolean;
  knowledgeBase: boolean;
}

/* ── Types ─────────────────────────────────────────── */

interface Attachment {
  name: string;
  type: string;
  data: string;
  previewUrl?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  attachments?: Attachment[];
  metadata?: {
    tier?: QueryTier;
    triangulation?: TriangulationResult;
    singleModel?: SingleModelResult;
  };
}

type StreamPhase = 'idle' | 'streaming' | 'validating' | 'evaluating' | 'complete';
type OraMode = 'triangulated' | 'single-model';

interface Features {
  deepThinking: boolean;
  webSearch: boolean;
  knowledgeBase: boolean;
}

/* ── Helpers ───────────────────────────────────────── */

let _msgId = 0;
function nextId() {
  return `msg-${Date.now()}-${++_msgId}`;
}

function confidenceColor(c: number) {
  if (c >= 70) return 'text-cyan-400';
  if (c >= 40) return 'text-yellow-400';
  return 'text-red-400';
}

function confidenceStroke(c: number) {
  if (c >= 70) return '#22d3ee';
  if (c >= 40) return '#facc15';
  return '#f87171';
}

function formatDuration(ms?: number) {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

/* ── Triangulation Panel ──────────────────────────── */

function TriangulationPanel({ tri }: { tri: TriangulationResult }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const durationLabel = formatDuration(tri.durationMs);

  const circumference = 2 * Math.PI * 18;
  const offset = circumference - (tri.confidence / 100) * circumference;

  return (
    <div className="mt-3 rounded-xl border border-prism-border bg-prism-card p-4">
      {/* Collapsed view */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 text-left"
      >
        {/* Confidence ring */}
        <svg width="44" height="44" className="flex-shrink-0">
          <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeWidth="3" className="text-prism-border" />
          <circle
            cx="22" cy="22" r="18" fill="none"
            stroke={confidenceStroke(tri.confidence)}
            strokeWidth="3" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 22 22)"
          />
          <text x="22" y="26" textAnchor="middle" className={`text-[11px] font-bold ${confidenceColor(tri.confidence)}`} fill="currentColor">
            {tri.confidence}
          </text>
        </svg>
        <div className="min-w-0 flex-1">
          <span className="text-[13px] font-medium text-prism-primary capitalize">{tri.consensusLevel} consensus</span>
          {durationLabel && (
            <span className="ml-2 rounded-full bg-prism-bg2 px-2 py-0.5 text-[11px] text-prism-tertiary">
              {tri.tier.toLowerCase()} in {durationLabel}
            </span>
          )}
        </div>
        <svg
          className={`h-4 w-4 text-prism-tertiary transition-transform ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {/* Expanded view */}
      {expanded && (
        <div className="mt-4 space-y-4">
          {/* Provider score bars */}
          {Object.entries(tri.scores).map(([provider, scores]) => {
            if (!scores) return null;
            const isSelected = provider === tri.selectedProvider;
            return (
              <div key={provider}>
                <button
                  onClick={() => setExpandedProvider(expandedProvider === provider ? null : provider)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  {isSelected && <span className="text-cyan-400">★</span>}
                  <span className={`text-[12px] font-medium capitalize ${isSelected ? 'text-cyan-400' : 'text-prism-secondary'}`}>
                    {provider}
                  </span>
                  <div className="flex-1">
                    <div className="h-2 rounded-full bg-prism-bg2">
                      <div
                        className={`h-2 rounded-full ${isSelected ? 'bg-cyan-400' : 'bg-prism-tertiary'}`}
                        style={{ width: `${scores.total}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-[11px] text-prism-tertiary">{scores.total}</span>
                </button>

                {/* Dimension scores */}
                {expandedProvider === provider && (
                  <div className="ml-6 mt-2 grid grid-cols-5 gap-2">
                    {(['accuracy', 'completeness', 'reasoning', 'relevance', 'actionability'] as const).map((dim) => (
                      <div key={dim} className="text-center">
                        <div className="text-[10px] text-prism-tertiary capitalize">{dim}</div>
                        <div className="text-[12px] font-medium text-prism-secondary">{scores[dim]}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Divergence cards */}
          {tri.divergences.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-medium text-prism-tertiary uppercase tracking-wider">Divergences</div>
              {tri.divergences.map((d, i) => (
                <div key={i} className="rounded-lg border-l-2 border-yellow-400 bg-prism-bg2 p-3">
                  <p className="text-[12px] text-prism-primary">{d.claim}</p>
                  <p className="mt-1 text-[11px] text-prism-tertiary">
                    Agree: {d.providersAgree.join(', ')} · Disagree: {d.providerDisagrees.join(', ')}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg bg-prism-bg2 p-3 text-[12px] text-prism-tertiary">
            The response shown above is the final answer Ora selected after comparing Claude, Gemini, and GPT-5.
            <span className="ml-1 text-prism-secondary">Selected winner: {tri.selectedProvider}.</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Component ───────────────────────────────── */

export default function OraChat() {
  const { user } = useAuth();
  const userEmail = (user?.email ?? 'unknown').toLowerCase();
  const userAliases = useMemo(() => getEmailAliases(userEmail), [userEmail]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<StreamPhase>('idle');
  const [validatedProviders, setValidatedProviders] = useState<string[]>([]);
  const [activeRequestFeatures, setActiveRequestFeatures] = useState<Features | null>(null);
  const [activeRequestMode, setActiveRequestMode] = useState<OraMode | null>(null);
  const [activeRequestModel, setActiveRequestModel] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mode, setMode] = useState<OraMode>('triangulated');
  const [selectedModel, setSelectedModel] = useState('gpt-5.4');
  const [features, setFeatures] = useState<Features>({
    deepThinking: false,
    webSearch: false,
    knowledgeBase: true,
  });
  const modelGroups = useMemo(() => getModelsByProvider(), []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const conversationId = useMemo(() => `ora-${userEmail}`, [userEmail]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, phase]);

  // Auto-resize textarea
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  // Load history on mount
  useEffect(() => {
    (async () => {
      try {
        const aliasFilter = userAliases.length > 1
          ? `or=(${userAliases.map(a => `user_id.eq.${a}`).join(',')})`
          : `user_id=${encodeURIComponent(userAliases[0])}`;
        const data = await apiCall<Array<{
          role: string;
          content: string;
          created_at: string;
          metadata?: Message['metadata'];
          attachments?: Attachment[];
        }>>(`/api/chat-messages?agent_role=eq.ora&${aliasFilter}&order=created_at.asc&limit=200`);
        if (data?.length) {
          setMessages(
            data.map((m) => ({
              id: nextId(),
              role: m.role === 'user' ? 'user' : 'assistant',
              content: m.content,
              timestamp: new Date(m.created_at),
              attachments: m.attachments,
              metadata: m.metadata,
            })),
          );
        }
      } catch {
        // History load failed silently
      }
    })();
  }, [userAliases]);

  // File handling
  const addFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1] ?? '';
        setAttachments((prev) => [
          ...prev,
          { name: file.name, type: file.type, data: base64, previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined },
        ]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const removeAttachment = useCallback((idx: number) => {
    setAttachments((prev) => {
      const removed = prev[idx];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  // Paste handler for images
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith('image/'));
      if (items.length === 0) return;
      e.preventDefault();
      const files = items.map((i) => i.getAsFile()).filter(Boolean) as File[];
      addFiles(files);
    },
    [addFiles],
  );

  // Send message with SSE streaming
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (phase !== 'idle' && phase !== 'complete') return;

    const userMsg: Message = {
      id: nextId(),
      role: 'user',
      content: text,
      timestamp: new Date(),
      attachments: attachments.length ? [...attachments] : undefined,
    };
    const assistantId = nextId();
    const assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setAttachments([]);
    setPhase('streaming');
    setValidatedProviders([]);
    setActiveRequestFeatures(features);
    setActiveRequestMode(mode);
    setActiveRequestModel(mode === 'single-model' ? selectedModel : null);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const response = await fetch(`${SCHEDULER_URL}/ora/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          mode,
          selectedModel: mode === 'single-model' ? selectedModel : undefined,
          features,
          attachments: attachments.map((a) => ({ name: a.name, type: a.type, data: a.data })),
          conversationId,
          userId: userEmail,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'tier':
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, metadata: { ...m.metadata, tier: event.tier } } : m,
                  ),
                );
                break;
              case 'chunk':
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, content: m.content + (event.text ?? '') } : m,
                  ),
                );
                break;
              case 'provider_complete':
                setPhase('validating');
                setValidatedProviders((prev) => [...prev, event.provider]);
                break;
              case 'judge_start':
                setPhase('evaluating');
                break;
              case 'single_result':
                setPhase('complete');
                setActiveRequestFeatures(null);
                setActiveRequestMode(null);
                setActiveRequestModel(null);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          content: event.data?.responseText ?? m.content,
                          metadata: { ...m.metadata, singleModel: event.data?.modelRun },
                        }
                      : m,
                  ),
                );
                break;
              case 'result':
                setPhase('complete');
                setActiveRequestFeatures(null);
                setActiveRequestMode(null);
                setActiveRequestModel(null);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? {
                          ...m,
                          content: event.data?.selectedResponse ?? m.content,
                          metadata: { ...m.metadata, triangulation: event.data },
                        }
                      : m,
                  ),
                );
                break;
              case 'error':
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: m.content || `Error: ${event.message ?? 'Something went wrong.'}` }
                      : m,
                  ),
                );
                setPhase('complete');
                setActiveRequestFeatures(null);
                setActiveRequestMode(null);
                setActiveRequestModel(null);
                break;
            }
          } catch {
            // Ignore malformed events
          }
        }
      }

      // If we never got a result event, mark complete
      setPhase((p) => (p === 'complete' ? p : 'complete'));
      setActiveRequestFeatures(null);
      setActiveRequestMode(null);
      setActiveRequestModel(null);
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: 'Failed to connect to Ora. Please try again.' }
            : m,
        ),
      );
      setPhase('complete');
      setActiveRequestFeatures(null);
      setActiveRequestMode(null);
      setActiveRequestModel(null);
    }
  }, [input, attachments, features, conversationId, userEmail, phase, mode, selectedModel]);

  // Key handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  const toggleFeature = useCallback((key: keyof Features) => {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const isLoading = phase === 'streaming' || phase === 'validating' || phase === 'evaluating';
  const activeAssistantId = isLoading ? [...messages].reverse().find((m) => m.role === 'assistant')?.id ?? null : null;
  const completedDurationLabel = (triangulation?: TriangulationResult) => formatDuration(triangulation?.durationMs);
  const completedSingleModelDurationLabel = (singleModel?: SingleModelResult) => formatDuration(singleModel?.durationMs);
  const thinkingTitle =
    phase === 'evaluating'
      ? 'Selecting the strongest answer...'
      : phase === 'validating'
        ? 'Comparing model responses...'
        : activeRequestMode === 'single-model'
          ? activeRequestFeatures?.deepThinking
            ? `Deep reasoning with ${activeRequestModel ?? 'selected model'}...`
            : `Running ${activeRequestModel ?? 'selected model'}...`
          : activeRequestFeatures?.deepThinking
            ? 'Thinking deeply...'
            : 'Thinking...';
  const thinkingDetail =
    phase === 'evaluating'
      ? 'Ora is judging the responses and choosing the best one.'
      : phase === 'validating'
        ? `Received ${validatedProviders.length} ${validatedProviders.length === 1 ? 'response' : 'responses'} so far.${validatedProviders.length > 0 ? ' Checking agreement across providers now.' : ''}`
        : activeRequestMode === 'single-model'
          ? 'Using the selected model directly without triangulation.'
          : activeRequestFeatures?.deepThinking
            ? 'Running Claude, Gemini, and GPT-5 in parallel before comparing them.'
            : 'Preparing Ora response.';

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10">
          <Orbit className="h-5 w-5 text-cyan-400" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-prism-primary">Ora</h1>
          <p className="text-[12px] text-prism-tertiary">Multi-model triangulated responses</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-prism-border bg-prism-card p-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-[13px] text-prism-tertiary">Start a conversation with Ora.</p>
          </div>
        )}

        <div className="space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] rounded-xl px-4 py-2.5 text-[13px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-cyan-500/10 text-prism-secondary border border-cyan-500/20'
                    : 'bg-prism-bg2 text-prism-secondary border border-prism-border'
                }`}
              >
                {/* Attachments */}
                {msg.attachments?.length ? (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {msg.attachments.map((a, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded bg-prism-bg2 px-2 py-0.5 text-[11px] text-prism-tertiary">
                        📎 {a.name}
                      </span>
                    ))}
                  </div>
                ) : null}

                {/* Content */}
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                ) : isLoading && msg.id === activeAssistantId && !msg.content ? (
                  <div className="flex items-start gap-3">
                    <svg className="mt-0.5 h-4 w-4 animate-spin text-cyan-400" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
                      <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    <div className="min-w-0">
                      <p className="font-medium text-prism-primary">{thinkingTitle}</p>
                      <p className="mt-1 text-[12px] text-prism-tertiary">{thinkingDetail}</p>
                      {validatedProviders.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {validatedProviders.map((provider) => (
                            <span
                              key={provider}
                              className="rounded-full border border-green-500/25 bg-green-500/10 px-2 py-0.5 text-[11px] text-green-400"
                            >
                              {provider} ready
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : msg.content ? (
                  <>
                    <div className="prose-chat"><Markdown>{msg.content}</Markdown></div>
                    {msg.metadata?.triangulation && msg.metadata.tier !== 'SIMPLE' && completedDurationLabel(msg.metadata.triangulation) && (
                      <div className="mt-2 text-[11px] text-prism-tertiary">
                        {msg.metadata.triangulation.tier.toLowerCase()} triangulation completed in {completedDurationLabel(msg.metadata.triangulation)} using Claude, Gemini, and GPT-5.
                      </div>
                    )}
                    {msg.metadata?.singleModel && completedSingleModelDurationLabel(msg.metadata.singleModel) && (
                      <div className="mt-2 text-[11px] text-prism-tertiary">
                        Single-model response from {msg.metadata.singleModel.model} in {completedSingleModelDurationLabel(msg.metadata.singleModel)}.
                      </div>
                    )}
                  </>
                ) : null}

                {/* Triangulation panel */}
                {msg.role === 'assistant' && msg.metadata?.triangulation && msg.metadata.tier !== 'SIMPLE' && (
                  <TriangulationPanel tri={msg.metadata.triangulation} />
                )}
              </div>
            </div>
          ))}

          <div ref={scrollRef} />
        </div>
      </div>

      {/* Feature toggle bar */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setMode((prev) => (prev === 'triangulated' ? 'single-model' : 'triangulated'))}
          disabled={isLoading}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors border ${
            mode === 'triangulated'
              ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
              : 'bg-prism-bg2 text-prism-tertiary border-prism-border hover:text-prism-primary'
          } ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M3 4h3v3H3zM10 4h3v3h-3zM6 9h4v3H6z" />
            <path d="M6 5.5h4M8 7v2" />
          </svg>
          Triangulation
        </button>

        <button
          onClick={() => toggleFeature('deepThinking')}
          disabled={isLoading}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors border ${
            features.deepThinking
              ? 'bg-red-500/10 text-red-400 border-red-500/30'
              : 'bg-prism-bg2 text-prism-tertiary border-prism-border hover:text-prism-primary'
          } ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="8" cy="6" r="4" />
            <path d="M6 10c0 2 1 3 2 4 1-1 2-2 2-4" />
            <path d="M5 6h6" opacity="0.5" />
          </svg>
          Deep Reasoning
        </button>

        <button
          onClick={() => toggleFeature('webSearch')}
          disabled={isLoading}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors border ${
            features.webSearch
              ? 'bg-cyan/10 text-cyan border-cyan/30'
              : 'bg-prism-bg2 text-prism-tertiary border-prism-border hover:text-prism-primary'
          } ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
          Web Search
        </button>

        <button
          onClick={() => toggleFeature('knowledgeBase')}
          disabled={isLoading}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors border ${
            features.knowledgeBase
              ? 'bg-green-500/10 text-green-400 border-green-500/30'
              : 'bg-prism-bg2 text-prism-tertiary border-prism-border hover:text-prism-primary'
          } ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <path d="M5 6h6M5 9h4" />
          </svg>
          Knowledge Base
        </button>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium bg-prism-bg2 text-prism-tertiary border border-prism-border hover:text-prism-primary transition-colors ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M14 8.5c0 3-2.5 5-5 5s-5-2-5-5 2.5-5 5-5a3.5 3.5 0 013.5 3.5c0 1.5-1 2.5-2.5 2.5s-2-1-2-2V5" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/*,.pdf,.txt,.csv,.docx"
          multiple
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Attachment preview */}
      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-lg bg-prism-bg2 px-2.5 py-1.5 text-[12px] text-prism-secondary border border-prism-border">
              {a.previewUrl ? (
                <img src={a.previewUrl} alt="" className="h-6 w-6 rounded object-cover" />
              ) : (
                <span>📎</span>
              )}
              <span className="max-w-[120px] truncate">{a.name}</span>
              <button onClick={() => removeAttachment(i)} className="text-prism-tertiary hover:text-red-400 ml-1">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="mt-2 rounded-xl border border-prism-border bg-prism-card p-3">
        {mode === 'single-model' && (
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-prism-tertiary">Model</span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isLoading}
              className="min-w-[220px] rounded-lg border border-prism-border bg-prism-bg2 px-3 py-1.5 text-[12px] text-prism-secondary outline-none focus:border-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {(['openai', 'anthropic', 'gemini'] as const).map((provider) => (
                <optgroup key={provider} label={PROVIDER_LABELS[provider]}>
                  {modelGroups[provider].map((modelOption) => (
                    <option key={modelOption.value} value={modelOption.value}>{modelOption.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              resizeTextarea();
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={mode === 'triangulated' ? 'Ask Ora...' : `Ask ${selectedModel}...`}
            rows={1}
            className="flex-1 resize-none bg-transparent text-[13px] text-prism-primary placeholder:text-prism-tertiary outline-none"
            style={{ maxHeight: 160 }}
            disabled={isLoading}
          />
        <button
          onClick={send}
          disabled={isLoading || (!input.trim() && attachments.length === 0)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-500 text-white transition-colors hover:bg-cyan-600 disabled:opacity-40 disabled:hover:bg-cyan-500"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 1l14 7-14 7V9l10-1-10-1z" />
          </svg>
        </button>
        </div>
      </div>
    </div>
  );
}
