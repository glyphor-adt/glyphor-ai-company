import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import { useAgents } from '../lib/hooks';
import { DISPLAY_NAME_MAP, AGENT_META } from '../lib/types';
import { Card, AgentAvatar } from '../components/ui';
import { supabase, SCHEDULER_URL } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { MdAttachFile, MdImage, MdDescription, MdClose } from 'react-icons/md';

interface Attachment {
  name: string;
  type: string;
  data: string;
  previewUrl?: string;
}

interface Message {
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
  attachments?: Attachment[];
}

/** Strip <reasoning>...</reasoning> envelope from agent output */
function stripReasoning(text: string): string {
  return text.replace(/<reasoning>[\s\S]*?<\/reasoning>\s*/g, '').trim();
}

const ALLOWED_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
  'application/json',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Persist a message to Supabase */
async function saveMessage(
  agentRole: string,
  role: 'user' | 'agent',
  content: string,
  userId: string,
  attachments?: Attachment[],
) {
  const row: Record<string, unknown> = { agent_role: agentRole, role, content, user_id: userId };
  if (attachments?.length) {
    row.attachments = attachments.map((a) => ({ name: a.name, type: a.type }));
  }
  await (supabase.from('chat_messages') as any).insert(row);
}

export default function Chat() {
  const { agentId } = useParams();
  const { data: agents } = useAgents();
  const { user } = useAuth();
  const userEmail = user?.email ?? 'unknown';
  const userInitials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  const [selectedRole, setSelectedRole] = useState(agentId ?? 'chief-of-staff');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);

  // @mention state
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIdx, setMentionIdx] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedRoleRef = useRef(selectedRole);
  const [pendingAgent, setPendingAgent] = useState<string | null>(null);
  useEffect(() => { selectedRoleRef.current = selectedRole; }, [selectedRole]);

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

  // Load chat history
  const loadHistory = useCallback(
    async (role: string) => {
      setLoadingHistory(true);
      try {
        const { data } = (await (supabase.from('chat_messages') as any)
          .select('role, content, created_at, attachments')
          .eq('agent_role', role)
          .eq('user_id', userEmail)
          .order('created_at', { ascending: true })
          .limit(100)) as {
          data: { role: string; content: string; created_at: string; attachments?: { name: string; type: string }[] }[] | null;
        };
        if (data?.length) {
          setMessages(
            data.map((row) => ({
              role: row.role as 'user' | 'agent',
              content: row.content,
              timestamp: new Date(row.created_at),
              attachments: row.attachments?.map((a) => ({ ...a, data: '' })),
            })),
          );
        } else {
          setMessages([]);
        }
      } catch {
        setMessages([]);
      }
      setLoadingHistory(false);
    },
    [userEmail],
  );

  useEffect(() => { loadHistory(selectedRole); }, [selectedRole, loadHistory]);
  useEffect(() => { if (agentId) setSelectedRole(agentId); }, [agentId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const selectedAgent = agents.find((a) => a.role === selectedRole);
  const codename = DISPLAY_NAME_MAP[selectedRole] ?? selectedRole;

  // ── File handling ──
  const handleFiles = async (files: FileList | File[]) => {
    const newAttachments: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        alert(`File type not supported: ${file.type || file.name.split('.').pop()}`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        alert(`File too large (max 10 MB): ${file.name}`);
        continue;
      }
      const data = await fileToBase64(file);
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      newAttachments.push({ name: file.name, type: file.type, data, previewUrl });
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

  // ── Send ──
  const sendMessage = async () => {
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || sending) return;

    // Capture which agent we're sending to — this won't change even if user switches agents
    const targetRole = selectedRole;

    const attachments = pendingFiles.length > 0 ? [...pendingFiles] : undefined;
    const userMsg: Message = { role: 'user', content: text, timestamp: new Date(), attachments };
    setInput('');
    setPendingFiles([]);
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);
    setPendingAgent(targetRole);

    saveMessage(targetRole, 'user', text, userEmail, attachments);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);

    try {
      const history = messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));

      // Build full message with file contents for agent
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

      const res = await fetch(`${SCHEDULER_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentRole: targetRole, task: 'on_demand', message: fullMessage, history }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      let content: string;
      if (data.output) content = stripReasoning(data.output);
      else if (data.action === 'queued_for_approval') content = `This request was sent to your approval queue for review.`;
      else if (data.status === 'aborted') content = 'My response was cut short — I may have timed out. Try a simpler question.';
      else if (data.error) content = `I ran into an issue — try rephrasing or asking something simpler.`;
      else content = `I completed the task but had nothing to report back.`;

      // Only append to UI if user is still viewing the same agent
      if (selectedRoleRef.current === targetRole) {
        setMessages((prev) => [...prev, { role: 'agent', content, timestamp: new Date() }]);
      }
      saveMessage(targetRole, 'agent', content, userEmail);
    } catch (err) {
      clearTimeout(timeoutId);
      const targetName = DISPLAY_NAME_MAP[targetRole] ?? targetRole;
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const errContent = isTimeout
        ? `${targetName} timed out. Please try again.`
        : `Could not reach ${targetName}. Please try again in a moment.`;
      if (selectedRoleRef.current === targetRole) {
        setMessages((prev) => [...prev, { role: 'agent', content: errContent, timestamp: new Date() }]);
      }
    } finally {
      setSending(false);
      setPendingAgent(null);
    }
  };

  return (
    <div className="flex h-[calc(100vh-6rem)] gap-5">
      {/* ── Agent List (Left) ────────────── */}
      <div className="w-64 flex-shrink-0 space-y-1 overflow-y-auto">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-txt-muted">
          Agents
        </p>
        {agents.map((agent) => {
          const meta = AGENT_META[agent.role];
          const active = agent.role === selectedRole;
          return (
            <button
              key={agent.id}
              onClick={() => setSelectedRole(agent.role)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                active
                  ? 'bg-cyan/10 border border-cyan/25'
                  : 'border border-transparent hover:bg-[var(--color-hover-bg)]'
              }`}
            >
              <img
                src={`/avatars/${agent.role}.png`}
                alt={agent.role}
                className="h-11 w-11 flex-shrink-0 rounded-full object-cover"
                style={{ border: `2px solid ${meta?.color ?? '#64748b'}60` }}
              />
              <div className="min-w-0">
                <p className={`text-[13px] font-medium truncate ${active ? 'text-cyan' : 'text-txt-secondary'}`}>
                  {DISPLAY_NAME_MAP[agent.role] ?? agent.role}
                </p>
                <p className="text-[11px] text-txt-faint truncate">{agent.role}</p>
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
          <AgentAvatar role={selectedRole} size={36} glow />
          <div className="flex-1">
            <h2 className="text-[15px] font-semibold text-txt-primary">{codename}</h2>
            <p className="text-[11px] text-txt-muted">
              {selectedAgent?.role ?? selectedRole} · {selectedAgent?.model ?? 'unknown model'}
            </p>
          </div>
          {messages.length > 0 && (
            <button
              onClick={async () => {
                await (supabase.from('chat_messages') as any).delete().eq('agent_role', selectedRole).eq('user_id', userEmail);
                setMessages([]);
              }}
              className="text-[11px] text-txt-faint hover:text-rose transition-colors"
            >
              Clear Chat
            </button>
          )}
        </div>

        {/* Messages */}
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
                  Drag &amp; drop files, use <MdAttachFile className="inline-block text-[14px]" />, or type <span className="text-cyan">@</span> to mention agents
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
              {msg.role === 'agent' ? (
                <AgentAvatar role={selectedRole} size={28} />
              ) : userAvatar ? (
                <img src={userAvatar} alt="" className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan/20 text-[11px] font-bold text-cyan">
                  {userInitials}
                </div>
              )}
              <div
                className={`max-w-[70%] rounded-xl px-4 py-2.5 text-[13px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-cyan/10 text-txt-secondary border border-cyan/20'
                    : 'bg-raised text-txt-secondary border border-border'
                }`}
              >
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
                {msg.role === 'agent' ? (
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

          {sending && pendingAgent === selectedRole && (
            <div className="flex gap-3">
              <AgentAvatar role={selectedRole} size={28} />
              <div className="rounded-xl bg-raised border border-border px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="animate-breathe h-1.5 w-1.5 rounded-full bg-cyan" style={{ animationDelay: '0ms' }} />
                  <span className="animate-breathe h-1.5 w-1.5 rounded-full bg-cyan" style={{ animationDelay: '200ms' }} />
                  <span className="animate-breathe h-1.5 w-1.5 rounded-full bg-cyan" style={{ animationDelay: '400ms' }} />
                </div>

              </div>
            </div>
          )}

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
              accept={ALLOWED_TYPES.join(',')}
              onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }}
            />
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${codename}... (@ to mention, Shift+Enter for new line)`}
              disabled={sending}
              rows={1}
              className="flex-1 rounded-lg border border-border bg-raised px-4 py-2.5 text-[13px] text-txt-secondary placeholder-txt-faint outline-none transition-colors focus:border-cyan/40 disabled:opacity-50 resize-none min-h-[40px] max-h-[120px]"
              onInput={(e) => { const el = e.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; }}
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={sending || (!input.trim() && pendingFiles.length === 0)}
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
