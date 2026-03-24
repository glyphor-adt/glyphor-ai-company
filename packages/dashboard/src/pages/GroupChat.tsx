import { useState, useRef, useEffect, useMemo } from 'react';
import { useAgents } from '../lib/hooks';
import ChatMarkdown from '../components/ChatMarkdown';
import { DISPLAY_NAME_MAP, AGENT_META, ROLE_DEPARTMENT, ROLE_TIER, ROLE_TITLE } from '../lib/types';
import { Card, AgentAvatar, GradientButton } from '../components/ui';
import {
  ChatComposerFrame,
  composerFooterRowClassName,
  composerIconButtonClassName,
  composerTextareaClassName,
} from '../components/ChatComposer';
import { apiCall, SCHEDULER_URL } from '../lib/firebase';
import { useAuth } from '../lib/auth';
import { MdAttachFile, MdImage, MdDescription, MdClose, MdSearch, MdExpandMore, MdChevronRight } from 'react-icons/md';

interface Attachment {
  name: string;
  type: string;
  data: string;
  previewUrl?: string;
}

type ActionReceipt = { tool: string; params: Record<string, unknown>; result: 'success' | 'error'; output: string; timestamp: string };

interface GroupMessage {
  role: 'user' | 'agent' | 'founder';
  agentRole?: string;
  founderName?: string;
  content: string;
  timestamp: Date;
  attachments?: Attachment[];
  actions?: ActionReceipt[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const AGENT_SPEAKER_LABELS = Array.from(
  new Set([
    ...Object.keys(DISPLAY_NAME_MAP),
    ...Object.values(DISPLAY_NAME_MAP),
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

const FOUNDERS = [
  { id: 'kristina', name: 'Kristina', email: 'kristina@glyphor.ai', color: '#a78bfa', photo: '/kristina_headshot.jpg' },
  { id: 'andrew', name: 'Andrew', email: 'andrew@glyphor.ai', color: '#f59e0b', photo: '/andrew_headshot.jpg' },
];

const ALLOWED_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
  'application/json',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const EXT_TO_MIME: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const ACCEPT_EXTENSIONS = '.png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.txt,.csv,.md,.markdown,.json,.xlsx,.docx';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
              <div className="pl-4 text-muted truncate">{action.output}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GroupChat({ embedded }: { embedded?: boolean } = {}) {
  const { data: agents } = useAgents();
  const { user } = useAuth();
  const userInitials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(
    new Set(['chief-of-staff', 'cto', 'cfo']),
  );
  const [selectedFounders, setSelectedFounders] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [respondingAgents, setRespondingAgents] = useState<Set<string>>(new Set());
  const [pendingFiles, setPendingFiles] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [agentSearch, setAgentSearch] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);

  // Shared conversation ID — all users default to the same thread
  const [conversationId, setConversationId] = useState<string>(
    () => localStorage.getItem('glyphor-group-chat-id') || 'group-chat-default',
  );

  // @mention state
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIdx, setMentionIdx] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyLoaded = useRef(false);

  // ── Load chat history on mount or conversation change ──
  useEffect(() => {
    if (historyLoaded.current) return;
    historyLoaded.current = true;
    (async () => {
      const data = await apiCall<{ agent_role: string; role: string; content: string; attachments: any; created_at: string; user_id?: string }[]>(
        `/api/chat-messages?conversation_id=${encodeURIComponent(conversationId)}&order=created_at.desc&limit=200`
      ).catch((err) => { console.error('[GroupChat] Failed to load history:', err); return null; });
      if (data && data.length > 0) {
        const rows = [...data].reverse();
        setMessages(
          rows.map((row: any) => {
            const role = row.role as 'user' | 'agent';
            const rawContent = normalizeMessageContent(row.content);
            return {
              role,
              agentRole: role === 'agent' ? row.agent_role : undefined,
              founderName: role === 'user' ? FOUNDERS.find((f) => f.email === (row.user_id ?? '').toLowerCase())?.name : undefined,
              content: role === 'agent' ? stripAgentSpeakerPrefix(rawContent) : rawContent,
              timestamp: new Date(row.created_at),
              attachments: row.attachments ?? undefined,
            };
          }),
        );
      }
    })();
  }, [conversationId]);

  const mentionables = [
    ...agents.map((a) => ({ role: a.role, name: DISPLAY_NAME_MAP[a.role] ?? a.role })),
    ...FOUNDERS.map((f) => ({ role: f.id, name: f.name })),
  ];
  const filteredMentions = mentionFilter
    ? mentionables.filter(
        (m) =>
          m.name.toLowerCase().includes(mentionFilter.toLowerCase()) ||
          m.role.toLowerCase().includes(mentionFilter.toLowerCase()),
      )
    : mentionables;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleAgent = (role: string) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  };

  const toggleFounder = (id: string) => {
    setSelectedFounders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Org chart department grouping ──
  const DEPT_ORDER = [
    'Executive Office', 'Engineering', 'Product', 'Finance', 'Marketing',
    'Sales', 'Design & Frontend', 'Research & Intelligence',
    'Operations', 'Operations & IT', 'Legal', 'People & Culture',
  ];
  const TIER_PRIORITY: Record<string, number> = { Orchestrator: 0, Executive: 1, Specialist: 2, 'Sub-Team': 3 };

  const departments = useMemo(() => {
    const deptMap = new Map<string, typeof agents>();
    for (const agent of agents) {
      const dept = ROLE_DEPARTMENT[agent.role] || 'Other';
      if (!deptMap.has(dept)) deptMap.set(dept, []);
      deptMap.get(dept)!.push(agent);
    }
    for (const [, list] of deptMap) {
      list.sort((a, b) => (TIER_PRIORITY[ROLE_TIER[a.role] ?? 'Sub-Team'] ?? 3) - (TIER_PRIORITY[ROLE_TIER[b.role] ?? 'Sub-Team'] ?? 3));
    }
    const ordered: [string, typeof agents][] = [];
    for (const dept of DEPT_ORDER) {
      if (deptMap.has(dept)) { ordered.push([dept, deptMap.get(dept)!]); deptMap.delete(dept); }
    }
    for (const [dept, list] of deptMap) ordered.push([dept, list]);
    return ordered;
  }, [agents]);

  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set(DEPT_ORDER));
  const toggleDept = (dept: string) => {
    setExpandedDepts((prev) => { const next = new Set(prev); if (next.has(dept)) next.delete(dept); else next.add(dept); return next; });
  };

  const filteredDepts = useMemo(() => {
    if (!agentSearch.trim()) return departments;
    const q = agentSearch.toLowerCase();
    return departments
      .map(([dept, list]) => [dept, list.filter((a) => {
        const name = (DISPLAY_NAME_MAP[a.role] ?? '').toLowerCase();
        const title = (ROLE_TITLE[a.role] ?? '').toLowerCase();
        return name.includes(q) || title.includes(q) || a.role.includes(q);
      })] as [string, typeof agents])
      .filter(([, list]) => list.length > 0);
  }, [departments, agentSearch]);

  const isSearching = agentSearch.trim().length > 0;

  // ── File handling ──
  const handleFiles = async (files: FileList | File[]) => {
    const newAttachments: Attachment[] = [];
    for (const file of Array.from(files)) {
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

  // Total member count (agents + founders)
  const totalMembers = selectedRoles.size + selectedFounders.size;

  // Name list for header
  const allMemberNames = [
    ...Array.from(selectedRoles).map((r) => DISPLAY_NAME_MAP[r] ?? r),
    ...Array.from(selectedFounders).map((id) => FOUNDERS.find((f) => f.id === id)?.name ?? id),
  ];

  // Build a context-aware history array from messages
  const buildHistory = (msgs: GroupMessage[]) =>
    msgs.slice(-30).map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('agent' as const),
      content: m.agentRole
        ? `[${DISPLAY_NAME_MAP[m.agentRole] ?? m.agentRole}]: ${m.content}`
        : m.founderName
        ? `[${m.founderName}]: ${m.content}`
        : m.content,
    }));

  // Call a single agent and return the response
  const callAgent = async (
    agentRole: string,
    message: string,
    history: { role: 'user' | 'agent'; content: string }[],
  ): Promise<{ agentRole: string; content: string; actions?: ActionReceipt[] }> => {
    try {
      const res = await fetch(`${SCHEDULER_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentRole, task: 'on_demand', message, history, userName: user?.name, userEmail: (user?.email ?? '').toLowerCase() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      let content: string;
      if (data.output) content = stripReasoning(data.output);
      else if (data.error) content = `I ran into an issue: ${data.error}`;
      else if (data.status === 'aborted') content = 'My response was cut short — try a simpler question.';
      else content = `Completed but had nothing to report. (status: ${data.status ?? 'unknown'})`;
      content = stripAgentSpeakerPrefix(content);
      return { agentRole, content, actions: data.actions };
    } catch {
      return {
        agentRole,
        content: `Could not reach ${DISPLAY_NAME_MAP[agentRole] ?? agentRole}. The scheduler may be cold-starting.`,
      };
    }
  };

  // Persist a message to the DB with retry
  const persistMsg = async (userId: string, agentRole: string, role: string, content: string, attachments?: Attachment[]) => {
    const body = JSON.stringify({
      user_id: userId,
      agent_role: agentRole,
      role,
      content,
      conversation_id: conversationId,
      attachments: attachments ? attachments.map((a) => ({ name: a.name, type: a.type })) : null,
    });
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        await apiCall('/api/chat-messages', { method: 'POST', body });
        return;
      } catch (err) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        } else {
          console.error('[GroupChat] Failed to save message:', err);
          setSaveFailed(true);
          setTimeout(() => setSaveFailed(false), 5000);
        }
      }
    }
  };

  // Resolve @mentions → agent roles
  const parseMentions = (text: string): Set<string> => {
    const nameToRole = new Map<string, string>();
    for (const [role, name] of Object.entries(DISPLAY_NAME_MAP)) {
      nameToRole.set(name.toLowerCase(), role);
    }
    const mentionRegex = /@([A-Za-z]+(?: [A-Za-z]+)?)/g;
    let match: RegExpExecArray | null;
    const mentioned = new Set<string>();
    while ((match = mentionRegex.exec(text)) !== null) {
      const role = nameToRole.get(match[1].toLowerCase());
      if (role) mentioned.add(role);
    }
    return mentioned;
  };

  // Build group context string
  const buildGroupContext = (roles: string[], isFollowUp = false) => {
    const founderNames = Array.from(selectedFounders).map(
      (id) => FOUNDERS.find((f) => f.id === id)?.name ?? id,
    );
    const members = [...roles.map((r) => DISPLAY_NAME_MAP[r] ?? r), ...founderNames].join(', ');
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    const dateStr = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const rules = [
      `CURRENT TIME: ${timeStr}, ${dateStr}.`,
      `MODE: Live group chat — NOT a task or report request.`,
      `Participants: ${members}.`,
      `RULES:`,
      `- Read the founder's message carefully and ONLY respond to what they actually said.`,
      `- Do NOT run tools, generate reports, pull metrics, or give status updates unless explicitly asked.`,
      `- Do NOT greet with "good morning/afternoon" — use the current time above if referencing time of day.`,
      `- Keep responses short and conversational like a real Slack chat.`,
      `- If the message is casual (hey, hello, etc), respond casually in 1-2 sentences max.`,
    ].join('\n');

    if (isFollowUp) {
      return `${rules}\n- Other agents have already responded above. Only reply if you have something genuinely new to add. If not, respond with exactly: [NO_REPLY]`;
    }
    return `${rules}\n- Others will also respond after you and will see what you said.\n\nFounder's message:`;
  };

  // ── Send user message → agents respond sequentially ──
  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || sending || selectedRoles.size === 0) return;

    const attachments = pendingFiles.length > 0 ? [...pendingFiles] : undefined;
    setInput('');
    setPendingFiles([]);
    const userMsg: GroupMessage = { role: 'user', content: text, timestamp: new Date(), attachments };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    const userId = (user?.email ?? 'unknown').toLowerCase();
    persistMsg(userId, 'group-chat', 'user', text, attachments);

    // Merge @mentioned agents into selected roles
    const mentionedRoles = parseMentions(text);
    const effectiveRoles = new Set(selectedRoles);
    for (const role of mentionedRoles) effectiveRoles.add(role);
    const roles = Array.from(effectiveRoles);

    // Build full message with file contents
    let fullMessage = text;
    if (attachments?.length) {
      const parts = attachments.map((a) => {
        if (a.type.startsWith('image/')) return `[Attached image: ${a.name}]`;
        if (['text/plain', 'text/csv', 'text/markdown', 'application/json'].includes(a.type)) {
          try {
            const decoded = atob(a.data);
            const content = decoded.length > 8000 ? decoded.slice(0, 8000) + '\n...(truncated)' : decoded;
            return `[File: ${a.name}]\n\`\`\`\n${content}\n\`\`\``;
          } catch { return `[Attached file: ${a.name} (${a.type})]`; }
        }
        return `[Attached file: ${a.name} (${a.type})]`;
      });
      fullMessage = `${text}\n\n${parts.join('\n\n')}`;
    }

    // Sequential round: each agent sees previous agents' responses
    const groupContext = buildGroupContext(roles);
    let runningMessages = [...messages, userMsg];

    for (const agentRole of roles) {
      setRespondingAgents(new Set([agentRole]));
      const history = buildHistory(runningMessages);
      const result = await callAgent(agentRole, `${groupContext}\n\n${fullMessage}`, history);
      const agentMsg: GroupMessage = {
        role: 'agent',
        agentRole: result.agentRole,
        content: result.content,
        timestamp: new Date(),
        actions: result.actions,
      };
      runningMessages = [...runningMessages, agentMsg];
      setMessages((prev) => [...prev, agentMsg]);
      persistMsg(userId, agentRole, 'agent', result.content);
    }

    setRespondingAgents(new Set());
    setSending(false);
  };

