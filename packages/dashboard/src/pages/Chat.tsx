import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import { useAgents } from '../lib/hooks';
import { DISPLAY_NAME_MAP, AGENT_META } from '../lib/types';
import { Card, AgentAvatar } from '../components/ui';
import { supabase, SCHEDULER_URL } from '../lib/supabase';
import { useAuth, getEmailAliases } from '../lib/auth';
import { MdAttachFile, MdImage, MdDescription, MdClose, MdVideoCall, MdCallEnd } from 'react-icons/md';
import { HiMiniSignal, HiStop, HiMicrophone } from 'react-icons/hi2';
import { useVoiceChat } from '../lib/useVoiceChat';
import VoiceOverlay from '../components/VoiceOverlay';

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

/** Persist a message to Supabase */
/** Persist a message to Supabase */
async function saveMessage(
  agentRole: string,
  role: 'user' | 'agent',
  content: string,
  userId: string,
  attachments?: Attachment[],
) {
  await supabase.from('chat_messages').insert({
    agent_role: agentRole,
    role,
    content,
    user_id: userId,
    attachments: attachments?.length ? attachments.map((a) => ({ name: a.name, type: a.type })) : null,
  });
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

  const userAliases = getEmailAliases(userEmail);

  // Load chat history
  const loadHistory = useCallback(
    async (role: string) => {
      setLoadingHistory(true);
      try {
        const { data } = await supabase.from('chat_messages')
          .select('role, content, created_at, attachments')
          .eq('agent_role', role)
          .in('user_id', userAliases)
          .order('created_at', { ascending: true })
          .limit(100);
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
    [userAliases],
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
    const timeoutId = setTimeout(() => controller.abort(), 180_000);

    try {
      const history = messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));

      // Send attachments as structured data for native multimodal processing
      const apiAttachments = attachments?.map((a) => ({
        name: a.name,
        mimeType: a.type,
        data: a.data,
      }));

      const res = await fetch(`${SCHEDULER_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentRole: targetRole,
          task: 'on_demand',
          message: text || 'Please review the attached file(s).',
          history,
          ...(apiAttachments ? { attachments: apiAttachments } : {}),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      let content: string;
      if (data.output) content = stripReasoning(data.output);
      else if (data.action === 'queued_for_approval') content = `This request was sent to your approval queue for review.`;
      else if (data.status === 'aborted') content = 'Sorry, I wasn\u2019t able to finish my response. Could you try again?';
      else if (data.error || data.reason) content = `Something went wrong: ${data.error || data.reason}`;
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
          {/* Teams call button */}
          {VOICE_GW && (
            teamsSessionId ? (
              <button
                onClick={leaveTeamsCall}
                className="flex items-center gap-1.5 rounded-full bg-rose-500/15 px-3 py-1.5 text-[11px] font-medium text-rose-400 hover:bg-rose-500/25 transition-colors"
                title="Remove agent from Teams call"
              >
                <MdCallEnd size={14} />
                In Call — Leave
              </button>
            ) : currentMeetingUrl ? (
              <button
                onClick={() => joinTeamsCall(currentMeetingUrl)}
                disabled={teamsJoining}
                className="flex items-center gap-1.5 rounded-full bg-cyan/10 border border-cyan/25 px-3 py-1.5 text-[11px] font-medium text-cyan hover:bg-cyan/20 transition-colors disabled:opacity-40"
                title="Add this agent to your current Teams call"
              >
                <MdVideoCall size={16} />
                {teamsJoining ? 'Joining…' : 'Add to This Call'}
              </button>
            ) : (
              <button
                onClick={() => setShowTeamsModal(true)}
                className="flex items-center gap-1.5 rounded-full bg-raised border border-border px-3 py-1.5 text-[11px] font-medium text-txt-muted hover:text-cyan hover:border-cyan/40 transition-colors"
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
                await supabase.from('chat_messages').delete().eq('agent_role', selectedRole).eq('user_id', userEmail);
                setMessages([]);
              }}
              className="text-[11px] text-txt-faint hover:text-rose transition-colors"
            >
              Clear Chat
            </button>
          )}
        </div>

        {/* Voice Chat Overlay — replaces messages area when voice is active */}
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
        <>
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
                  Drag &amp; drop, paste, or use <MdAttachFile className="inline-block text-[14px]" /> to attach files • Type <span className="text-cyan">@</span> to mention agents
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
              accept={`${ALLOWED_TYPES.join(',')},${ACCEPT_EXTENSIONS}`}
              onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }}
            />
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={`Message ${codename}... (@ to mention, Shift+Enter for new line)`}
              disabled={sending}
              rows={1}
              className="flex-1 rounded-lg border border-border bg-raised px-4 py-2.5 text-[13px] text-txt-secondary placeholder-txt-faint outline-none transition-colors focus:border-cyan/40 disabled:opacity-50 resize-none min-h-[40px] max-h-[120px]"
              onInput={(e) => { const el = e.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; }}
            />
            <button
              type="button"
              onClick={toggleDictation}
              className={`flex-shrink-0 w-[40px] h-[40px] flex items-center justify-center rounded-full transition-all ${
                isListening
                  ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/25 animate-pulse'
                  : 'bg-raised border border-border text-txt-muted hover:text-cyan hover:border-cyan/40 hover:bg-cyan/5'
              }`}
              title={isListening ? 'Stop dictation' : 'Dictate (speech to text)'}
            >
              <HiMicrophone size={18} />
            </button>
            {voice.isAvailable && (
              <button
                type="button"
                onClick={() => {
                  if (voice.isActive) voice.stopVoice();
                  else voice.startVoice(selectedRole, userEmail);
                }}
                disabled={voice.isConnecting}
                className={`flex-shrink-0 w-[40px] h-[40px] flex items-center justify-center rounded-full transition-all ${
                  voice.isActive
                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25 hover:bg-rose-500 hover:shadow-rose-500/25'
                    : voice.isConnecting
                      ? 'bg-amber-500/20 text-amber-400 animate-pulse'
                      : 'bg-raised border border-border text-txt-muted hover:text-cyan hover:border-cyan/40 hover:bg-cyan/5'
                }`}
                title={voice.isActive ? 'End voice chat' : 'Start voice chat'}
              >
                {voice.isActive ? (
                  <HiStop size={18} />
                ) : (
                  <HiMiniSignal size={18} />
                )}
              </button>
            )}
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
        </>
        )}
      </Card>

      {/* Teams Call Modal */}
      {showTeamsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowTeamsModal(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
              <button
                onClick={() => { joinTeamsCall(currentMeetingUrl); }}
                disabled={teamsJoining}
                className="w-full rounded-lg bg-cyan/10 border border-cyan/25 px-4 py-3 text-[12px] font-medium text-cyan hover:bg-cyan/20 transition-colors mb-3 flex items-center gap-2 disabled:opacity-40"
              >
                <MdVideoCall size={18} />
                {teamsJoining ? 'Joining…' : 'Add to current meeting'}
              </button>
            )}
            <div className="flex items-center gap-2 mb-3">
              {currentMeetingUrl && <span className="text-[10px] text-txt-faint uppercase tracking-wider">or paste a link</span>}
            </div>
            <input
              type="text"
              value={teamsMeetingUrl}
              onChange={(e) => setTeamsMeetingUrl(e.target.value)}
              placeholder="https://teams.microsoft.com/l/meetup-join/..."
              className="w-full rounded-lg border border-border bg-raised px-4 py-2.5 text-[13px] text-txt-secondary placeholder-txt-faint outline-none focus:border-cyan/40 mb-3"
              onKeyDown={(e) => { if (e.key === 'Enter') joinTeamsCall(); }}
              autoFocus
            />
            {teamsError && (
              <p className="text-[11px] text-rose-400 mb-3">{teamsError}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowTeamsModal(false)}
                className="rounded-lg border border-border px-4 py-2 text-[12px] text-txt-muted hover:bg-raised transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => joinTeamsCall()}
                disabled={teamsJoining || !teamsMeetingUrl.trim()}
                className="rounded-lg bg-cyan px-4 py-2 text-[12px] font-medium text-white hover:bg-cyan/80 disabled:opacity-40 transition-colors"
              >
                {teamsJoining ? 'Joining…' : 'Join Call'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
