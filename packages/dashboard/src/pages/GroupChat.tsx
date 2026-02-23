import { useState, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import { useAgents } from '../lib/hooks';
import { DISPLAY_NAME_MAP, AGENT_META } from '../lib/types';
import { Card, AgentAvatar } from '../components/ui';
import { SCHEDULER_URL } from '../lib/supabase';

interface GroupMessage {
  role: 'user' | 'agent';
  agentRole?: string;
  content: string;
  timestamp: Date;
}

/** Strip <reasoning>...</reasoning> envelope from agent output */
function stripReasoning(text: string): string {
  return text.replace(/<reasoning>[\s\S]*?<\/reasoning>\s*/g, '').trim();
}

export default function GroupChat() {
  const { data: agents } = useAgents();
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(
    new Set(['chief-of-staff', 'cto', 'cfo']),
  );
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [respondingAgents, setRespondingAgents] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleAgent = (role: string) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) {
        next.delete(role);
      } else {
        next.add(role);
      }
      return next;
    });
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending || selectedRoles.size === 0) return;

    setInput('');
    const userMsg: GroupMessage = { role: 'user', content: text, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    const roles = Array.from(selectedRoles);
    setRespondingAgents(new Set(roles));

    // Build history for context (last 20 messages)
    const history = messages.slice(-20).map((m) => ({
      role: m.role,
      content: m.agentRole
        ? `[${DISPLAY_NAME_MAP[m.agentRole] ?? m.agentRole}]: ${m.content}`
        : m.content,
    }));

    // Include info about who else is in the group
    const groupContext = `You are in a group chat with: ${roles.map((r) => DISPLAY_NAME_MAP[r] ?? r).join(', ')}. The founder is also present. Keep your response concise — others will also respond.`;

    // Fire off all agent requests concurrently
    const promises = roles.map(async (agentRole) => {
      try {
        const res = await fetch(`${SCHEDULER_URL}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentRole,
            task: 'on_demand',
            message: `${groupContext}\n\n${text}`,
            history,
          }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        let content: string;
        if (data.output) {
          content = stripReasoning(data.output);
        } else if (data.error) {
          content = `I ran into an issue: ${data.error}`;
        } else if (data.status === 'aborted') {
          content = 'My response was cut short — try a simpler question.';
        } else {
          content = `Completed but had nothing to report. (status: ${data.status ?? 'unknown'})`;
        }

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
      }
    }

    setSending(false);
  };

  return (
    <div className="flex h-[calc(100vh-6rem)] gap-5">
      {/* ── Agent Selector (Left) ────────────── */}
      <div className="w-56 flex-shrink-0 space-y-1 overflow-y-auto">
        <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-txt-muted">
          Group Members
        </p>
        <p className="mb-3 text-[10px] text-txt-faint">
          Select agents to include in the conversation
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
          <div className="flex -space-x-2">
            {Array.from(selectedRoles)
              .slice(0, 5)
              .map((role) => (
                <AgentAvatar key={role} role={role} size={28} />
              ))}
            {selectedRoles.size > 5 && (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-raised border border-border text-[10px] font-bold text-txt-muted">
                +{selectedRoles.size - 5}
              </div>
            )}
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-txt-primary">
              Group Chat
            </h2>
            <p className="text-[11px] text-txt-muted">
              {selectedRoles.size} agent{selectedRoles.size !== 1 ? 's' : ''} ·{' '}
              {Array.from(selectedRoles)
                .slice(0, 3)
                .map((r) => DISPLAY_NAME_MAP[r] ?? r)
                .join(', ')}
              {selectedRoles.size > 3 ? ` +${selectedRoles.size - 3}` : ''}
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-txt-muted">
                  Start a group conversation
                </p>
                <p className="mt-1 text-[11px] text-txt-faint">
                  All selected agents will respond to each message
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
              {msg.role === 'agent' && msg.agentRole ? (
                <AgentAvatar role={msg.agentRole} size={28} />
              ) : msg.role === 'user' ? (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan/20 text-[11px] font-bold text-cyan">
                  KD
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
                  <p
                    className="text-[11px] font-semibold mb-1"
                    style={{ color: AGENT_META[msg.agentRole]?.color ?? '#64748b' }}
                  >
                    {DISPLAY_NAME_MAP[msg.agentRole] ?? msg.agentRole}
                  </p>
                )}
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
              placeholder={
                selectedRoles.size === 0
                  ? 'Select at least one agent...'
                  : `Message ${selectedRoles.size} agent${selectedRoles.size !== 1 ? 's' : ''}...`
              }
              disabled={sending || selectedRoles.size === 0}
              className="flex-1 rounded-lg border border-border bg-raised px-4 py-2.5 text-[13px] text-txt-secondary placeholder-txt-faint outline-none transition-colors focus:border-cyan/40 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={sending || !input.trim() || selectedRoles.size === 0}
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