  // ── Continue Discussion: agents react to each other ──
  const continueDiscussion = async () => {
    if (sending || selectedRoles.size === 0) return;
    setSending(true);

    const userId = (user?.email ?? 'unknown').toLowerCase();
    const roles = Array.from(selectedRoles);
    const groupContext = buildGroupContext(roles, true);

    let runningMessages = [...messages];
    let anyReplied = false;

    for (const agentRole of roles) {
      setRespondingAgents(new Set([agentRole]));
      const history = buildHistory(runningMessages);
      const result = await callAgent(
        agentRole,
        `${groupContext}\n\nContinue the discussion. Review what others have said and add your perspective.`,
        history,
      );

      // Skip if agent has nothing to add
      if (result.content.includes('[NO_REPLY]')) {
        setRespondingAgents(new Set());
        continue;
      }

      anyReplied = true;
      const agentMsg: GroupMessage = {
        role: 'agent',
        agentRole: result.agentRole,
        content: result.content,
        timestamp: new Date(),
        actions: result.actions,
      };
      runningMessages = [...runningMessages, agentMsg];
      setMessages((prev) => [...prev, agentMsg]);
      persistMsg(userId, agentRole, 'agent', result.content);
    }

    if (!anyReplied) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'agent',
          agentRole: 'system',
          content: 'All agents are aligned — no further discussion needed.',
          timestamp: new Date(),
        },
      ]);
    }

    setRespondingAgents(new Set());
    setSending(false);
  };

  return (
    <div className={`flex ${embedded ? 'h-full' : 'h-[calc(100dvh-10rem-var(--sat))] md:h-[calc(100vh-6rem)]'} gap-5`}>
      {/* ── Member Selector (Left) ────────────── */}
      <div className="w-60 flex-shrink-0 flex flex-col min-h-0">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-txt-muted">
          Group Members
        </p>

        {/* Founders */}
        <p className="mt-1 mb-1 text-[10px] font-semibold uppercase tracking-wider text-txt-faint">
          Founders
        </p>
        {FOUNDERS.map((founder) => {
          const active = selectedFounders.has(founder.id);
          return (
            <button
              key={founder.id}
              onClick={() => toggleFounder(founder.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                active
                  ? 'border border-border bg-surface ring-1 ring-inset ring-border dark:bg-raised/80'
                  : 'border border-transparent hover:bg-[var(--color-hover-bg)]'
              }`}
            >
              <div className="relative">
                <img
                  src={founder.photo}
                  alt={founder.name}
                  className="h-8 w-8 rounded-full object-cover"
                  style={{ border: `2px solid ${founder.color}40` }}
                />
                {active && (
                  <div className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-raised bg-tier-green" />
                )}
              </div>
              <div className="min-w-0">
                <p className={`text-[12px] font-medium truncate ${active ? 'text-cyan' : 'text-txt-secondary'}`}>
                  {founder.name}
                </p>
                <p className="text-[10px] text-txt-faint truncate">Co-Founder</p>
              </div>
            </button>
          );
        })}

        {/* Agent search */}
        <div className="mt-3 mb-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-raised px-2 py-1.5">
            <MdSearch size={14} className="text-txt-faint flex-shrink-0" />
            <input
              type="text"
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              placeholder="Search agents..."
              className="flex-1 bg-transparent text-[11px] text-txt-secondary placeholder-txt-faint outline-none"
            />
          </div>
        </div>

        {/* Agent org chart */}
        <div className="flex-1 overflow-y-auto space-y-0.5">
          {filteredDepts.map(([dept, agentList]) => (
            <div key={dept}>
              <button
                onClick={() => toggleDept(dept)}
                className="flex w-full items-center gap-1 px-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-txt-muted hover:text-txt-secondary transition-colors"
              >
                {isSearching || expandedDepts.has(dept) ? <MdExpandMore size={14} /> : <MdChevronRight size={14} />}
                {dept}
                <span className="text-txt-faint font-normal ml-0.5">({agentList.length})</span>
              </button>
              {(isSearching || expandedDepts.has(dept)) &&
                agentList.map((agent) => {
                  const meta = AGENT_META[agent.role];
                  const active = selectedRoles.has(agent.role);
                  const tier = ROLE_TIER[agent.role];
                  const isLead = tier === 'Executive' || tier === 'Orchestrator';
                  return (
                    <button
                      key={agent.id}
                      onClick={() => toggleAgent(agent.role)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${isLead ? '' : 'ml-3'} ${
                        active
                          ? 'border border-border bg-surface ring-1 ring-inset ring-border dark:bg-raised/80'
                          : 'border border-transparent hover:bg-[var(--color-hover-bg)]'
                      }`}
                    >
                      <div className="relative flex-shrink-0">
                        <img
                          src={`/avatars/${agent.role}.png`}
                          alt={agent.role}
                          className={`rounded-full object-cover ${isLead ? 'h-8 w-8' : 'h-6 w-6'}`}
                          style={{ border: `1.5px solid ${meta?.color ?? '#64748b'}40` }}
                        />
                        {active && (
                          <div className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-raised bg-tier-green" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-[11px] font-medium truncate ${active ? 'text-txt-primary' : 'text-txt-secondary'}`}>
                          {DISPLAY_NAME_MAP[agent.role] ?? agent.role}
                        </p>
                        <p className="text-[9px] text-txt-faint truncate">{ROLE_TITLE[agent.role] ?? agent.role}</p>
                      </div>
                      {isLead && (
                        <span className="text-[8px] font-medium uppercase px-1 py-0.5 rounded-lg badge badge-cyan tracking-wider flex-shrink-0">
                          {tier === 'Orchestrator' ? 'CoS' : 'Lead'}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          ))}
          {filteredDepts.length === 0 && (
            <p className="text-center text-[11px] text-txt-faint py-4">No agents match "{agentSearch}"</p>
          )}
        </div>

        {/* New conversation button */}
        <button
          onClick={() => {
            const id = `gc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            localStorage.setItem('glyphor-group-chat-id', id);
            setConversationId(id);
            setMessages([]);
            historyLoaded.current = false;
          }}
          className="mt-2 w-full rounded-lg border border-border bg-raised px-3 py-2 text-[11px] text-txt-muted hover:text-cyan hover:border-cyan/30 transition-colors text-center"
        >
          + New Conversation
        </button>
      </div>

      {/* ── Chat Area (Right) ────────────── */}
      <Card
        className={`flex flex-1 flex-col min-h-0 transition-all ${dragging ? 'ring-2 ring-cyan/40' : ''}`}
        onDragOver={(e: React.DragEvent) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e: React.DragEvent) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div className="flex -space-x-2">
            {Array.from(selectedFounders)
              .slice(0, 2)
              .map((id) => {
                const f = FOUNDERS.find((x) => x.id === id)!;
                return (
                  <img
                    key={id}
                    src={f.photo}
                    alt={f.name}
                    className="h-7 w-7 rounded-full object-cover border-2 border-surface"
                  />
                );
              })}
            {Array.from(selectedRoles)
              .slice(0, 5)
              .map((role) => (
                <AgentAvatar key={role} role={role} size={28} />
              ))}
            {totalMembers > 7 && (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-raised border border-border text-[10px] font-bold text-txt-muted">
                +{totalMembers - 7}
              </div>
            )}
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-txt-primary">Group Chat</h2>
            <p className="text-[11px] text-txt-muted">
              {totalMembers} member{totalMembers !== 1 ? 's' : ''} ·{' '}
              {allMemberNames.slice(0, 3).join(', ')}
              {allMemberNames.length > 3 ? ` +${allMemberNames.length - 3}` : ''}
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-txt-muted">Start a group conversation</p>
                <p className="mt-1 text-[11px] text-txt-faint">
                  Drag &amp; drop files, use <MdAttachFile className="inline-block text-[14px]" />, or type <span className="text-cyan">@</span> to mention members
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-3 animate-fade-up ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              {msg.role === 'agent' && msg.agentRole ? (
                msg.agentRole === 'system' ? (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-raised border border-border text-[11px] text-txt-muted">
                    ✓
                  </div>
                ) : (
                  <AgentAvatar role={msg.agentRole} size={28} />
                )
              ) : msg.role === 'founder' && msg.founderName ? (
                <img
                  src={FOUNDERS.find((f) => f.name === msg.founderName)?.photo ?? ''}
                  alt={msg.founderName}
                  className="h-7 w-7 rounded-full object-cover flex-shrink-0"
                  style={{ border: `2px solid ${FOUNDERS.find((f) => f.name === msg.founderName)?.color ?? '#64748b'}40` }}
                />
              ) : msg.role === 'user' ? (() => {
                const founder = FOUNDERS.find((f) => f.email === user?.email);
                return founder ? (
                  <img
                    src={founder.photo}
                    alt={founder.name}
                    className="h-7 w-7 rounded-full object-cover flex-shrink-0"
                    style={{ border: `2px solid ${founder.color}40` }}
                  />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-raised text-[11px] font-bold text-txt-primary">
                    {userInitials}
                  </div>
                );
              })() : null}
              <div
                className={`max-w-[70%] rounded-xl px-4 py-2.5 text-[13px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'chat-bubble-user glass-panel panel-nested border border-border text-txt-primary'
                    : 'chat-bubble-agent glass-panel panel-nested border border-border text-txt-secondary'
                }`}
              >
                {msg.role === 'agent' && msg.agentRole && (
                  <p className="text-[11px] font-semibold mb-1" style={{ color: AGENT_META[msg.agentRole]?.color ?? '#64748b' }}>
                    {DISPLAY_NAME_MAP[msg.agentRole] ?? msg.agentRole}
                  </p>
                )}
                {msg.role === 'founder' && msg.founderName && (
                  <p className="text-[11px] font-semibold mb-1" style={{ color: FOUNDERS.find((f) => f.name === msg.founderName)?.color ?? '#64748b' }}>
                    {msg.founderName}
                  </p>
                )}
                {/* Attachment chips */}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {msg.attachments.map((att, j) => (
                      <div key={j} className="flex items-center gap-1.5 rounded-md bg-base/50 border border-border px-2 py-1">
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
                {msg.role === 'agent' || msg.role === 'founder' ? (
                  <ChatMarkdown>{msg.content}</ChatMarkdown>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
                {msg.actions && msg.actions.length > 0 && <ActionReceipts actions={msg.actions} />}
                <p className="mt-1.5 text-[10px] text-txt-faint">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}

          {/* Typing indicators for responding agents */}
          {respondingAgents.size > 0 &&
            Array.from(respondingAgents).map((role) => (
              <div key={role} className="flex gap-3">
                <AgentAvatar role={role} size={28} />
                <div className="rounded-xl bg-raised border border-border px-4 py-3">
                  <p className="text-[10px] text-txt-faint mb-1">
                    {DISPLAY_NAME_MAP[role] ?? role}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className="animate-breathe h-1.5 w-1.5 rounded-full bg-txt-muted" style={{ animationDelay: '0ms' }} />
                    <span className="animate-breathe h-1.5 w-1.5 rounded-full bg-txt-muted" style={{ animationDelay: '200ms' }} />
                    <span className="animate-breathe h-1.5 w-1.5 rounded-full bg-txt-muted" style={{ animationDelay: '400ms' }} />
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

        {/* Pending files */}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-border px-1 pt-2">
            {pendingFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-lg bg-raised border border-border px-2.5 py-1.5">
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
        <div className="border-t border-border pt-3 relative">
          {/* @mention dropdown */}
          {showMentions && filteredMentions.length > 0 && (
            <div className="dropdown-panel absolute bottom-full left-0 z-10 mb-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-border bg-surface">
              {filteredMentions.map((m, i) => {
                const isFounder = FOUNDERS.some((f) => f.id === m.role);
                return (
                  <button
                    key={m.role}
                    onClick={() => insertMention(m)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors ${
                      i === mentionIdx ? 'bg-surface text-txt-primary ring-1 ring-inset ring-border' : 'text-txt-secondary hover:bg-[var(--color-hover-bg)]'
                    }`}
                  >
                    {isFounder ? (
                      <div
                        className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                        style={{ backgroundColor: FOUNDERS.find((f) => f.id === m.role)?.color }}
                      >
                        {m.name[0]}
                      </div>
                    ) : (
                      <AgentAvatar role={m.role} size={20} />
                    )}
                    <span className="font-medium">{m.name}</span>
                    <span className="text-txt-faint ml-auto text-[10px]">{isFounder ? 'Founder' : m.role}</span>
                  </button>
                );
              })}
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
          <ChatComposerFrame>
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                selectedRoles.size === 0
                  ? 'Select at least one agent...'
                  : `Message ${totalMembers} member${totalMembers !== 1 ? 's' : ''}... (@ to mention, Shift+Enter for new line)`
              }
              disabled={sending || selectedRoles.size === 0}
              rows={2}
              className={composerTextareaClassName}
              onInput={(e) => { const el = e.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 180)}px`; }}
            />
            <div className={composerFooterRowClassName}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={composerIconButtonClassName}
                title="Attach file"
              >
                <MdAttachFile className="text-[15px]" />
              </button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <GradientButton
                  size="sm"
                  onClick={sendMessage}
                  disabled={sending || (!input.trim() && pendingFiles.length === 0) || selectedRoles.size === 0}
                >
                  Send
                </GradientButton>
                {messages.length > 0 && (
                  <GradientButton
                    variant="neutral"
                    size="sm"
                    onClick={continueDiscussion}
                    disabled={sending || selectedRoles.size === 0}
                    title="Let agents continue discussing with each other"
                  >
                    Continue&nbsp;↻
                  </GradientButton>
                )}
              </div>
            </div>
          </ChatComposerFrame>
        </div>
      </Card>
    </div>
  );
}
