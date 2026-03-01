import { useState, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import { useAgents } from '../lib/hooks';
import { DISPLAY_NAME_MAP, AGENT_META } from '../lib/types';
import { Card, AgentAvatar } from '../components/ui';
import { apiCall, SCHEDULER_URL } from '../lib/firebase';
import { useAuth, getEmailAliases } from '../lib/auth';
import { MdAttachFile, MdImage, MdDescription, MdClose } from 'react-icons/md';

interface Attachment {
  name: string;
  type: string;
  data: string;
  previewUrl?: string;
}

interface GroupMessage {
  role: 'user' | 'agent' | 'founder';
  agentRole?: string;
  founderName?: string;
  content: string;
  timestamp: Date;
  attachments?: Attachment[];
}

/** Strip <reasoning>...</reasoning> envelope from agent output */
function stripReasoning(text: string): string {
  return text.replace(/<reasoning>[\s\S]*?<\/reasoning>\s*/g, '').trim();
}

const FOUNDERS = [
  { id: 'kristina', name: 'Kristina', email: 'kristina@glyphor.ai', color: '#a78bfa' },
  { id: 'andrew', name: 'Andrew', email: 'andrew@glyphor.ai', color: '#f59e0b' },
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

export default function GroupChat() {
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

  // @mention state
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIdx, setMentionIdx] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyLoaded = useRef(false);

  // ── Load chat history on mount ──
  useEffect(() => {
    if (historyLoaded.current) return;
    historyLoaded.current = true;
    const aliases = getEmailAliases(user?.email ?? 'unknown');
    (async () => {
      const data = await apiCall<{ agent_role: string; role: string; content: string; attachments: any; created_at: string }[]>(
        `/api/chat-messages?user_id=${encodeURIComponent(aliases.join(','))}&limit=200`
      ).catch(() => null);
      if (data && data.length > 0) {
        setMessages(
          data.map((row: any) => ({
            role: row.role as 'user' | 'agent',
            agentRole: row.role === 'agent' ? row.agent_role : undefined,
            content: row.content,
            timestamp: new Date(row.created_at),
            attachments: row.attachments ?? undefined,
          })),
        );
      }
    })();
  }, [user?.email]);

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

  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || sending || selectedRoles.size === 0) return;

    const attachments = pendingFiles.length > 0 ? [...pendingFiles] : undefined;
    setInput('');
    setPendingFiles([]);
    const userMsg: GroupMessage = { role: 'user', content: text, timestamp: new Date(), attachments };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    // Persist user message
    const userId = user?.email ?? 'unknown';
    apiCall('/api/chat-messages', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        agent_role: 'user',
        role: 'user',
        content: text,
        attachments: attachments ? attachments.map((a) => ({ name: a.name, type: a.type })) : null,
      }),
    }).then();

    // Parse @mentions and auto-add mentioned agents to recipients
    const nameToRole = new Map<string, string>();
    for (const [role, name] of Object.entries(DISPLAY_NAME_MAP)) {
      nameToRole.set(name.toLowerCase(), role);
    }
    const mentionRegex = /@([A-Za-z]+(?: [A-Za-z]+)?)/g;
    let match: RegExpExecArray | null;
    const mentionedRoles = new Set<string>();
    while ((match = mentionRegex.exec(text)) !== null) {
      const role = nameToRole.get(match[1].toLowerCase());
      if (role) mentionedRoles.add(role);
    }
    // Merge mentioned agents into selected roles for this send
    const effectiveRoles = new Set(selectedRoles);
    for (const role of mentionedRoles) effectiveRoles.add(role);

    const roles = Array.from(effectiveRoles);
    setRespondingAgents(new Set(roles));

    const history = messages.slice(-20).map((m) => ({
      role: m.role,
      content: m.agentRole
        ? `[${DISPLAY_NAME_MAP[m.agentRole] ?? m.agentRole}]: ${m.content}`
        : m.founderName
        ? `[${m.founderName}]: ${m.content}`
        : m.content,
    }));

    const founderNames = Array.from(selectedFounders).map(
      (id) => FOUNDERS.find((f) => f.id === id)?.name ?? id,
    );
    const groupContext = `You are in a group chat with: ${[
      ...roles.map((r) => DISPLAY_NAME_MAP[r] ?? r),
      ...founderNames,
    ].join(', ')}. The founder is also present. Keep your response concise — others will also respond.`;

    // Build full message with file contents for agents
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

    // Fire off all agent requests concurrently
    const promises = roles.map(async (agentRole) => {
      try {
        const res = await fetch(`${SCHEDULER_URL}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentRole,
            task: 'on_demand',
            message: `${groupContext}\n\n${fullMessage}`,
            history,
          }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        let content: string;
        if (data.output) content = stripReasoning(data.output);
        else if (data.error) content = `I ran into an issue: ${data.error}`;
        else if (data.status === 'aborted') content = 'My response was cut short — try a simpler question.';
        else content = `Completed but had nothing to report. (status: ${data.status ?? 'unknown'})`;

        return { agentRole, content };
      } catch {
        return {
          agentRole,
          content: `Could not reach ${DISPLAY_NAME_MAP[agentRole] ?? agentRole}. The scheduler may be cold-starting.`,
        };
      } finally {
        setRespondingAgents((prev) => {
          const next = new Set(prev);
          next.delete(agentRole);
          return next;
        });
      }
    });

    const results = await Promise.allSettled(promises);
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const { agentRole, content } = result.value;
        setMessages((prev) => [
          ...prev,
          { role: 'agent', agentRole, content, timestamp: new Date() },
        ]);

        // Persist agent response
        apiCall('/api/chat-messages', {
          method: 'POST',
          body: JSON.stringify({
            user_id: userId,
            agent_role: agentRole,
            role: 'agent',
            content,
            attachments: null,
          }),
        }).catch(() => {});
      }
    }

    setSending(false);
  };

  return (
    <div className="flex h-[calc(100vh-6rem)] gap-5">
      {/* ── Member Selector (Left) ────────────── */}
      <div className="w-56 flex-shrink-0 space-y-1 overflow-y-auto">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-txt-muted">
          Group Members
        </p>
        <p className="mb-3 text-[10px] text-txt-faint">
          Select agents &amp; founders to include
        </p>

        {/* Founders */}
        <p className="mt-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-txt-faint">
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
                  ? 'bg-cyan/10 border border-cyan/25'
                  : 'border border-transparent hover:bg-[var(--color-hover-bg)]'
              }`}
            >
              <div className="relative">
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ backgroundColor: founder.color }}
                >
                  {founder.name[0]}
                </div>
                {active && (
                  <div className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-cyan border border-raised" />
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

        {/* Agents */}
        <p className="mt-4 mb-1 text-[10px] font-semibold uppercase tracking-wider text-txt-faint">
          Agents
        </p>
        {agents.map((agent) => {
          const meta = AGENT_META[agent.role];
          const active = selectedRoles.has(agent.role);
          return (
            <button
              key={agent.id}
              onClick={() => toggleAgent(agent.role)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                active
                  ? 'bg-cyan/10 border border-cyan/25'
                  : 'border border-transparent hover:bg-[var(--color-hover-bg)]'
              }`}
            >
              <div className="relative">
                <img
                  src={`/avatars/${agent.role}.png`}
                  alt={agent.role}
                  className="h-7 w-7 rounded-full object-cover"
                  style={{ border: `1.5px solid ${meta?.color ?? '#64748b'}40` }}
                />
                {active && (
                  <div className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-cyan border border-raised" />
                )}
              </div>
              <div className="min-w-0">
                <p className={`text-[12px] font-medium truncate ${active ? 'text-cyan' : 'text-txt-secondary'}`}>
                  {DISPLAY_NAME_MAP[agent.role] ?? agent.role}
                </p>
                <p className="text-[10px] text-txt-faint truncate">{agent.role}</p>
              </div>
            </button>
          );
        })}
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
                  <div
                    key={id}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white border-2 border-surface"
                    style={{ backgroundColor: f.color }}
                  >
                    {f.name[0]}
                  </div>
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
                <AgentAvatar role={msg.agentRole} size={28} />
              ) : msg.role === 'founder' && msg.founderName ? (
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ backgroundColor: FOUNDERS.find((f) => f.name === msg.founderName)?.color ?? '#64748b' }}
                >
                  {msg.founderName[0]}
                </div>
              ) : msg.role === 'user' ? (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan/20 text-[11px] font-bold text-cyan">
                  {userInitials}
                </div>
              ) : null}
              <div
                className={`max-w-[70%] rounded-xl px-4 py-2.5 text-[13px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-cyan/10 text-txt-secondary border border-cyan/20'
                    : 'bg-raised text-txt-secondary border border-border'
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
                  <div className="prose-chat"><Markdown>{msg.content}</Markdown></div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
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
            <div className="absolute bottom-full left-0 mb-1 w-64 rounded-lg border border-border bg-surface shadow-lg z-10 max-h-48 overflow-y-auto">
              {filteredMentions.map((m, i) => {
                const isFounder = FOUNDERS.some((f) => f.id === m.role);
                return (
                  <button
                    key={m.role}
                    onClick={() => insertMention(m)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors ${
                      i === mentionIdx ? 'bg-cyan/10 text-cyan' : 'text-txt-secondary hover:bg-[var(--color-hover-bg)]'
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

          <div className="flex gap-2 items-end">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-shrink-0 rounded-lg border border-border bg-raised px-2.5 py-2.5 text-txt-muted hover:text-cyan transition-colors"
              title="Attach file"
            >
              <MdAttachFile className="text-[16px]" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept={`${ALLOWED_TYPES.join(',')},${ACCEPT_EXTENSIONS}`}
              onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }}
            />
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
              rows={1}
              className="flex-1 rounded-lg border border-border bg-raised px-4 py-2.5 text-[13px] text-txt-secondary placeholder-txt-faint outline-none transition-colors focus:border-cyan/40 disabled:opacity-50 resize-none min-h-[40px] max-h-[120px]"
              onInput={(e) => { const el = e.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; }}
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={sending || (!input.trim() && pendingFiles.length === 0) || selectedRoles.size === 0}
              className="flex-shrink-0 rounded-lg bg-cyan px-5 py-2.5 text-[13px] font-semibold text-white dark:text-gray-900 transition-all hover:opacity-90 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
