import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useAgents } from '../lib/hooks';
import ChatMarkdown from '../components/ChatMarkdown';
import { DISPLAY_NAME_MAP, AGENT_META } from '../lib/types';
import { Card, AgentAvatar, GradientButton } from '../components/ui';
import { MovingBorderContainer } from '../components/ui/MovingBorder';
import { apiCall, SCHEDULER_URL } from '../lib/firebase';
import { useAuth, getEmailAliases } from '../lib/auth';
import { MdAttachFile, MdImage, MdDescription, MdClose, MdVideoCall, MdCallEnd, MdAdd, MdSearch, MdDeleteOutline } from 'react-icons/md';
import { ArrowUp } from 'lucide-react';
import { HiMiniSignal, HiStop, HiMicrophone } from 'react-icons/hi2';
import { useVoiceChat } from '../lib/useVoiceChat';
import VoiceOverlay from '../components/VoiceOverlay';
import OrgChartPicker from '../components/OrgChartPicker';

interface Attachment {
  name: string;
  type: string;
  data: string;
  previewUrl?: string;
}

type ActionReceipt = { tool: string; params: Record<string, unknown>; result: 'success' | 'error'; output: string; timestamp: string; constitutional_check?: { checked: boolean; violations: number; blocked: boolean } };

interface ChatMessageMetadata {
  compactionOccurred?: boolean;
  compactionCount?: number;
  compactionSummary?: string;
}

interface Message {
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
  attachments?: Attachment[];
  /** Which agent authored this message (for multi-agent @mention threads) */
  agentRole?: string;
  actions?: ActionReceipt[];
  compactionOccurred?: boolean;
  compactionCount?: number;
  compactionSummary?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const AGENT_SPEAKER_LABELS = Array.from(
  new Set(
    Object.entries(DISPLAY_NAME_MAP).flatMap(([role, displayName]) => [role, displayName]),
  ),
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

function stripAgentSpeakerPrefix(value: string): string {
  const trimmed = value.trimStart();
  if (!trimmed || !AGENT_SPEAKER_PREFIX_RE) return trimmed;
  return trimmed.replace(AGENT_SPEAKER_PREFIX_RE, '');
}

function normalizeMessageContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'object') {
    const candidate = value as { text?: unknown; type?: unknown; agent?: unknown };
    if (typeof candidate.text === 'string') return candidate.text;
    const summary = [candidate.agent, candidate.type]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .join(' · ');
    if (summary) return summary;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** Strip <reasoning>...</reasoning> envelope from agent output */
function stripReasoning(text: string): string {
  return text.replace(/<reasoning>[\s\S]*?<\/reasoning>\s*/g, '').trim();
}

interface RecentChat {
  agentRole: string;
  lastMessage: string;
  lastMessageRole: 'user' | 'agent';
  lastTime: Date;
}

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const ALLOWED_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
  'application/json',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
];

/** Map file extensions → MIME types for browsers that don't report them correctly */
const EXT_TO_MIME: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.doc': 'application/msword',
  '.xls': 'application/vnd.ms-excel',
  '.ppt': 'application/vnd.ms-powerpoint',
};

/** File extensions used in the <input accept> attribute for better file-picker support */
const ACCEPT_EXTENSIONS = '.png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.txt,.csv,.md,.markdown,.json,.xlsx,.docx,.pptx,.doc,.xls,.ppt';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Persist a message to the database with retry */
async function saveMessage(
  agentRole: string,
  role: 'user' | 'agent',
  content: string,
  userId: string,
  attachments?: Attachment[],
  respondingAgent?: string,
  metadata?: ChatMessageMetadata,
): Promise<void> {
  const body = JSON.stringify({
    agent_role: agentRole,
    role,
    content,
    user_id: userId,
    attachments: attachments?.length ? attachments.map((a) => ({ name: a.name, type: a.type })) : null,
    ...(metadata ? { metadata, compacted: metadata.compactionOccurred === true } : {}),
    ...(respondingAgent ? { responding_agent: respondingAgent } : {}),
  });
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await apiCall('/api/chat-messages', { method: 'POST', body });
      return;
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      } else {
        throw err;
      }
    }
  }
}

function extractChatMessageMetadata(row: Record<string, unknown>): ChatMessageMetadata | undefined {
  const metadata = row.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return row.compacted === true ? { compactionOccurred: true } : undefined;
  }

  const typedMetadata = metadata as Record<string, unknown>;
  const compactionOccurred = typedMetadata.compactionOccurred === true || row.compacted === true;
  const compactionCount = typeof typedMetadata.compactionCount === 'number'
    ? typedMetadata.compactionCount
    : undefined;
  const compactionSummary = typeof typedMetadata.compactionSummary === 'string'
    ? typedMetadata.compactionSummary
    : undefined;

  if (!compactionOccurred && compactionCount === undefined && !compactionSummary) {
    return undefined;
  }

  return {
    compactionOccurred: compactionOccurred || undefined,
    compactionCount,
    compactionSummary,
  };
}

