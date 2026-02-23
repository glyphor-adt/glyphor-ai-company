import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import { useAgents } from '../lib/hooks';
import { DISPLAY_NAME_MAP, AGENT_META } from '../lib/types';
import { Card, AgentAvatar } from '../components/ui';
import { supabase, SCHEDULER_URL } from '../lib/supabase';

interface Message {
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
}

/** Strip <reasoning>...</reasoning> envelope from agent output */
function stripReasoning(text: string): string {
  return text.replace(/<reasoning>[\s\S]*?<\/reasoning>\s*/g, '').trim();
}

/** Persist a message to Supabase */
async function saveMessage(agentRole: string, role: 'user' | 'agent', content: string) {
  await (supabase.from('chat_messages') as any).insert({
    agent_role: agentRole,
    role,
    content,
  });
}

export default function Chat() {
  const { agentId } = useParams();
  const { data: agents } = useAgents();
  const [selectedRole, setSelectedRole] = useState(agentId ?? 'chief-of-staff');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load chat history for the selected agent
  const loadHistory = useCallback(async (role: string) => {
    setLoadingHistory(true);
    try {
      const { data } = await (supabase
        .from('chat_messages') as any)
        .select('role, content, created_at')
        .eq('agent_role', role)
        .order('created_at', { ascending: true })
        .limit(100) as { data: { role: string; content: string; created_at: string }[] | null };

      if (data?.length) {
        setMessages(
          data.map((row) => ({
            role: row.role as 'user' | 'agent',
            content: row.content,
            timestamp: new Date(row.created_at),
          })),
        );
      } else {
        setMessages([]);
      }
    } catch {
      setMessages([]);
    }
    setLoadingHistory(false);
  }, []);

  // Load history on mount and when agent changes
  useEffect(() => {
    loadHistory(selectedRole);
  }, [selectedRole, loadHistory]);

  // Sync route param
  useEffect(() => {
    if (agentId) setSelectedRole(agentId);
  }, [agentId]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const selectedAgent = agents.find((a) => a.role === selectedRole);
  const codename = DISPLAY_NAME_MAP[selectedRole] ?? selectedRole;

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: Message = { role: 'user', content: text, timestamp: new Date() };
    setInput('');
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    // Persist user message
    saveMessage(selectedRole, 'user', text);

    try {
      // Send prior conversation for multi-turn context (last 20 messages)
      const history = messages.slice(-20).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch(`${SCHEDULER_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentRole: selectedRole, task: 'on_demand', message: text, history }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      let content: string;
      if (data.output) {
        content = stripReasoning(data.output);
      } else if (data.error) {
        content = `I ran into an issue: ${data.error}`;
      } else if (data.reason) {
        content = data.reason;
      } else if (data.status === 'aborted') {
        content = 'My response was cut short — I may have timed out. Try a simpler question.';
      } else {
        content = `I completed the task but had nothing to report. (status: ${data.status ?? 'unknown'})`;
      }

      setMessages((prev) => [
        ...prev,
        { role: 'agent', content, timestamp: new Date() },
      ]);

      // Persist agent response
      saveMessage(selectedRole, 'agent', content);
    } catch {
      const errContent = `Could not reach ${codename}. The scheduler may be cold-starting — try again in a moment.`;
      setMessages((prev) => [
        ...prev,
        { role: 'agent', content: errContent, timestamp: new Date() },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-6rem)] gap-5">
      {/* ── Agent List (Left) ────────────── */}
      <div className="w-56 flex-shrink-0 space-y-1 overflow-y-auto">
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
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                active
                  ? 'bg-cyan/10 border border-cyan/25'
                  : 'border border-transparent hover:bg-[var(--color-hover-bg)]'
              }`}
            >
              <img
                src={`/avatars/${agent.role}.png`}
                alt={agent.role}
                className="h-7 w-7 rounded-full object-cover"
                style={{ border: `1.5px solid ${meta?.color ?? '#64748b'}40` }}
              />
              <div className="min-w-0">
                <p
                  className={`text-[12px] font-medium truncate ${
                    active ? 'text-cyan' : 'text-txt-secondary'
                  }`}
                >
                  {DISPLAY_NAME_MAP[agent.role] ?? agent.role}
                </p>
                <p className="text-[10px] text-txt-faint truncate">{agent.role}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Chat Area (Right) ────────────── */}
      <Card className="flex flex-1 flex-col min-h-0">
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
                await (supabase.from('chat_messages') as any).delete().eq('agent_role', selectedRole);
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
                  Messages are sent to the scheduler API on Cloud Run
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-3 animate-fade-up ${
                msg.role === 'user' ? 'flex-row-reverse' : ''
              }`}
              style={{ animationDelay: `${i * 30}ms` }}
            >
              {msg.role === 'agent' ? (
                <AgentAvatar role={selectedRole} size={28} />
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan/20 text-[11px] font-bold text-cyan">
                  KD
                </div>
              )}
              <div
                className={`max-w-[70%] rounded-xl px-4 py-2.5 text-[13px] leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-cyan/10 text-txt-secondary border border-cyan/20'
                    : 'bg-raised text-txt-secondary border border-border'
                }`}
              >
                {msg.role === 'agent' ? (
                  <div className="prose-chat">
                    <Markdown>{msg.content}</Markdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
                <p className="mt-1.5 text-[10px] text-txt-faint">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}

          {sending && (
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

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border pt-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message ${codename}...`}
              disabled={sending}
              className="flex-1 rounded-lg border border-border bg-raised px-4 py-2.5 text-[13px] text-txt-secondary placeholder-txt-faint outline-none transition-colors focus:border-cyan/40 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="rounded-lg bg-cyan px-5 py-2.5 text-[13px] font-semibold text-white dark:text-gray-900 transition-all hover:opacity-90 disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      </Card>
    </div>
  );
}
