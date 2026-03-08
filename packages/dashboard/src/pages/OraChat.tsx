import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Markdown from 'react-markdown';
import { Orbit } from 'lucide-react';
import { apiCall, SCHEDULER_URL } from '../lib/firebase';
import { getModelLabel, getModelsByProvider, PROVIDER_LABELS } from '../lib/models';
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
  models: {
    claude: string;
    gemini: string;
    openai: string;
  };
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

const GITHUB_REPO_OPTIONS = [
  { value: 'company', label: 'glyphor-ai-company' },
  { value: 'fuse', label: 'glyphor-ai-spark-c03e7e1a' },
  { value: 'pulse', label: 'glyphor-ally-ai' },
] as const;

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

function triangulationModelSummary(models?: TriangulationResult['models']) {
  if (!models) return 'Claude, Gemini, and GPT-5';
  return [models.claude, models.gemini, models.openai].map(getModelLabel).join(', ');
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
  const [triangulationModels, setTriangulationModels] = useState({
    claude: 'claude-opus-4-6',
    gemini: 'gemini-3.1-pro-preview',
    openai: 'gpt-5.4',
  });
  const [selectedGithubRepos, setSelectedGithubRepos] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [features, setFeatures] = useState<Features>({
    deepThinking: false,
    webSearch: false,
    knowledgeBase: true,
  });
  const modelGroups = useMemo(() => getModelsByProvider(), []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const conversationId = useMemo(() => `ora-${userEmail}`, [userEmail]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, phase]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [menuOpen]);

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
    setMenuOpen(false);
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
          triangulationModels: mode === 'triangulated' ? triangulationModels : undefined,
          githubRepos: selectedGithubRepos.length ? selectedGithubRepos : undefined,
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
  }, [input, attachments, features, conversationId, userEmail, phase, mode, selectedModel, selectedGithubRepos, triangulationModels]);

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
  const githubEnabled = selectedGithubRepos.length > 0;
  const toggleGithubRepo = useCallback((repo: string) => {
    setSelectedGithubRepos((prev) => prev.includes(repo) ? prev.filter((item) => item !== repo) : [...prev, repo]);
  }, []);
  const activeMenuCount =
    (mode === 'single-model' ? 1 : 0)
    + (features.deepThinking ? 1 : 0)
    + (features.webSearch ? 1 : 0)
    + (features.knowledgeBase ? 1 : 0)
    + selectedGithubRepos.length;

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
                        {msg.metadata.triangulation.tier.toLowerCase()} triangulation completed in {completedDurationLabel(msg.metadata.triangulation)} using {triangulationModelSummary(msg.metadata.triangulation.models)}.
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
      <div className="relative mt-2 rounded-xl border border-prism-border bg-prism-card p-3" ref={menuRef}>
        <div className="mb-2 flex items-center justify-between text-[11px] text-prism-tertiary">
          <div className="flex items-center gap-2">
            <span>{mode === 'triangulated' ? 'Triangulated' : 'Single-model'}</span>
            {mode === 'single-model' && <span>{getModelLabel(selectedModel)}</span>}
            {mode === 'triangulated' && <span>{triangulationModelSummary(triangulationModels)}</span>}
          </div>
          <div className="flex items-center gap-2">
            {features.deepThinking && <span>Deep reasoning</span>}
            {features.webSearch && <span>Web</span>}
            {features.knowledgeBase && <span>KB</span>}
            {githubEnabled && <span>{selectedGithubRepos.length} GitHub</span>}
          </div>
        </div>

        {menuOpen && (
          <div className="absolute bottom-full left-0 z-20 mb-2 w-[340px] rounded-xl border border-prism-border bg-prism-card p-3 shadow-prism-lg">
            <div className="space-y-3 text-[12px] text-prism-secondary">
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-prism-tertiary">Mode</div>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as OraMode)}
                  disabled={isLoading}
                  className="w-full rounded-lg border border-prism-border bg-prism-bg2 px-3 py-2 text-[12px] text-prism-primary outline-none focus:border-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="triangulated">Triangulated</option>
                  <option value="single-model">Single-model</option>
                </select>
              </div>

              {mode === 'single-model' && (
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wider text-prism-tertiary">Model</div>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    disabled={isLoading}
                    className="w-full rounded-lg border border-prism-border bg-prism-bg2 px-3 py-2 text-[12px] text-prism-primary outline-none focus:border-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-50"
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

              {mode === 'triangulated' && (
                <div>
                  <div className="mb-1 text-[11px] uppercase tracking-wider text-prism-tertiary">Triangulation Models</div>
                  <div className="space-y-2 rounded-lg border border-prism-border bg-prism-bg2 p-2.5">
                    <div>
                      <div className="mb-1 text-[11px] text-prism-tertiary">Anthropic slot</div>
                      <select
                        value={triangulationModels.claude}
                        onChange={(e) => setTriangulationModels((prev) => ({ ...prev, claude: e.target.value }))}
                        disabled={isLoading}
                        className="w-full rounded-lg border border-prism-border bg-prism-card px-3 py-2 text-[12px] text-prism-primary outline-none focus:border-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {modelGroups.anthropic.map((modelOption) => (
                          <option key={modelOption.value} value={modelOption.value}>{modelOption.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] text-prism-tertiary">Gemini slot</div>
                      <select
                        value={triangulationModels.gemini}
                        onChange={(e) => setTriangulationModels((prev) => ({ ...prev, gemini: e.target.value }))}
                        disabled={isLoading}
                        className="w-full rounded-lg border border-prism-border bg-prism-card px-3 py-2 text-[12px] text-prism-primary outline-none focus:border-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {modelGroups.gemini.map((modelOption) => (
                          <option key={modelOption.value} value={modelOption.value}>{modelOption.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] text-prism-tertiary">OpenAI slot</div>
                      <select
                        value={triangulationModels.openai}
                        onChange={(e) => setTriangulationModels((prev) => ({ ...prev, openai: e.target.value }))}
                        disabled={isLoading}
                        className="w-full rounded-lg border border-prism-border bg-prism-card px-3 py-2 text-[12px] text-prism-primary outline-none focus:border-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {modelGroups.openai.map((modelOption) => (
                          <option key={modelOption.value} value={modelOption.value}>{modelOption.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="text-[11px] text-prism-tertiary">
                      Router stays on Gemini 3 Flash. Judge stays on Claude Sonnet 4.6.
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-prism-tertiary">Sources</div>
                <div className="space-y-2 rounded-lg border border-prism-border bg-prism-bg2 p-2.5">
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <span>Deep Reasoning</span>
                    <input type="checkbox" checked={features.deepThinking} onChange={() => toggleFeature('deepThinking')} disabled={isLoading} className="h-4 w-4 accent-cyan-400" />
                  </label>
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <span>Web Search</span>
                    <input type="checkbox" checked={features.webSearch} onChange={() => toggleFeature('webSearch')} disabled={isLoading} className="h-4 w-4 accent-cyan-400" />
                  </label>
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <span>Knowledge Base</span>
                    <input type="checkbox" checked={features.knowledgeBase} onChange={() => toggleFeature('knowledgeBase')} disabled={isLoading} className="h-4 w-4 accent-cyan-400" />
                  </label>
                </div>
              </div>

              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-prism-tertiary">GitHub</div>
                <div className="rounded-lg border border-prism-border bg-prism-bg2 p-2.5">
                  <div className="mb-2 text-[11px] text-prism-tertiary">Expose only the repos selected here.</div>
                  <div className="space-y-2">
                    {GITHUB_REPO_OPTIONS.map((repo) => (
                      <label key={repo.value} className="flex items-center justify-between gap-3 cursor-pointer">
                        <span className="truncate">{repo.label}</span>
                        <input
                          type="checkbox"
                          checked={selectedGithubRepos.includes(repo.value)}
                          onChange={() => toggleGithubRepo(repo.value)}
                          disabled={isLoading}
                          className="h-4 w-4 accent-cyan-400"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-prism-tertiary">Files</div>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  disabled={isLoading}
                  className="w-full rounded-lg border border-prism-border bg-prism-bg2 px-3 py-2 text-left text-[12px] text-prism-primary transition-colors hover:border-cyan-500/30 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add files
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            disabled={isLoading}
            className={`relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-prism-border bg-prism-bg2 text-prism-secondary transition-colors hover:border-cyan-500/30 hover:text-cyan-300 ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
            aria-label="Open Ora options"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M8 3v10M3 8h10" strokeLinecap="round" />
            </svg>
            {activeMenuCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-cyan-500 px-1 text-[10px] font-semibold text-white">
                {activeMenuCount}
              </span>
            )}
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              resizeTextarea();
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Ask Ora..."
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
