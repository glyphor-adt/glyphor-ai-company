import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Markdown from 'react-markdown';
import ChatMarkdown from '../components/ChatMarkdown';
import { DISPLAY_NAME_MAP } from '../lib/types';
import { Orbit, Plus, Globe, Brain, Database, Paperclip, Copy, Check, ChevronDown, ChevronRight, Mic, MicOff, MessageSquarePlus, PanelLeftClose, PanelLeft, Search, Trash2, ArrowUp } from 'lucide-react';
import { FaGithub } from 'react-icons/fa';
import { Card } from '../components/ui';
import { MovingBorderContainer } from '../components/ui/MovingBorder';
import { apiCall, SCHEDULER_URL } from '../lib/firebase';
import { getModelLabel, getModelsByProvider, PROVIDER_LABELS, getReasoningSupport, normalizeReasoningLevel, type ReasoningLevel } from '../lib/models';
import { useAuth, getEmailAliases } from '../lib/auth';
import { useLocation, useNavigate } from 'react-router-dom';

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
  reasoningLevel?: ReasoningLevel;
}

interface SingleModelResult {
  mode: 'single-model';
  model: string;
  provider: 'gemini' | 'openai' | 'anthropic';
  durationMs: number;
  thinkingEnabled: boolean;
  reasoningLevel: ReasoningLevel;
  webSearch: boolean;
  knowledgeBase: boolean;
  deepResearch: boolean;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const AGENT_SPEAKER_LABELS = Array.from(
  new Set([
    ...Object.keys(DISPLAY_NAME_MAP),
    ...Object.values(DISPLAY_NAME_MAP),
    'ora',
    'assistant',
  ]),
)
  .filter((label) => label.trim().length > 0)
  .sort((left, right) => right.length - left.length)
  .map((label) => escapeRegExp(label));

const AGENT_SPEAKER_PREFIX_RE = AGENT_SPEAKER_LABELS.length
  ? new RegExp(
      `^(?:\\*\\*)?\\s*(?:${AGENT_SPEAKER_LABELS.join('|')})(?:\\s*\\([^\\n)]{1,80}\\))?\\s*(?:\\*\\*)?\\s*:\\s*`,
      'i',
    )
  : null;

function stripAssistantSpeakerPrefix(value: string): string {
  const trimmed = value.trimStart();
  if (!trimmed || !AGENT_SPEAKER_PREFIX_RE) return trimmed;
  return trimmed.replace(AGENT_SPEAKER_PREFIX_RE, '');
}

type StreamPhase = 'idle' | 'streaming' | 'validating' | 'evaluating' | 'complete';
type OraMode = 'triangulated' | 'single-model';

interface OraPreferences {
  mode: OraMode;
  selectedModel: string;
  triangulationModels: {
    claude: string;
    gemini: string;
    openai: string;
  };
  selectedGithubRepos: string[];
  features: Features;
}

const GITHUB_REPO_OPTIONS = [
  { value: 'company', label: 'glyphor-ai-company' },
  { value: 'fuse', label: 'glyphor-ai-spark-c03e7e1a' },
  { value: 'pulse', label: 'glyphor-ally-ai' },
] as const;

interface Features {
  reasoningLevel: ReasoningLevel;
  webSearch: boolean;
  knowledgeBase: boolean;
  deepResearch: boolean;
}

interface OraNavigationState {
  prefillPrompt?: string;
}

type MenuFlyout = 'model' | 'type' | null;

/* ── Session types ────────────────────────────────── */

interface OraSession {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
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

/* Map raw DB metadata to the frontend Message['metadata'] shape.
   DB stores flat objects; the UI expects { triangulation, singleModel, tier }. */
function normalizeMetadata(raw: unknown): Message['metadata'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  // Already in canonical frontend format
  if (r.triangulation || r.singleModel) return r as Message['metadata'];
  // Single-model format: { mode: 'single-model', modelRun: {...} }
  if (r.mode === 'single-model' && r.modelRun) {
    return { singleModel: r.modelRun as SingleModelResult };
  }
  // Triangulated format: flat { scores, reasoning, selectedProvider, ... }
  if (r.scores || r.selectedProvider || r.reasoning) {
    return { triangulation: r as unknown as TriangulationResult, tier: (r.tier as QueryTier) ?? undefined };
  }
  return r as Message['metadata'];
}

function oraPreferencesStorageKey(userEmail: string) {
  return `ora-preferences:${userEmail}`;
}

function formatComposerMode(mode: OraMode) {
  return mode === 'triangulated' ? 'Triangulated' : 'Single model';
}

function formatThinkingMode(reasoningLevel: ReasoningLevel) {
  switch (reasoningLevel) {
    case 'deep':
      return 'Deep reasoning';
    case 'standard':
      return 'Reasoning';
    default:
      return 'Standard';
  }
}

function getReasoningSubtitle(reasoningLevel: ReasoningLevel) {
  switch (reasoningLevel) {
    case 'deep':
      return 'Use the highest available thinking depth';
    case 'standard':
      return 'Use the model\'s regular reasoning mode';
    default:
      return 'Respond without extra thinking where supported';
  }
}

function getSharedReasoningLevels(models: string[]): { levels: ReasoningLevel[]; defaultLevel: ReasoningLevel } {
  const sharedLevels = models.reduce<ReasoningLevel[] | null>((current, model) => {
    const levels = getReasoningSupport(model).levels;
    if (!current) return [...levels];
    return current.filter((level) => levels.includes(level));
  }, null) ?? ['standard'];

  if (sharedLevels.length === 0) {
    return { levels: ['standard'] as ReasoningLevel[], defaultLevel: 'standard' as ReasoningLevel };
  }

  const preferredDefault: ReasoningLevel = sharedLevels.includes('deep')
    ? 'deep'
    : sharedLevels.includes('standard')
      ? 'standard'
      : 'none';

  return { levels: sharedLevels, defaultLevel: preferredDefault };
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
            const providerError = tri.allResponses?.[provider]?.startsWith('[ERROR:')
              ? tri.allResponses[provider].slice(8, -1)
              : null;
            return (
              <div key={provider}>
                <button
                  onClick={() => setExpandedProvider(expandedProvider === provider ? null : provider)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  {isSelected && <span className="text-cyan-400">★</span>}
                  <span className={`text-[12px] font-medium capitalize ${isSelected ? 'text-cyan-400' : providerError ? 'text-red-400' : 'text-prism-secondary'}`}>
                    {provider}
                  </span>
                  {providerError ? (
                    <span className="flex-1 text-[11px] text-red-400/70 truncate">unavailable</span>
                  ) : (
                    <>
                      <div className="flex-1">
                        <div className="h-2 rounded-full bg-prism-bg2">
                          <div
                            className={`h-2 rounded-full ${isSelected ? 'bg-cyan-400' : 'bg-prism-tertiary'}`}
                            style={{ width: `${scores.total}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-[11px] text-prism-tertiary">{scores.total}</span>
                    </>
                  )}
                </button>

                {/* Error details or dimension scores */}
                {expandedProvider === provider && providerError && (
                  <div className="ml-6 mt-2 rounded-lg bg-red-900/20 border border-red-500/30 p-2">
                    <p className="text-[11px] text-red-400">{providerError}</p>
                  </div>
                )}
                {expandedProvider === provider && !providerError && (
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

function ReasoningPanel({ reasoning }: { reasoning: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-4 rounded-2xl border border-prism-border bg-prism-bg2/60">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <Brain className="h-4 w-4 text-cyan-400" />
        <span className="text-[12px] font-medium text-prism-primary">Reasoning</span>
        <span className="text-[11px] text-prism-tertiary">{expanded ? 'Hide' : 'Show'}</span>
        <ChevronDown className={`ml-auto h-4 w-4 text-prism-tertiary transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="border-t border-prism-border px-4 py-4">
          <div className="prose-chat text-[12px] text-prism-tertiary">
            <Markdown>{reasoning}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuAction({
  icon,
  title,
  subtitle,
  active = false,
  onClick,
  disabled = false,
  trailing,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-prism-bg2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${active ? 'bg-cyan-500/12 text-cyan-300' : 'bg-prism-bg2 text-prism-tertiary'}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] ${active ? 'text-cyan-300' : 'text-prism-primary'}`}>{title}</div>
        {subtitle ? <div className="text-[11px] text-prism-tertiary">{subtitle}</div> : null}
      </div>
      {trailing ?? (active ? <Check className="h-4 w-4 text-cyan-400" /> : null)}
    </button>
  );
}

/* ── Main Component ───────────────────────────────── */

const FOUNDERS = [
  { role: 'kristina', name: 'Kristina', email: 'kristina@glyphor.ai' },
  { role: 'andrew', name: 'Andrew', email: 'andrew@glyphor.ai' },
];

export default function OraChat() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const userEmail = (user?.email ?? 'unknown').toLowerCase();
  const userAliases = useMemo(() => getEmailAliases(userEmail), [userEmail]);
  const userInitials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '??';
  const userAvatar = FOUNDERS.find((f) => f.email === userEmail)
    ? `/${FOUNDERS.find((f) => f.email === userEmail)!.role}_headshot.jpg`
    : undefined;

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
  const [menuFlyout, setMenuFlyout] = useState<MenuFlyout>(null);
  const [hasLoadedPreferences, setHasLoadedPreferences] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [features, setFeatures] = useState<Features>({
    reasoningLevel: 'deep',
    webSearch: false,
    knowledgeBase: true,
    deepResearch: false,
  });
  const modelGroups = useMemo(() => getModelsByProvider(), []);

  // Session state
  const [sessions, setSessions] = useState<OraSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessionSearch, setSessionSearch] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const sendingRef = useRef(false);

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

  useEffect(() => {
    if (!menuOpen) {
      setMenuFlyout(null);
    }
  }, [menuOpen]);

  useEffect(() => {
    const state = location.state as OraNavigationState | null;
    const prefillPrompt = typeof state?.prefillPrompt === 'string' ? state.prefillPrompt.trim() : '';
    if (!prefillPrompt) return;

    setInput((current) => (current.trim().length > 0 ? current : prefillPrompt));
    window.setTimeout(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }, 0);

    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate]);

  const copyMessage = useCallback(async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, 1500);
    } catch {
      // Ignore clipboard failures
    }
  }, []);

  const toggleDictation = useCallback(() => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let index = 0; index < event.results.length; index++) {
        transcript += event.results[index][0]?.transcript ?? '';
      }
      setInput(transcript.trimStart());
      window.setTimeout(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
      }, 0);
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening]);

  // Auto-resize textarea
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, []);

  // Load sessions list on mount
  useEffect(() => {
    (async () => {
      try {
        const aliasFilter = userAliases.length > 1
          ? `or=(${userAliases.map(a => `user_id.eq.${a}`).join(',')})`
          : `user_id=eq.${encodeURIComponent(userAliases[0])}`;
        const data = await apiCall<OraSession[]>(`/api/ora-sessions?${aliasFilter}&order=updated_at.desc&limit=100`);
        if (data?.length) {
          setSessions(data);
          setActiveSessionId(data[0].id);
        }
      } catch {
        // Session load failed silently
      }
    })();
  }, [userAliases]);

  // Load messages when active session changes
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    // Skip DB reload if we're in the middle of sending — messages are already in state
    if (sendingRef.current) return;
    (async () => {
      try {
        const data = await apiCall<Array<{
          role: string;
          content: string;
          created_at: string;
          metadata?: Message['metadata'];
          attachments?: Attachment[];
        }>>(`/api/chat-messages?agent_role=eq.ora&session_id=eq.${activeSessionId}&order=created_at.asc&limit=200`);
        if (data?.length) {
          setMessages(
            data.map((m) => ({
              id: nextId(),
              role: m.role === 'user' ? 'user' : 'assistant',
              content: m.role === 'user' ? m.content : stripAssistantSpeakerPrefix(m.content),
              timestamp: new Date(m.created_at),
              attachments: m.attachments,
              metadata: normalizeMetadata(m.metadata),
            })),
          );
        } else {
          setMessages([]);
        }
      } catch {
        setMessages([]);
      }
    })();
  }, [activeSessionId]);

  useEffect(() => {
    if (typeof window === 'undefined' || !userEmail) return;

    try {
      const raw = window.localStorage.getItem(oraPreferencesStorageKey(userEmail));
      if (!raw) {
        setHasLoadedPreferences(true);
        return;
      }

      const parsed = JSON.parse(raw) as Partial<OraPreferences>;

      if (parsed.mode === 'triangulated' || parsed.mode === 'single-model') {
        setMode(parsed.mode);
      }
      if (typeof parsed.selectedModel === 'string') {
        setSelectedModel(parsed.selectedModel);
      }
      if (parsed.triangulationModels) {
        setTriangulationModels((prev) => ({
          claude: typeof parsed.triangulationModels?.claude === 'string' ? parsed.triangulationModels.claude : prev.claude,
          gemini: typeof parsed.triangulationModels?.gemini === 'string' ? parsed.triangulationModels.gemini : prev.gemini,
          openai: typeof parsed.triangulationModels?.openai === 'string' ? parsed.triangulationModels.openai : prev.openai,
        }));
      }
      if (Array.isArray(parsed.selectedGithubRepos)) {
        setSelectedGithubRepos(parsed.selectedGithubRepos.filter((value): value is string => typeof value === 'string'));
      }
      if (parsed.features) {
        setFeatures((prev) => ({
          reasoningLevel: typeof (parsed.features as { reasoningLevel?: unknown }).reasoningLevel === 'string'
            ? normalizeReasoningLevel(selectedModel, (parsed.features as { reasoningLevel?: ReasoningLevel }).reasoningLevel)
            : typeof (parsed.features as { deepThinking?: unknown }).deepThinking === 'boolean'
              ? ((parsed.features as { deepThinking?: boolean }).deepThinking ? 'deep' : prev.reasoningLevel)
              : prev.reasoningLevel,
          webSearch: typeof parsed.features?.webSearch === 'boolean' ? parsed.features.webSearch : prev.webSearch,
          knowledgeBase: typeof parsed.features?.knowledgeBase === 'boolean' ? parsed.features.knowledgeBase : prev.knowledgeBase,
          deepResearch: typeof (parsed.features as { deepResearch?: unknown }).deepResearch === 'boolean'
            ? Boolean((parsed.features as { deepResearch?: boolean }).deepResearch)
            : prev.deepResearch,
        }));
      }
    } catch {
      // Ignore malformed local preferences
    } finally {
      setHasLoadedPreferences(true);
    }
  }, [userEmail]);

  useEffect(() => {
    if (typeof window === 'undefined' || !userEmail || !hasLoadedPreferences) return;

    const preferences: OraPreferences = {
      mode,
      selectedModel,
      triangulationModels,
      selectedGithubRepos,
      features,
    };

    window.localStorage.setItem(oraPreferencesStorageKey(userEmail), JSON.stringify(preferences));
  }, [userEmail, hasLoadedPreferences, mode, selectedModel, triangulationModels, selectedGithubRepos, features]);

  const activeReasoningSupport = useMemo(() => {
    if (mode === 'single-model') {
      return getReasoningSupport(selectedModel);
    }
    return getSharedReasoningLevels([
      triangulationModels.claude,
      triangulationModels.gemini,
      triangulationModels.openai,
    ]);
  }, [mode, selectedModel, triangulationModels]);

  useEffect(() => {
    setFeatures((prev) => {
      const normalizedLevel = activeReasoningSupport.levels.includes(prev.reasoningLevel)
        ? prev.reasoningLevel
        : activeReasoningSupport.defaultLevel;
      if (normalizedLevel === prev.reasoningLevel) return prev;
      return { ...prev, reasoningLevel: normalizedLevel };
    });
  }, [activeReasoningSupport]);

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

  // Session management
  const startNewSession = useCallback(() => {
    setActiveSessionId(null);
    setMessages([]);
    setInput('');
    setPhase('idle');
    textareaRef.current?.focus();
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await apiCall(`/api/ora-sessions?id=eq.${sessionId}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        startNewSession();
      }
    } catch {
      // Session deletion failed silently
    }
  }, [activeSessionId, startNewSession]);

  const filteredSessions = useMemo(() => {
    if (!sessionSearch.trim()) return sessions;
    const q = sessionSearch.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, sessionSearch]);

  // Send message with SSE streaming
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    if (phase !== 'idle' && phase !== 'complete') return;

    // Create a new session if none is active
    let sessionId = activeSessionId;
    if (!sessionId) {
      try {
        sendingRef.current = true;
        const created = await apiCall<OraSession>('/api/ora-sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userEmail,
            title: text.length > 80 ? text.slice(0, 80) + '...' : text,
          }),
        });
        if (created?.id) {
          sessionId = created.id;
          setActiveSessionId(sessionId);
          setSessions((prev) => [created, ...prev.filter((session) => session.id !== created.id)]);
        }
      } catch {
        // Session creation failed — proceed without session
      }
    }

    // Build conversation history from current messages (last 40 turns for context budget)
    const recentHistory = messages
      .filter((m) => m.content)
      .slice(-40)
      .map((m) => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, content: m.content }));

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
    setMenuFlyout(null);
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
          conversationId: sessionId ? `ora-session-${sessionId}` : `ora-${userEmail}`,
          sessionId,
          userId: userEmail,
          history: recentHistory,
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
                    m.id === assistantId
                      ? { ...m, content: stripAssistantSpeakerPrefix(m.content + (event.text ?? '')) }
                      : m,
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
                          content: stripAssistantSpeakerPrefix(event.data?.responseText ?? m.content),
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
                          content: stripAssistantSpeakerPrefix(event.data?.selectedResponse ?? m.content),
                          metadata: { ...m.metadata, triangulation: event.data },
                        }
                      : m,
                  ),
                );
                break;
              case 'error': {
                const rawErr = event.message ?? 'Something went wrong.';
                const safeErr = rawErr.replace(/sk-ant-[a-zA-Z0-9_-]+|sk-[a-zA-Z0-9_-]{20,}|AIza[a-zA-Z0-9_-]+/g, '[REDACTED]');
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: m.content || `Error: ${safeErr}` }
                      : m,
                  ),
                );
                setPhase('complete');
                setActiveRequestFeatures(null);
                setActiveRequestMode(null);
                setActiveRequestModel(null);
                break;
              }
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
      sendingRef.current = false;
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
      sendingRef.current = false;
    }
  }, [input, attachments, features, activeSessionId, userEmail, phase, mode, selectedModel, selectedGithubRepos, triangulationModels, messages]);

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

  const toggleFeature = useCallback((key: 'webSearch' | 'knowledgeBase' | 'deepResearch') => {
    setFeatures((prev) => {
      if (key === 'deepResearch') {
        const nextDeepResearch = !prev.deepResearch;
        return {
          ...prev,
          deepResearch: nextDeepResearch,
          webSearch: nextDeepResearch ? true : prev.webSearch,
          reasoningLevel: nextDeepResearch ? 'deep' : prev.reasoningLevel,
        };
      }
      return { ...prev, [key]: !prev[key] };
    });
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
        : activeRequestFeatures?.deepResearch
          ? activeRequestMode === 'single-model'
            ? `Running deep research with ${activeRequestModel ?? 'selected model'}...`
            : 'Running deep research across selected models...'
        : activeRequestMode === 'single-model'
          ? activeRequestFeatures?.reasoningLevel === 'deep'
            ? `Deep reasoning with ${activeRequestModel ?? 'selected model'}...`
            : activeRequestFeatures?.reasoningLevel === 'standard'
              ? `Reasoning with ${activeRequestModel ?? 'selected model'}...`
              : `Running ${activeRequestModel ?? 'selected model'}...`
          : activeRequestFeatures?.reasoningLevel === 'deep'
            ? 'Thinking deeply...'
            : activeRequestFeatures?.reasoningLevel === 'standard'
              ? 'Reasoning across selected models...'
              : 'Thinking...';
  const thinkingDetail =
    phase === 'evaluating'
      ? 'Ora is judging the responses and choosing the best one.'
      : phase === 'validating'
        ? `Received ${validatedProviders.length} ${validatedProviders.length === 1 ? 'response' : 'responses'} so far.${validatedProviders.length > 0 ? ' Checking agreement across providers now.' : ''}`
        : activeRequestFeatures?.deepResearch
          ? 'Deep research mode enables broad retrieval and multi-step synthesis. This can take longer than normal chat.'
        : activeRequestMode === 'single-model'
          ? 'Using the selected model directly without triangulation.'
          : activeRequestFeatures?.reasoningLevel === 'deep'
            ? 'Running the selected triangulation models with the highest available thinking depth.'
            : activeRequestFeatures?.reasoningLevel === 'standard'
              ? 'Running the selected triangulation models with standard reasoning.'
              : 'Preparing Ora response.';
  const githubEnabled = selectedGithubRepos.length > 0;
  const toggleGithubAccess = useCallback(() => {
    setSelectedGithubRepos((prev) => {
      if (prev.length > 0) return [];
      return [GITHUB_REPO_OPTIONS[0].value];
    });
  }, []);
  return (
    <div className="flex h-[calc(100dvh-10rem-var(--sat))] md:h-[calc(100vh-6rem)] gap-2 md:gap-5">
      {/* Session Sidebar — mobile overlay backdrop */}
      {sidebarOpen && (
        <div className="theme-overlay-backdrop fixed inset-0 z-50 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      {/* Session Sidebar — responsive: fixed overlay on mobile, inline on desktop */}
      {sidebarOpen && (
        <div className="fixed inset-y-0 left-0 z-50 w-72 flex-shrink-0 flex-col bg-black/20 backdrop-blur-2xl backdrop-saturate-150 border-r border-white/[0.06] md:relative md:inset-auto md:z-auto flex md:rounded-2xl md:border md:border-white/[0.06]" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 px-3 py-3">
            <button
              type="button"
              onClick={startNewSession}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2 text-[13px] text-prism-primary transition-colors hover:text-cyan-300"
            >
              <MessageSquarePlus className="h-4 w-4" />
              New chat
            </button>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-prism-tertiary hover:bg-prism-bg2 hover:text-prism-primary transition-colors"
              title="Hide sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>

          {/* Search */}
          <div className="px-3 py-2">
            <div className="flex items-center gap-2 rounded-lg bg-white/[0.06] px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-prism-tertiary" />
              <input
                type="text"
                placeholder="Search chats..."
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                className="w-full bg-transparent text-[12px] text-prism-primary placeholder:text-prism-tertiary outline-none"
              />
            </div>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto py-1">
            {filteredSessions.length === 0 && (
              <p className="px-3 py-4 text-center text-[12px] text-prism-tertiary">
                {sessions.length === 0 ? 'No conversations yet' : 'No matches'}
              </p>
            )}
            {filteredSessions.map((session) => (
              <div
                key={session.id}
                className={`group flex items-center gap-1 px-3 py-2.5 cursor-pointer transition-colors ${
                  activeSessionId === session.id
                    ? 'bg-cyan-500/10'
                    : 'hover:bg-prism-bg2'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveSessionId(session.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className={`truncate text-[13px] ${activeSessionId === session.id ? 'text-cyan-300 font-medium' : 'text-prism-primary'}`}>
                    {session.title}
                  </p>
                  <p className="text-[11px] text-prism-tertiary">
                    {new Date(session.updated_at).toLocaleDateString()}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-prism-tertiary opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
                  title="Delete conversation"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main chat area */}
      <Card className="flex flex-1 flex-col min-h-0 min-w-0 transition-all overflow-visible border-transparent">
        {/* Header */}
        <div className="flex items-center gap-2 md:gap-3 pb-3 md:pb-4">
          {/* Sidebar toggle — always visible on mobile, only when closed on desktop */}
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className={`flex h-9 w-9 items-center justify-center rounded-lg text-prism-tertiary hover:bg-prism-bg2 hover:text-prism-primary transition-colors ${sidebarOpen ? 'md:hidden' : ''}`}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </button>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan/20">
            <Orbit className="h-4 w-4 text-cyan" strokeWidth={1.8} />
          </div>
          <div className="flex-1">
            <h2 className="text-[15px] font-semibold text-txt-primary">Ora</h2>
            <p className="text-[11px] text-txt-muted">
              {mode === 'single-model' ? getModelLabel(selectedModel) : 'Triangulated'} · {formatThinkingMode(features.reasoningLevel)}
            </p>
          </div>
        </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-txt-muted">
                Start a conversation with <span className="text-cyan">Ora</span>
              </p>
              <p className="mt-1 text-[11px] text-txt-faint">
                Drag &amp; drop, paste, or use <Paperclip className="inline-block h-3.5 w-3.5" /> to attach files
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 animate-fade-up ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            {/* Avatar */}
            {msg.role === 'assistant' ? (
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-cyan/20">
                <Orbit className="h-3.5 w-3.5 text-cyan" strokeWidth={1.8} />
              </div>
            ) : userAvatar ? (
              <img src={userAvatar} alt="" className="h-7 w-7 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-cyan/20 text-[11px] font-bold text-cyan">
                {userInitials}
              </div>
            )}
            {/* Bubble */}
            <div
              className={`${
                msg.role === 'user'
                  ? 'max-w-[85%] rounded-xl px-3 py-2 md:px-4 md:py-2.5 text-[13px] leading-relaxed bg-cyan/10 text-txt-secondary'
                  : 'max-w-full md:max-w-[720px] text-[14px] leading-[1.7] text-txt-secondary'
              }`}
            >
              {/* Attachments */}
              {msg.attachments?.length ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  {msg.attachments.map((a, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-md bg-base/50 px-2 py-1 text-[11px] text-txt-muted">
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
                  <svg className="mt-0.5 h-4 w-4 animate-spin text-cyan" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
                    <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  <div className="min-w-0">
                    <p className="font-medium text-txt-primary">{thinkingTitle}</p>
                    <p className="mt-1 text-[12px] text-txt-faint">{thinkingDetail}</p>
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
                  <ChatMarkdown>{msg.content}</ChatMarkdown>
                  {msg.role === 'assistant' && msg.metadata?.triangulation?.reasoning && (
                    <ReasoningPanel reasoning={msg.metadata.triangulation.reasoning} />
                  )}
                  {msg.metadata?.triangulation && msg.metadata.tier !== 'SIMPLE' && completedDurationLabel(msg.metadata.triangulation) && (
                    <div className="mt-2 text-[11px] text-txt-faint">
                      {msg.metadata.triangulation.tier.toLowerCase()} triangulation completed in {completedDurationLabel(msg.metadata.triangulation)} using {triangulationModelSummary(msg.metadata.triangulation.models)}.
                    </div>
                  )}
                  {msg.metadata?.singleModel && completedSingleModelDurationLabel(msg.metadata.singleModel) && (
                    <div className="mt-2 text-[11px] text-txt-faint">
                      Single-model response from {msg.metadata.singleModel.model} in {completedSingleModelDurationLabel(msg.metadata.singleModel)}.
                    </div>
                  )}
                </>
              ) : null}

              {/* Copy button for assistant messages */}
              {msg.role === 'assistant' && msg.content && (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => copyMessage(msg.id, msg.content)}
                    className="inline-flex items-center gap-1 text-[10px] text-txt-faint hover:text-cyan transition-colors"
                  >
                    {copiedMessageId === msg.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedMessageId === msg.id ? 'Copied' : 'Copy'}
                  </button>
                  <span className="text-[10px] text-txt-faint">
                    {msg.metadata?.singleModel
                      ? getModelLabel(msg.metadata.singleModel.model)
                      : msg.metadata?.triangulation
                        ? `${msg.metadata.triangulation.selectedProvider}`
                        : ''}
                  </span>
                </div>
              )}

              {/* Triangulation panel */}
              {msg.role === 'assistant' && msg.metadata?.triangulation && msg.metadata.tier !== 'SIMPLE' && (
                <TriangulationPanel tri={msg.metadata.triangulation} />
              )}

              <p className="mt-1.5 text-[10px] text-txt-faint">
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}

        <div ref={scrollRef} />
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

      {/* Pending files */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1 pt-2">
          {attachments.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-lg bg-raised px-2.5 py-1.5">
              {a.previewUrl ? (
                <img src={a.previewUrl} alt={a.name} className="h-8 w-8 rounded object-cover" />
              ) : (
                <span>📎</span>
              )}
              <span className="text-[11px] text-txt-secondary truncate max-w-[100px]">{a.name}</span>
              <button onClick={() => removeAttachment(i)} className="ml-1 text-txt-faint hover:text-rose transition-colors">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="pt-3 relative shrink-0" ref={menuRef}>
        {/* Menu flyout (opens above) */}
        {menuOpen && (
          <div className="absolute left-0 bottom-full mb-2 z-[90] max-h-[72vh] overflow-y-auto pr-1 flex flex-col md:flex-row items-start gap-2 max-w-[calc(100vw-1.5rem)] md:max-w-none">
            <div className="w-[min(320px,calc(100vw-1.5rem))] rounded-[24px] bg-black/30 backdrop-blur-2xl backdrop-saturate-150 border border-white/[0.06] p-3 shadow-prism-lg">
              <MenuAction
                icon={<Paperclip className="h-4 w-4" />}
                title="Add files or photos"
                subtitle="Attach images, PDFs, docs, or CSVs"
                onClick={() => {
                  setMenuOpen(false);
                  fileInputRef.current?.click();
                }}
                disabled={isLoading}
              />
              <MenuAction
                icon={<Orbit className="h-4 w-4" />}
                title="Model"
                subtitle={mode === 'single-model' ? getModelLabel(selectedModel) : 'Triangulated'}
                onClick={() => setMenuFlyout('model')}
                disabled={isLoading}
                trailing={<ChevronRight className="h-4 w-4 text-prism-tertiary" />}
              />
              <MenuAction
                icon={<Brain className="h-4 w-4" />}
                title="Type"
                subtitle={formatThinkingMode(features.reasoningLevel)}
                onClick={() => setMenuFlyout('type')}
                disabled={isLoading}
                trailing={<ChevronRight className="h-4 w-4 text-prism-tertiary" />}
              />

              <div className="my-2 h-px bg-prism-border/40" />

              <MenuAction
                icon={<Database className="h-4 w-4" />}
                title="Company knowledge"
                subtitle="Search internal memory and knowledge sources"
                active={features.knowledgeBase}
                onClick={() => toggleFeature('knowledgeBase')}
                disabled={isLoading}
              />
              <MenuAction
                icon={<Search className="h-4 w-4" />}
                title="Deep research"
                subtitle="Long-running multi-step research (best with OpenAI models)"
                active={features.deepResearch}
                onClick={() => toggleFeature('deepResearch')}
                disabled={isLoading}
              />
              <MenuAction
                icon={<Globe className="h-4 w-4" />}
                title="Web search"
                subtitle="Pull live information from the web"
                active={features.webSearch}
                onClick={() => toggleFeature('webSearch')}
                disabled={isLoading}
              />
              <MenuAction
                icon={<FaGithub className="h-4 w-4" />}
                title="GitHub context"
                subtitle={githubEnabled ? `${selectedGithubRepos.length} repo${selectedGithubRepos.length === 1 ? '' : 's'} enabled` : 'Use repository context'}
                active={githubEnabled}
                onClick={toggleGithubAccess}
                disabled={isLoading}
              />
            </div>

            {menuFlyout === 'model' && (
              <div className="w-[min(384px,calc(100vw-1.5rem))] rounded-[24px] bg-black/30 backdrop-blur-2xl backdrop-saturate-150 border border-white/[0.06] p-3 shadow-prism-lg">
                <div className="mb-2 px-3 py-2">
                  <div className="text-[12px] font-medium text-prism-primary">Model</div>
                  <div className="text-[11px] text-prism-tertiary">Pick a single model or configure the triangulated trio.</div>
                </div>

                <div className="mb-3 grid grid-cols-2 gap-2 px-3">
                  <button
                    type="button"
                    onClick={() => setMode('triangulated')}
                    className={`rounded-xl px-3 py-2 text-[12px] transition-colors ${mode === 'triangulated' ? 'bg-cyan-500/10 text-cyan-300' : 'bg-prism-bg2 text-prism-secondary hover:bg-prism-bg2/80'}`}
                  >
                    Triangulated
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('single-model')}
                    className={`rounded-xl px-3 py-2 text-[12px] transition-colors ${mode === 'single-model' ? 'bg-cyan-500/10 text-cyan-300' : 'bg-prism-bg2 text-prism-secondary hover:bg-prism-bg2/80'}`}
                  >
                    Single model
                  </button>
                </div>

                {mode === 'single-model' ? (
                  <div className="max-h-80 space-y-3 overflow-y-auto px-3 pb-1">
                    {(['openai', 'anthropic', 'gemini'] as const).map((provider) => (
                      <div key={provider}>
                        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-prism-tertiary">
                          {PROVIDER_LABELS[provider]}
                        </div>
                        <div className="space-y-1.5">
                          {modelGroups[provider].map((modelOption) => (
                            <button
                              key={modelOption.value}
                              type="button"
                              onClick={() => setSelectedModel(modelOption.value)}
                              className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-[12px] transition-colors ${selectedModel === modelOption.value ? 'bg-cyan-500/10 text-cyan-300' : 'text-prism-secondary hover:bg-prism-bg2'}`}
                            >
                              <span>{modelOption.label}</span>
                              {selectedModel === modelOption.value ? <Check className="ml-auto h-4 w-4 text-cyan-400" /> : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3 px-3 pb-1">
                    <div className="rounded-2xl bg-prism-bg2/60 p-3">
                      <div className="mb-2 text-[11px] text-prism-tertiary">Claude</div>
                      <select
                        value={triangulationModels.claude}
                        onChange={(e) => setTriangulationModels((prev) => ({ ...prev, claude: e.target.value }))}
                        className="w-full rounded-xl bg-prism-card px-3 py-2 text-[12px] text-prism-primary outline-none"
                      >
                        {modelGroups.anthropic.map((modelOption) => (
                          <option key={modelOption.value} value={modelOption.value}>{modelOption.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="rounded-2xl bg-prism-bg2/60 p-3">
                      <div className="mb-2 text-[11px] text-prism-tertiary">Gemini</div>
                      <select
                        value={triangulationModels.gemini}
                        onChange={(e) => setTriangulationModels((prev) => ({ ...prev, gemini: e.target.value }))}
                        className="w-full rounded-xl bg-prism-card px-3 py-2 text-[12px] text-prism-primary outline-none"
                      >
                        {modelGroups.gemini.map((modelOption) => (
                          <option key={modelOption.value} value={modelOption.value}>{modelOption.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="rounded-2xl bg-prism-bg2/60 p-3">
                      <div className="mb-2 text-[11px] text-prism-tertiary">OpenAI</div>
                      <select
                        value={triangulationModels.openai}
                        onChange={(e) => setTriangulationModels((prev) => ({ ...prev, openai: e.target.value }))}
                        className="w-full rounded-xl bg-prism-card px-3 py-2 text-[12px] text-prism-primary outline-none"
                      >
                        {modelGroups.openai.filter((modelOption) => !modelOption.value.endsWith('-deep-research')).map((modelOption) => (
                          <option key={modelOption.value} value={modelOption.value}>{modelOption.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {menuFlyout === 'type' && (
              <div className="w-[min(320px,calc(100vw-1.5rem))] rounded-[24px] bg-black/30 backdrop-blur-2xl backdrop-saturate-150 border border-white/[0.06] p-3 shadow-prism-lg">
                <div className="mb-2 px-3 py-2">
                  <div className="text-[12px] font-medium text-prism-primary">Type</div>
                  <div className="text-[11px] text-prism-tertiary">
                    {mode === 'single-model' ? `Available for ${getModelLabel(selectedModel)}` : 'Shared across the selected triangulation models'}
                  </div>
                </div>
                <div className="space-y-1 px-3 pb-1">
                  {activeReasoningSupport.levels.map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setFeatures((prev) => ({ ...prev, reasoningLevel: level }))}
                      className={`flex w-full items-center rounded-xl px-3 py-3 text-left transition-colors ${features.reasoningLevel === level ? 'bg-cyan-500/10 text-cyan-300' : 'text-prism-secondary hover:bg-prism-bg2'}`}
                    >
                      <div>
                        <div className="text-[13px]">{formatThinkingMode(level)}</div>
                        <div className="text-[11px] text-prism-tertiary">{getReasoningSubtitle(level)}</div>
                      </div>
                      {features.reasoningLevel === level ? <Check className="ml-auto h-4 w-4 text-cyan-400" /> : null}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <MovingBorderContainer
          borderRadius="1rem"
          containerClassName="w-full"
          innerClassName="flex-col items-stretch"
        >
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                resizeTextarea();
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Ask Ora... (Shift+Enter for new line)"
              rows={2}
              className="w-full bg-transparent px-4 pt-3.5 pb-1 text-[14px] text-txt-secondary placeholder-txt-faint outline-none transition-colors disabled:opacity-50 resize-none min-h-[72px] max-h-[180px]"
              onInput={(e) => { const el = e.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; }}
              disabled={isLoading}
            />

            {/* Bottom toolbar */}
            <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1">
              {/* Left actions */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMenuOpen((prev) => !prev)}
                  disabled={isLoading}
                  className={`flex-shrink-0 w-[34px] h-[34px] flex items-center justify-center rounded-full text-txt-muted hover:text-cyan hover:bg-white/5 transition-colors ${isLoading ? 'opacity-50' : ''}`}
                  aria-label="Open Ora options"
                >
                  <Plus className={`h-4.5 w-4.5 transition-transform ${menuOpen ? 'rotate-45' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={toggleDictation}
                  disabled={isLoading}
                  className={`hidden md:flex flex-shrink-0 w-[34px] h-[34px] items-center justify-center rounded-full transition-all ${
                    isListening
                      ? 'bg-prism-critical text-white shadow-lg shadow-prism-critical/25 animate-pulse'
                      : 'text-txt-muted hover:text-cyan hover:bg-white/5'
                  } ${isLoading ? 'opacity-50' : ''}`}
                  title={isListening ? 'Stop dictation' : 'Dictate'}
                >
                  {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
              </div>

              {/* Right – send */}
              <button
                type="button"
                onClick={send}
                disabled={isLoading || (!input.trim() && attachments.length === 0)}
                className="flex-shrink-0 w-[34px] h-[34px] flex items-center justify-center rounded-full text-txt-muted hover:text-cyan hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Send message"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
        </MovingBorderContainer>
      </div>
      </Card>
    </div>
  );
}