function ActionReceipts({ actions }: { actions: ActionReceipt[] }) {
  const [expanded, setExpanded] = useState(false);
  const errorCount = actions.filter(a => a.result === 'error').length;
  const label = `Actions (${actions.length} tool call${actions.length !== 1 ? 's' : ''}${errorCount > 0 ? `, ${errorCount} failed` : ''})`;

  return (
    <div className="mt-2 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-muted hover:text-foreground flex items-center gap-1"
      >
        <span>{expanded ? '▼' : '▶'}</span>
        <span>{label}</span>
      </button>
      {expanded && (
        <div className="mt-1 pl-4 border-l border-border space-y-1">
          {actions.map((action, i) => (
            <div key={i} className="font-mono">
              <span className={action.result === 'success' ? 'text-green-500' : 'text-red-500'}>
                {action.result === 'success' ? '✓' : '✗'}
              </span>{' '}
              <span className="text-foreground">{action.tool}</span>
              {action.constitutional_check?.blocked && (
                <span className="ml-2 px-1.5 py-0.5 rounded-lg text-[10px] font-semibold badge badge-red">
                  Blocked by principles
                </span>
              )}
              <div className="pl-4 text-muted truncate">{action.output}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Sidebar content (shared between mobile overlay & desktop) ── */
function SidebarContent({
  recentChats,
  sidebarItems,
  selectedRole,
  respondingAgents,
  sidebarSearch,
  setSidebarSearch,
  setSelectedRole,
  setShowOrgChart,
  onDeleteSession,
}: {
  recentChats: RecentChat[];
  sidebarItems: RecentChat[];
  selectedRole: string;
  respondingAgents: Map<string, string>;
  sidebarSearch: string;
  setSidebarSearch: (v: string) => void;
  setSelectedRole: (role: string) => void;
  setShowOrgChart: (v: boolean) => void;
  onDeleteSession: (role: string) => void;
}) {
  return (
    <>
      <div className="p-3 space-y-2">
        <button
          onClick={() => setShowOrgChart(true)}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan to-prism-fill-2 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-85"
        >
          <MdAdd size={18} />New Chat
        </button>
        {recentChats.length > 3 && (
          <div className="sidebar-glass flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
            <MdSearch size={14} className="text-txt-faint flex-shrink-0" />
            <input
              type="text"
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              placeholder="Search chats..."
              className="flex-1 bg-transparent text-[12px] text-txt-secondary placeholder-txt-faint outline-none"
            />
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {recentChats.length > 0 && (
          <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-txt-faint">
            Recent Chats
          </p>
        )}
        {sidebarItems.map((chat) => {
          const meta = AGENT_META[chat.agentRole];
          const active = chat.agentRole === selectedRole;
          const isResponding = respondingAgents.has(chat.agentRole);
          const name = DISPLAY_NAME_MAP[chat.agentRole] ?? chat.agentRole;
          return (
            <div
              key={chat.agentRole}
              className={`group flex w-full items-center gap-2 rounded-lg px-1 text-left transition-colors ${
                active ? 'bg-cyan/10' : 'hover:bg-[var(--color-hover-bg)]'
              }`}
            >
              <button
                onClick={() => setSelectedRole(chat.agentRole)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5"
              >
                <div className="relative flex-shrink-0">
                  <img
                    src={`/avatars/${chat.agentRole}.png`}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                    style={{ border: `2px solid ${meta?.color ?? '#64748b'}50` }}
                  />
                  {isResponding && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface">
                      <span className="h-2 w-2 rounded-full bg-cyan animate-pulse" />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-[13px] font-medium truncate ${active ? 'text-cyan' : 'text-txt-secondary'}`}>
                      {name}
                    </p>
                    {chat.lastMessage && (
                      <span className="text-[10px] text-txt-faint whitespace-nowrap flex-shrink-0">
                        {formatRelativeTime(chat.lastTime)}
                      </span>
                    )}
                  </div>
                  {isResponding ? (
                    <p className="text-[11px] text-cyan italic mt-0.5">Typing...</p>
                  ) : chat.lastMessage ? (
                    <p className="text-[11px] text-txt-faint truncate mt-0.5">
                      {chat.lastMessageRole === 'user' ? 'You: ' : ''}{chat.lastMessage}
                    </p>
                  ) : (
                    <p className="text-[11px] text-txt-faint italic mt-0.5">New conversation</p>
                  )}
                </div>
              </button>
              {chat.lastMessage && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(chat.agentRole);
                  }}
                  className="mr-1 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-txt-faint opacity-0 transition hover:bg-prism-bg2 hover:text-prism-critical group-hover:opacity-100"
                  aria-label={`Delete chat with ${name}`}
                  title={`Delete chat with ${name}`}
                >
                  <MdDeleteOutline size={16} />
                </button>
              )}
            </div>
          );
        })}
        {recentChats.length === 0 && !sidebarSearch && (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <p className="text-[12px] text-txt-muted mb-1">No conversations yet</p>
            <p className="text-[11px] text-txt-faint">Click <span className="text-cyan font-medium">New Chat</span> to start</p>
          </div>
        )}
      </div>
    </>
  );
}

export default function Chat({ embedded }: { embedded?: boolean } = {}) {
  const { agentId } = useParams();
  const { data: agents } = useAgents();
  const { user } = useAuth();
  const userEmail = (user?.email ?? 'unknown').toLowerCase();
  const userInitials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  const [selectedRole, setSelectedRole] = useState(() => {
    if (agentId) return agentId;
    try { return localStorage.getItem('glyphor-chat-agent') || 'chief-of-staff'; } catch { return 'chief-of-staff'; }
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [input, setInput] = useState('');
  const [respondingAgents, setRespondingAgents] = useState<Map<string, string>>(new Map());
  const [pendingFiles, setPendingFiles] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [showOrgChart, setShowOrgChart] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [saveFailed, setSaveFailed] = useState(false);

  // Voice chat
  const voice = useVoiceChat();

  // Teams call state
  const [showTeamsModal, setShowTeamsModal] = useState(false);
  const [teamsMeetingUrl, setTeamsMeetingUrl] = useState('');
  const [teamsSessionId, setTeamsSessionId] = useState<string | null>(null);
  const [teamsJoining, setTeamsJoining] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [currentMeetingUrl, setCurrentMeetingUrl] = useState<string | null>(null);

  const VOICE_GW = import.meta.env.VITE_VOICE_GATEWAY_URL || '';

  // Auto-detect current Teams meeting when running inside Teams
  useEffect(() => {
    // Only attempt detection when embedded in an iframe (Teams tab)
    let inIframe = false;
    try { inIframe = window.self !== window.top; } catch { inIframe = true; }
    if (!inIframe) return;

    let cancelled = false;
    (async () => {
      try {
        const teamsJs = await import('@microsoft/teams-js');
        await teamsJs.app.initialize();
        const ctx = await teamsJs.app.getContext();
        if (cancelled || (ctx.page?.frameContext !== 'meetingStage' && ctx.page?.frameContext !== 'sidePanel')) return;
        // We're inside a Teams meeting — try to get the join URL
        if (ctx.meeting?.id) {
          teamsJs.meeting.getMeetingDetails((err, details) => {
            if (cancelled || err || !details) return;
            const joinUrl = (details as any).details?.joinUrl || (details as any).details?.joinWebUrl;
            if (joinUrl) setCurrentMeetingUrl(joinUrl);
          });
        }
      } catch { /* not in Teams context */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const joinTeamsCall = useCallback(async (urlOverride?: string) => {
    const url = urlOverride || teamsMeetingUrl.trim();
    if (!url) return;
    setTeamsJoining(true);
    setTeamsError(null);
    try {
      const resp = await fetch(`${VOICE_GW}/voice/teams/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentRole: selectedRole, meetingUrl: url, invitedBy: userEmail }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to join');
      setTeamsSessionId(data.sessionId);
      setShowTeamsModal(false);
      setTeamsMeetingUrl('');
    } catch (e: any) {
      setTeamsError(e.message);
    } finally {
      setTeamsJoining(false);
    }
  }, [teamsMeetingUrl, selectedRole, userEmail, VOICE_GW]);

  const leaveTeamsCall = useCallback(async () => {
    if (!teamsSessionId) return;
    try {
      await fetch(`${VOICE_GW}/voice/teams/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: teamsSessionId }),
      });
    } catch { /* ignore */ }
    setTeamsSessionId(null);
  }, [teamsSessionId, VOICE_GW]);

  // Speech-to-text (dictation into textarea)
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const toggleDictation = useCallback(() => {
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Speech recognition is not supported in this browser.'); return; }
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    let finalTranscript = '';
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTranscript += t;
        else interim = t;
      }
      setInput(prev => {
        const base = prev.replace(/\u200B[\s\S]*$/, ''); // strip previous interim
        const combined = (base ? base + ' ' : '') + finalTranscript + (interim ? '\u200B' + interim : '');
        return combined.trimStart();
      });
    };
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    recognitionRef.current = rec;
    rec.start();
    setIsListening(true);
  }, [isListening]);

  // @mention state
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIdx, setMentionIdx] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedRoleRef = useRef(selectedRole);
  useEffect(() => {
    selectedRoleRef.current = selectedRole;
    try { localStorage.setItem('glyphor-chat-agent', selectedRole); } catch {}
  }, [selectedRole]);

  const FOUNDERS = [
    { role: 'kristina', name: 'Kristina', email: 'kristina@glyphor.ai' },
    { role: 'andrew', name: 'Andrew', email: 'andrew@glyphor.ai' },
  ];

  // Map logged-in user email to their founder avatar path
  const userAvatar = FOUNDERS.find((f) => f.email === userEmail)
    ? `/${FOUNDERS.find((f) => f.email === userEmail)!.role}_headshot.jpg`
    : undefined;

  const mentionables: { role: string; name: string; isFounder?: boolean }[] = [
    ...FOUNDERS.map((f) => ({ role: f.role, name: f.name, isFounder: true })),
    ...agents.map((a) => ({ role: a.role, name: DISPLAY_NAME_MAP[a.role] ?? a.role })),
  ];
  const filteredMentions = mentionFilter
    ? mentionables.filter(
        (m) =>
          m.name.toLowerCase().includes(mentionFilter.toLowerCase()) ||
          m.role.toLowerCase().includes(mentionFilter.toLowerCase()),
      )
    : mentionables;

  const userAliases = useMemo(() => getEmailAliases(userEmail), [userEmail]);

  // Load chat history
  const loadHistory = useCallback(
    async (role: string) => {
      setLoadingHistory(true);
      setMessages([]);
      try {
        // Use OR syntax so multi-alias users find messages saved under any alias
        const aliasFilter = userAliases.length > 1
          ? `or=(${userAliases.map(a => `user_id.eq.${a}`).join(',')})`
          : `user_id=${encodeURIComponent(userAliases[0])}`;
        const data = await apiCall(`/api/chat-messages?agent_role=${role}&${aliasFilter}&order=created_at.desc&limit=200`);
        if (data?.length) {
          // Reverse so oldest-first for display (we fetched newest-first to get recent messages)
          const rows = (data as Record<string, unknown>[]).reverse();
          setMessages(
            rows.map((row: Record<string, unknown>) => {
              const metadata = extractChatMessageMetadata(row);
              const role = row.role as 'user' | 'agent';
              const rawContent = normalizeMessageContent(row.content);
              return {
                role,
                content: role === 'agent' ? stripAgentSpeakerPrefix(rawContent) : rawContent,
                timestamp: new Date(row.created_at as string),
                attachments: (row.attachments as any[])?.map((a: any) => ({ name: a.name, type: a.type, data: '' })),
                agentRole: (row.responding_agent as string) || undefined,
                compactionOccurred: metadata?.compactionOccurred,
                compactionCount: metadata?.compactionCount,
                compactionSummary: metadata?.compactionSummary,
              };
            }),
          );
        }
      } catch (err) {
        console.error('[Chat] Failed to load chat history:', err);
      }
      setLoadingHistory(false);
    },
    [userAliases],
  );

  useEffect(() => { loadHistory(selectedRole); }, [selectedRole, loadHistory]);
  useEffect(() => { if (agentId) setSelectedRole(agentId); }, [agentId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Load recent chats index (which agents have conversations)
  const loadRecentChats = useCallback(async () => {
    try {
      const recentAliasFilter = userAliases.length > 1
        ? `or=(${userAliases.map(a => `user_id.eq.${a}`).join(',')})`
        : `user_id=${encodeURIComponent(userAliases[0])}`;
      const data = await apiCall(`/api/chat-messages?${recentAliasFilter}&order=created_at.desc&limit=300&fields=agent_role,role,content,created_at`);
      if (!data?.length) { setRecentChats([]); return; }
      const map = new Map<string, RecentChat>();
      for (const row of data as Record<string, unknown>[]) {
        const ar = row.agent_role as string;
        if (!map.has(ar)) {
          map.set(ar, {
            agentRole: ar,
            lastMessage: normalizeMessageContent(row.content).slice(0, 80),
            lastMessageRole: row.role as 'user' | 'agent',
            lastTime: new Date(row.created_at as string),
          });
        }
      }
      setRecentChats(Array.from(map.values()).sort((a, b) => b.lastTime.getTime() - a.lastTime.getTime()));
    } catch { setRecentChats([]); }
  }, [userAliases]);
  useEffect(() => { loadRecentChats(); }, [loadRecentChats]);

  // Sidebar items: recent chats + ensure selected agent always visible
  const sidebarItems = useMemo(() => {
    const q = sidebarSearch.toLowerCase();
    const filtered = q
      ? recentChats.filter((c) => {
          const name = (DISPLAY_NAME_MAP[c.agentRole] ?? c.agentRole).toLowerCase();
          return name.includes(q) || c.agentRole.includes(q);
        })
      : recentChats;
    const hasSelected = filtered.some((c) => c.agentRole === selectedRole);
    if (hasSelected) return filtered;
    return [
      { agentRole: selectedRole, lastMessage: '', lastMessageRole: 'user' as const, lastTime: new Date() },
      ...filtered,
    ];
  }, [recentChats, selectedRole, sidebarSearch]);

  const selectedAgent = agents.find((a) => a.role === selectedRole);
  const codename = DISPLAY_NAME_MAP[selectedRole] ?? selectedRole;

  // ── File handling ──
  const handleFiles = async (files: FileList | File[]) => {
    const newAttachments: Attachment[] = [];
    for (const file of Array.from(files)) {
      // Resolve MIME type: use browser-reported type, or fall back to extension mapping
      const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
      const resolvedType = (file.type && file.type !== 'application/octet-stream')
        ? file.type
        : EXT_TO_MIME[ext] ?? '';
      if (!ALLOWED_TYPES.includes(resolvedType)) {
        alert(`File type not supported: ${file.type || ext || file.name}`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        alert(`File too large (max 10 MB): ${file.name}`);
        continue;
      }
      const data = await fileToBase64(file);
      const previewUrl = resolvedType.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      newAttachments.push({ name: file.name, type: resolvedType, data, previewUrl });
    }
    setPendingFiles((prev) => [...prev, ...newAttachments]);
  };

  const removeFile = (idx: number) => {
    setPendingFiles((prev) => {
      const next = [...prev];
      if (next[idx]?.previewUrl) URL.revokeObjectURL(next[idx].previewUrl!);
      next.splice(idx, 1);
      return next;
    });
  };

  // ── @mention handling ──
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    const cursorPos = e.target.selectionStart ?? val.length;
    const textBefore = val.slice(0, cursorPos);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      setShowMentions(true);
      setMentionFilter(atMatch[1]);
      setMentionIdx(0);
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (m: { role: string; name: string }) => {
    const cursorPos = inputRef.current?.selectionStart ?? input.length;
    const textBefore = input.slice(0, cursorPos);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      const before = textBefore.slice(0, atMatch.index);
      const after = input.slice(cursorPos);
      setInput(`${before}@${m.name} ${after}`);
    }
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentions && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((p) => Math.min(p + 1, filteredMentions.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((p) => Math.max(p - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(filteredMentions[mentionIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setShowMentions(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      handleFiles(imageFiles);
    }
  };

  // ── Send ──
  const sendMessage = async () => {
    // Stop dictation if active and strip interim markers
    if (isListening && recognitionRef.current) recognitionRef.current.stop();
    const text = input.replace(/\u200B[\s\S]*/g, '').trim();
    if ((!text && pendingFiles.length === 0) || respondingAgents.has(selectedRole)) return;

    // Capture which agent we're sending to — this won't change even if user switches agents
    const targetRole = selectedRole;

    const attachments = pendingFiles.length > 0 ? [...pendingFiles] : undefined;
    const userMsg: Message = { role: 'user', content: text, timestamp: new Date(), attachments };
    setInput('');
    setPendingFiles([]);
    setMessages((prev) => [...prev, userMsg]);
    setRespondingAgents((prev) => new Map(prev).set(targetRole, targetRole));
    setRecentChats((prev) => {
      const without = prev.filter((c) => c.agentRole !== targetRole);
      return [{ agentRole: targetRole, lastMessage: text.slice(0, 80) || 'Sent file(s)', lastMessageRole: 'user' as const, lastTime: new Date() }, ...without];
    });

    saveMessage(targetRole, 'user', text, userEmail, attachments).catch((err) => {
      console.error('[Chat] Failed to save user message:', err);
      setSaveFailed(true);
      setTimeout(() => setSaveFailed(false), 5000);
    });

    // Extract @mentioned agent roles from the message
    const mentionPattern = /@(\w[\w\s]*?)(?=\s|$|@)/g;
    const mentionedRoles: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = mentionPattern.exec(text)) !== null) {
      const mentionText = match[1].trim();
      const found = mentionables.find(
        (m) =>
          m.name.toLowerCase() === mentionText.toLowerCase() ||
          m.role.toLowerCase() === mentionText.toLowerCase(),
      );
      if (found && !found.isFounder && found.role !== targetRole && !mentionedRoles.includes(found.role)) {
        mentionedRoles.push(found.role);
      }
    }

    // Mark all mentioned agents as responding too
    if (mentionedRoles.length > 0) {
      setRespondingAgents((prev) => {
        const next = new Map(prev);
        for (const r of mentionedRoles) next.set(r, targetRole);
        return next;
      });
    }

    /** Helper to invoke a single agent and append its response */
    const invokeAgent = async (role: string, isMentioned: boolean) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600_000);
      const agentName = DISPLAY_NAME_MAP[role] ?? role;

      try {
        const history = messages.slice(-20).map((m) => ({
          role: m.role,
          content: m.agentRole && m.role === 'agent'
            ? `[${DISPLAY_NAME_MAP[m.agentRole] ?? m.agentRole}]: ${m.content}`
            : m.content,
        }));

        const msgText = isMentioned
          ? `You were @mentioned in a conversation with ${DISPLAY_NAME_MAP[targetRole] ?? targetRole}. The user said: ${text}`
          : (text || 'Please review the attached file(s).');

        // Send attachments as structured data for native multimodal processing
        const apiAttachments = (!isMentioned && attachments) ? attachments.map((a) => ({
          name: a.name,
          mimeType: a.type,
          data: a.data,
        })) : undefined;

        const res = await fetch(`${SCHEDULER_URL}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentRole: role,
            task: 'on_demand',
            message: msgText,
            history,
            userName: user?.name,
            userEmail,
            ...(apiAttachments ? { attachments: apiAttachments } : {}),
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const responseMetadata: ChatMessageMetadata | undefined = data.compactionOccurred
          ? {
              compactionOccurred: true,
              compactionCount: typeof data.compactionCount === 'number' ? data.compactionCount : undefined,
              compactionSummary: typeof data.compactionSummary === 'string' ? data.compactionSummary : undefined,
            }
          : undefined;

        let content: string;
        if (data.output) content = stripReasoning(data.output);
        else if (data.action === 'queued_for_approval') content = `This request was sent to your approval queue for review.`;
        else if (data.status === 'aborted') content = 'Sorry, I wasn\u2019t able to finish my response. Could you try again?';
        else if (data.error || data.reason) {
          const raw = data.error || data.reason;
          // Never show API keys in the UI
          content = `Something went wrong: ${(raw as string).replace(/sk-ant-[a-zA-Z0-9_-]+|sk-[a-zA-Z0-9_-]{20,}|AIza[a-zA-Z0-9_-]+/g, '[REDACTED]')}`;
        }
        else content = `I completed the task but had nothing to report back.`;

        content = stripAgentSpeakerPrefix(content);

        // Only append to UI if user is still viewing the same agent
        if (selectedRoleRef.current === targetRole) {
          setMessages((prev) => [...prev, {
            role: 'agent',
            content,
            timestamp: new Date(),
            agentRole: isMentioned ? role : undefined,
            actions: data.actions,
            compactionOccurred: responseMetadata?.compactionOccurred,
            compactionCount: responseMetadata?.compactionCount,
            compactionSummary: responseMetadata?.compactionSummary,
          }]);
        }
        saveMessage(
          targetRole,
          'agent',
          content,
          userEmail,
          undefined,
          isMentioned ? role : undefined,
          responseMetadata,
        ).catch((err) => {
          console.error('[Chat] Failed to save agent response:', err);
          setSaveFailed(true);
          setTimeout(() => setSaveFailed(false), 5000);
        });
        if (!isMentioned) {
          setRecentChats((prev) => {
            const without = prev.filter((c) => c.agentRole !== targetRole);
            return [{ agentRole: targetRole, lastMessage: content.slice(0, 80), lastMessageRole: 'agent' as const, lastTime: new Date() }, ...without];
          });
        }
      } catch (err) {
        clearTimeout(timeoutId);
        const isTimeout = err instanceof Error && err.name === 'AbortError';
        const errContent = isTimeout
          ? `${agentName} timed out. Please try again.`
          : `Could not reach ${agentName}. Please try again in a moment.`;
        if (selectedRoleRef.current === targetRole) {
          setMessages((prev) => [...prev, { role: 'agent', content: errContent, timestamp: new Date(), agentRole: isMentioned ? role : undefined }]);
        }
      } finally {
        setRespondingAgents((prev) => { const next = new Map(prev); next.delete(role); return next; });
      }
    };

    // Invoke primary agent, then mentioned agents in parallel
    try {
      await invokeAgent(targetRole, false);
      if (mentionedRoles.length > 0) {
        await Promise.all(mentionedRoles.map((role) => invokeAgent(role, true)));
      }
    } catch {
      // Individual errors handled inside invokeAgent
    } finally {
      // Ensure primary agent is cleared even if something unexpected happened
      setRespondingAgents((prev) => { const next = new Map(prev); next.delete(targetRole); return next; });
    }
  };

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const deleteSession = useCallback(async (role: string) => {
    const name = DISPLAY_NAME_MAP[role] ?? role;
    const confirmed = window.confirm(`Delete all messages in this chat with ${name}? This cannot be undone.`);
    if (!confirmed) return;

    try {
      const params = new URLSearchParams();
      params.set('agent_role', role);
      if (userAliases.length > 1) {
        params.set('or', `(${userAliases.map((a) => `user_id.eq.${a}`).join(',')})`);
      } else {
        params.set('user_id', userAliases[0]);
      }

      await apiCall(`/api/chat-messages?${params.toString()}`, { method: 'DELETE' });

      setRecentChats((prev) => prev.filter((c) => c.agentRole !== role));

      if (selectedRoleRef.current === role) {
        setMessages([]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`Failed to delete chat: ${message}`);
    }
  }, [userAliases]);

  return (
    <div className={`flex ${embedded ? 'h-full' : 'h-[calc(100dvh-10rem-var(--sat))] md:h-[calc(100vh-6rem)]'} gap-2 md:gap-5 pb-[max(8px,var(--sat))]`}>
      {/* ── Mobile sidebar overlay ────────────── */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setMobileSidebarOpen(false)}>
          <div className="theme-overlay-backdrop absolute inset-0" />
          <div className="sidebar-glass relative z-10 flex h-full w-72 flex-col overflow-hidden border-r border-border" onClick={(e) => e.stopPropagation()}>
            <SidebarContent
              recentChats={recentChats}
              sidebarItems={sidebarItems}
              selectedRole={selectedRole}
              respondingAgents={respondingAgents}
              sidebarSearch={sidebarSearch}
              setSidebarSearch={setSidebarSearch}
              setSelectedRole={(role) => { setSelectedRole(role); setMobileSidebarOpen(false); }}
              setShowOrgChart={(v) => { setShowOrgChart(v); setMobileSidebarOpen(false); }}
              onDeleteSession={deleteSession}
            />
          </div>
        </div>
      )}
      {/* ── Chat Sidebar (Left) — desktop only ────── */}
      <div className="sidebar-glass glass-inner-layout hidden w-72 flex-shrink-0 flex-col overflow-hidden rounded-2xl border md:flex">
        <SidebarContent
          recentChats={recentChats}
          sidebarItems={sidebarItems}
          selectedRole={selectedRole}
          respondingAgents={respondingAgents}
          sidebarSearch={sidebarSearch}
          setSidebarSearch={setSidebarSearch}
          setSelectedRole={setSelectedRole}
          setShowOrgChart={setShowOrgChart}
          onDeleteSession={deleteSession}
        />
      </div>

      {/* ── Chat Area (Right) ────────────── */}
      <Card
        className={`flex flex-1 flex-col min-h-0 min-w-0 transition-all ${dragging ? 'ring-2 ring-cyan/40' : ''}`}
        onDragOver={(e: React.DragEvent) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e: React.DragEvent) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border/70 pb-3 md:gap-3 md:pb-4">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-txt-muted transition-colors hover:bg-[var(--color-hover-bg)] md:hidden"
          >
            <MdSearch size={18} />
          </button>
          <AgentAvatar role={selectedRole} size={36} glow />
          <div className="flex-1">
            <h2 className="text-[15px] font-semibold text-txt-primary">{codename}</h2>
            <p className="text-[11px] text-txt-muted">
              {selectedAgent?.role ?? selectedRole}
            </p>
          </div>
          {/* Teams call button */}
          {VOICE_GW && (
            teamsSessionId ? (
              <GradientButton
                variant="reject"
                size="sm"
                onClick={leaveTeamsCall}
                title="Remove agent from Teams call"
              >
                <MdCallEnd size={14} />
                In Call — Leave
              </GradientButton>
            ) : currentMeetingUrl ? (
              <GradientButton
                variant="primary"
                size="sm"
                onClick={() => joinTeamsCall(currentMeetingUrl)}
                disabled={teamsJoining}
                title="Add this agent to your current Teams call"
              >
                <MdVideoCall size={16} />
                {teamsJoining ? 'Joining…' : 'Add to This Call'}
              </GradientButton>
            ) : (
              <button
                onClick={() => setShowTeamsModal(true)}
                className="sidebar-glass flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-txt-muted transition-colors hover:text-cyan"
                title="Add agent to a Teams call"
              >
                <MdVideoCall size={16} />
                Teams Call
              </button>
            )
          )}
          {messages.length > 0 && (
            <button
              onClick={async () => {
                await apiCall(`/api/chat-messages?agent_role=${selectedRole}&user_id=${userEmail}`, { method: 'DELETE' });
                setMessages([]);
              }}
              className="text-[11px] text-txt-faint hover:text-rose transition-colors"
            >
              Clear Chat
            </button>
          )}
        </div>

        {/* Voice Chat Overlay — replaces messages area when voice is active */}
        <>
        {voice.isActive ? (
          <VoiceOverlay
            agentName={codename}
            agentRole={selectedRole}
            durationSec={voice.durationSec}
            transcript={voice.transcript}
            onStop={voice.stopVoice}
            error={voice.error}
          />
        ) : (
        <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0">
          {loadingHistory && (
            <div className="flex h-full items-center justify-center">
              <p className="text-[11px] text-txt-faint animate-pulse">Loading conversation…</p>
            </div>
          )}

          {!loadingHistory && messages.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-txt-muted">
                  Start a conversation with <span className="text-cyan">{codename}</span>
                </p>
                <p className="mt-1 text-[11px] text-txt-faint">
                  Drag &amp; drop, paste, or use <MdAttachFile className="inline-block text-[14px]" /> to attach files • Type <span className="text-cyan">@</span> to mention agents
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            const msgAgent = msg.agentRole || selectedRole;
            const msgAgentName = DISPLAY_NAME_MAP[msgAgent] ?? msgAgent;
            const isMentionedAgent = msg.role === 'agent' && msg.agentRole && msg.agentRole !== selectedRole;
            return (
            <div
              key={i}
              className={`flex gap-3 animate-fade-up ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              {msg.role === 'agent' ? (
                <AgentAvatar role={msgAgent} size={28} />
              ) : userAvatar ? (
                <img src={userAvatar} alt="" className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan/20 text-[11px] font-bold text-cyan">
                  {userInitials}
                </div>
              )}
              <div
                className={`max-w-[85%] md:max-w-[70%] rounded-xl px-3 py-2 md:px-4 md:py-2.5 text-[13px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'text-txt-primary'
                    : 'chat-bubble-agent glass-panel panel-nested border border-border text-txt-secondary'
                }`}
              >
                {/* Attachment chips */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {msg.attachments.map((att, j) => (
                      <div key={j} className="flex items-center gap-1.5 rounded-md bg-base/50 px-2 py-1">
                        {att.previewUrl ? (
                          <img src={att.previewUrl} alt={att.name} className="h-10 w-10 rounded object-cover" />
                        ) : att.type.startsWith('image/') ? (
                          <MdImage className="text-[14px] text-txt-muted" />
                        ) : (
                          <MdDescription className="text-[14px] text-txt-muted" />
                        )}
                        <span className="text-[11px] text-txt-muted truncate max-w-[120px]">{att.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {isMentionedAgent && (
                  <p className="mb-1 text-[10px] font-semibold" style={{ color: AGENT_META[msgAgent]?.color ?? '#06b6d4' }}>
                    {msgAgentName}
                  </p>
                )}
                {msg.role === 'agent' ? (
                  <ChatMarkdown>{msg.content}</ChatMarkdown>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
                {msg.role === 'agent' && msg.compactionOccurred && (
                  <div
                    className="mt-1 text-[11px] italic text-txt-faint"
                    title={msg.compactionSummary || 'Earlier conversation context was summarized by the provider.'}
                  >
                    Context summarized{msg.compactionCount && msg.compactionCount > 1 ? ` (${msg.compactionCount} events)` : ''} — earlier messages compressed
                  </div>
                )}
                {msg.actions && msg.actions.length > 0 && <ActionReceipts actions={msg.actions} />}
                <p className="mt-1.5 text-[10px] text-txt-faint">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
            );
          })}

          {Array.from(respondingAgents.entries()).filter(([_, targetChat]) => targetChat === selectedRole).map(([respondingRole]) => (
            <div key={respondingRole} className="flex gap-3">
              <AgentAvatar role={respondingRole} size={28} />
              <div className="chat-bubble-agent rounded-xl border border-border px-4 py-3">
                <div className="flex items-center gap-1.5">
                  {respondingRole !== selectedRole && (
                    <span className="text-[10px] font-semibold mr-1" style={{ color: AGENT_META[respondingRole]?.color ?? '#06b6d4' }}>
                      {DISPLAY_NAME_MAP[respondingRole] ?? respondingRole}
                    </span>
                  )}
                  <span className="animate-breathe h-1.5 w-1.5 rounded-full bg-cyan" style={{ animationDelay: '0ms' }} />
                  <span className="animate-breathe h-1.5 w-1.5 rounded-full bg-cyan" style={{ animationDelay: '200ms' }} />
                  <span className="animate-breathe h-1.5 w-1.5 rounded-full bg-cyan" style={{ animationDelay: '400ms' }} />
                </div>
              </div>
            </div>
          ))}

          {dragging && (
            <div className="flex h-24 items-center justify-center rounded-xl border-2 border-dashed border-cyan/40 bg-cyan/5">
              <p className="text-sm text-cyan">Drop files here</p>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
        )}

        {/* Pending files */}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 pt-2">
            {pendingFiles.map((f, i) => (
              <div key={i} className="sidebar-glass flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5">
                {f.previewUrl ? (
                  <img src={f.previewUrl} alt={f.name} className="h-8 w-8 rounded object-cover" />
                ) : (
                  <MdDescription className="text-[14px] text-txt-muted" />
                )}
                <span className="text-[11px] text-txt-secondary truncate max-w-[100px]">{f.name}</span>
                <button onClick={() => removeFile(i)} className="ml-1 text-txt-faint hover:text-rose transition-colors"><MdClose className="text-[14px]" /></button>
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="pt-3 pb-[max(10px,var(--sat))] relative shrink-0">
          {/* @mention dropdown */}
          {showMentions && filteredMentions.length > 0 && (
            <div className="dropdown-panel sidebar-glass absolute bottom-full left-0 z-10 mb-1 max-h-48 w-64 overflow-y-auto rounded-lg">
              {filteredMentions.map((m, i) => (
                <button
                  key={m.role}
                  onClick={() => insertMention(m)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors ${
                    i === mentionIdx ? 'bg-cyan/10 text-cyan' : 'text-txt-secondary hover:bg-[var(--color-hover-bg)]'
                  }`}
                >
                  {m.isFounder ? (
                    <img src={`/${m.role}_headshot.jpg`} alt={m.name} className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <AgentAvatar role={m.role} size={20} />
                  )}
                  <span className="font-medium">{m.name}</span>
                  <span className="text-txt-faint ml-auto text-[10px]">{m.isFounder ? 'Founder' : m.role}</span>
                </button>
              ))}
            </div>
          )}

          <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept={`${ALLOWED_TYPES.join(',')},${ACCEPT_EXTENSIONS}`}
              onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }}
            />
            {saveFailed && (
              <div className="absolute -top-8 left-0 right-0 text-center text-[11px] text-prism-critical animate-pulse">
                Message failed to save — your history may be incomplete
              </div>
            )}
          <MovingBorderContainer
            borderRadius="1rem"
            containerClassName="w-full"
            innerClassName="flex-col items-stretch"
          >
            {/* Textarea */}
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={`Message ${codename}... (@ to mention, Shift+Enter for new line)`}
              disabled={respondingAgents.has(selectedRole)}
              rows={2}
              className="w-full bg-transparent resize-none px-4 pt-3.5 pb-1 text-[14px] text-txt-secondary placeholder-txt-faint outline-none transition-colors disabled:opacity-50 min-h-[72px] max-h-[180px]"
              onInput={(e) => { const el = e.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; }}
            />

            {/* Bottom toolbar */}
            <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1">
              {/* Left actions */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-shrink-0 w-[34px] h-[34px] flex items-center justify-center rounded-full text-txt-muted hover:text-cyan hover:bg-white/5 transition-colors"
                  title="Attach file"
                >
                  <MdAttachFile className="text-[16px]" />
                </button>
                <button
                  type="button"
                  onClick={toggleDictation}
                  className={`hidden md:flex flex-shrink-0 w-[34px] h-[34px] items-center justify-center rounded-full transition-all ${
                    isListening
                      ? 'bg-prism-critical text-white shadow-lg shadow-prism-critical/25 animate-pulse'
                      : 'text-txt-muted hover:text-cyan hover:bg-white/5'
                  }`}
                  title={isListening ? 'Stop dictation' : 'Dictate (speech to text)'}
                >
                  <HiMicrophone size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (voice.isActive) voice.stopVoice();
                    else voice.startVoice(selectedRole, userEmail);
                  }}
                  disabled={voice.isConnecting}
                  className={`hidden md:flex flex-shrink-0 w-[34px] h-[34px] items-center justify-center rounded-full transition-all ${
                    voice.isActive
                      ? 'bg-prism-fill-2 text-white shadow-lg shadow-prism-fill-2/25 hover:bg-prism-critical hover:shadow-prism-critical/25'
                      : voice.isConnecting
                        ? 'bg-prism-elevated/20 text-prism-elevated animate-pulse'
                        : 'text-txt-muted hover:text-cyan hover:bg-white/5'
                  }`}
                  title={voice.isActive ? 'End voice chat' : 'Start voice chat'}
                >
                  {voice.isActive ? (
                    <HiStop size={16} />
                  ) : (
                    <HiMiniSignal size={16} />
                  )}
                </button>
              </div>

              {/* Right – send */}
              <button
                type="button"
                onClick={sendMessage}
                disabled={respondingAgents.has(selectedRole) || (!input.trim() && pendingFiles.length === 0)}
                className="flex-shrink-0 w-[34px] h-[34px] flex items-center justify-center rounded-full text-txt-muted hover:text-cyan hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Send message"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </MovingBorderContainer>
        </div>
        </>
      </Card>

      {/* Teams Call Modal */}
      {showTeamsModal && (
        <div className="modal-shell" onClick={() => setShowTeamsModal(false)}>
          <div className="modal-panel max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-txt-primary flex items-center gap-2">
                <MdVideoCall size={20} className="text-cyan" />
                Add {codename} to Teams Call
              </h3>
              <button onClick={() => setShowTeamsModal(false)} className="text-txt-faint hover:text-txt-primary transition-colors">
                <MdClose size={18} />
              </button>
            </div>
            <p className="text-[12px] text-txt-muted mb-4">
              Paste a Teams meeting join link and {codename} will join the call with voice, listen, and respond in real-time.
            </p>
            {currentMeetingUrl && (
              <GradientButton
                variant="primary"
                size="md"
                className="w-full mb-3 flex items-center gap-2"
                onClick={() => { joinTeamsCall(currentMeetingUrl); }}
                disabled={teamsJoining}
              >
                <span className="flex items-center gap-2"><MdVideoCall size={18} />{teamsJoining ? 'Joining…' : 'Add to current meeting'}</span>
              </GradientButton>
            )}
            <div className="flex items-center gap-2 mb-3">
              {currentMeetingUrl && <span className="text-[10px] text-txt-faint uppercase tracking-wider">or paste a link</span>}
            </div>
            <input
              type="text"
              value={teamsMeetingUrl}
              onChange={(e) => setTeamsMeetingUrl(e.target.value)}
              placeholder="https://teams.microsoft.com/l/meetup-join/..."
              className="sidebar-glass mb-3 w-full rounded-lg border border-border px-4 py-2.5 text-[13px] text-txt-secondary placeholder-txt-faint outline-none focus:border-cyan/40"
              onKeyDown={(e) => { if (e.key === 'Enter') joinTeamsCall(); }}
              autoFocus
            />
            {teamsError && (
              <p className="text-[11px] text-prism-critical mb-3">{teamsError}</p>
            )}
            <div className="flex justify-end gap-2">
              <GradientButton variant="neutral" size="md" onClick={() => setShowTeamsModal(false)}>
                Cancel
              </GradientButton>
              <GradientButton
                variant="primary"
                size="md"
                onClick={() => joinTeamsCall()}
                disabled={teamsJoining || !teamsMeetingUrl.trim()}
              >
                {teamsJoining ? 'Joining…' : 'Join Call'}
              </GradientButton>
            </div>
          </div>
        </div>
      )}

      {/* Org Chart Picker */}
      {showOrgChart && (
        <OrgChartPicker
          agents={agents}
          onSelect={(role) => { setSelectedRole(role); setShowOrgChart(false); }}
          onClose={() => setShowOrgChart(false)}
        />
      )}
    </div>
  );
}
