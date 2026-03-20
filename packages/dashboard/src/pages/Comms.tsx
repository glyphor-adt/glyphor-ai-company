import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Chat from './Chat';
import ChatMarkdown from '../components/ChatMarkdown';
import { apiCall, SCHEDULER_URL } from '../lib/firebase';
import { DISPLAY_NAME_MAP } from '../lib/types';
import { Card, GradientButton, PageTabs, Skeleton, timeAgo } from '../components/ui';

/* ─── Types ────────────────────────────────── */
interface AgentMessage {
  id: string;
  from_agent: string;
  to_agent: string;
  thread_id: string;
  message: string;
  message_type: string;
  priority: string;
  status: string;
  created_at: string;
}

interface EmailActivity {
  id: string;
  agent_role: string;
  task: string;
  status: string;
  result_summary: string | null;
  output: string | null;
  cost: number | null;
  started_at: string;
  completed_at: string | null;
}

const TYPE_STYLES: Record<string, string> = {
  request:  'text-white bg-gradient-to-r from-sky-400 via-sky-500 to-sky-600',
  response: 'text-white bg-gradient-to-r from-green-400 via-green-500 to-green-600',
  info:     'text-white bg-gradient-to-r from-gray-400 via-gray-500 to-gray-600',
  followup: 'text-white bg-gradient-to-r from-violet-500 via-violet-600 to-violet-700',
  task:     'text-white bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600',
  alert:    'text-white bg-gradient-to-r from-red-400 via-red-500 to-red-600',
  blocker:  'text-white bg-gradient-to-r from-red-400 via-red-500 to-red-600',
  escalation: 'text-white bg-gradient-to-r from-red-400 via-red-500 to-red-600',
  notification: 'text-white bg-gradient-to-r from-cyan-400 via-cyan-500 to-cyan-600',
  status_update: 'text-white bg-gradient-to-r from-gray-400 via-gray-500 to-gray-600',
  delegation: 'text-white bg-gradient-to-r from-violet-500 via-violet-600 to-violet-700',
};

const MESSAGE_TYPES = ['all', 'request', 'response', 'task', 'followup', 'alert', 'blocker', 'escalation', 'delegation', 'info', 'notification', 'status_update'] as const;

function agentName(role: string): string {
  return DISPLAY_NAME_MAP[role] ?? role;
}

/** Collect unique agent roles from messages for the dropdown. */
function uniqueAgents(messages: AgentMessage[]): string[] {
  const set = new Set<string>();
  for (const m of messages) {
    set.add(m.from_agent);
    set.add(m.to_agent);
  }
  return Array.from(set).sort((a, b) => agentName(a).localeCompare(agentName(b)));
}

type Tab = 'feed' | 'email' | 'assign' | 'chat';

/* ─── Inter-Agent Feed ──────────────────────── */
function InterAgentFeed() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const data = await apiCall<AgentMessage[]>(
        '/api/agent_messages?order=created_at.desc&limit=200',
      );
      setMessages(data ?? []);
    } catch (err) {
      console.error('[InterAgentFeed] Failed to load messages:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const agents = useMemo(() => uniqueAgents(messages), [messages]);

  const filtered = useMemo(() => {
    let result = messages;

    // Type filter
    if (typeFilter !== 'all') {
      result = result.filter((m) => m.message_type === typeFilter);
    }

    // Agent filter
    if (agentFilter) {
      result = result.filter(
        (m) => m.from_agent === agentFilter || m.to_agent === agentFilter,
      );
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) =>
          m.message.toLowerCase().includes(q) ||
          agentName(m.from_agent).toLowerCase().includes(q) ||
          agentName(m.to_agent).toLowerCase().includes(q),
      );
    }

    return result;
  }, [messages, typeFilter, agentFilter, search]);

  // Stats
  const stats = useMemo(() => {
    const now = Date.now();
    const last24h = messages.filter((m) => now - new Date(m.created_at).getTime() < 86_400_000);
    const urgent = last24h.filter((m) => m.priority === 'urgent');
    const pending = messages.filter((m) => m.status === 'pending');
    const uniquePairs = new Set(messages.map((m) => `${m.from_agent}->${m.to_agent}`));
    return { total24h: last24h.length, urgent: urgent.length, pending: pending.length, pairs: uniquePairs.size };
  }, [messages]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Messages (24h)', value: stats.total24h, color: '#00E0FF' },
          { label: 'Urgent', value: stats.urgent, accent: stats.urgent > 0, color: '#A855F7' },
          { label: 'Unread', value: stats.pending, accent: stats.pending > 0, color: '#C084FC' },
          { label: 'Active Pairs', value: stats.pairs, color: '#7DD3FC' },
        ].map((s) => (
          <div key={s.label} className="glass-surface rounded-xl text-center px-3 py-3" style={{ borderTopColor: s.color, borderTopWidth: '2px' }}>
            <p className={`text-xl font-bold ${s.accent ? 'text-prism-critical' : 'dark:text-white text-txt-primary'}`}>{s.value}</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: s.color }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Search + filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search messages…"
          className="flex-1 min-w-[200px] rounded-lg border border-border bg-raised px-3 py-1.5 text-sm text-txt-secondary outline-none focus:border-cyan/60 placeholder:text-txt-faint"
        />
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="rounded-lg border border-border bg-raised px-3 py-1.5 text-sm text-txt-secondary outline-none focus:border-cyan/60"
        >
          <option value="">All Agents</option>
          {agents.map((role) => (
            <option key={role} value={role}>{agentName(role)}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-border bg-raised px-3 py-1.5 text-sm text-txt-secondary outline-none focus:border-cyan/60"
        >
          {MESSAGE_TYPES.map((t) => (
            <option key={t} value={t}>{t === 'all' ? 'All Types' : t.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <span className="text-[10px] text-txt-faint whitespace-nowrap">
          {filtered.length} of {messages.length}
        </span>
      </div>

      {/* Message feed */}
      <Card>
        {filtered.length === 0 ? (
          <p className="text-sm text-txt-faint py-8 text-center">No messages match these filters</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((m) => {
              const isExpanded = expandedIds.has(m.id);
              const isLong = m.message.length > 300;
              return (
                <li key={m.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-3">
                    {/* Type + priority badges */}
                    <div className="flex flex-col items-center gap-1 min-w-[70px]">
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${TYPE_STYLES[m.message_type] ?? TYPE_STYLES.info}`}>
                        {m.message_type.replace(/_/g, ' ')}
                      </span>
                      {m.priority === 'urgent' && (
                        <span className="rounded-full bg-prism-critical/15 px-1.5 py-0.5 text-[9px] font-bold text-prism-critical">URGENT</span>
                      )}
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5 text-xs">
                        <span className="font-semibold text-txt-primary">{agentName(m.from_agent)}</span>
                        <span className="text-txt-faint">→</span>
                        <span className="font-semibold text-txt-secondary">{agentName(m.to_agent)}</span>
                        <span className="ml-auto text-txt-faint whitespace-nowrap">{timeAgo(m.created_at)}</span>
                      </div>
                      <div className={`mt-1 text-sm text-txt-secondary ${!isExpanded && isLong ? 'max-h-[4.5em] overflow-hidden' : ''}`}>
                        <ChatMarkdown>{m.message}</ChatMarkdown>
                      </div>
                      {isLong && (
                        <button
                          onClick={() => toggleExpand(m.id)}
                          className="mt-1 text-[11px] text-cyan hover:underline"
                        >
                          {isExpanded ? 'Show less' : 'Show more'}
                        </button>
                      )}
                    </div>
                    {/* Status dot */}
                    <div className="flex-shrink-0 mt-1">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          m.status === 'pending' ? 'bg-prism-elevated' : m.status === 'read' ? 'bg-tier-green' : 'bg-prism-moderate'
                        }`}
                        title={m.status}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ─── Email Activity ────────────────────────── */
function EmailActivityFeed() {
  const [runs, setRuns] = useState<EmailActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentFilter, setAgentFilter] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const data = await apiCall<EmailActivity[]>(
        '/api/agent-runs?task=agent365_mail_triage&order=started_at.desc&limit=100',
      );
      setRuns(data ?? []);
    } catch (err) {
      console.error('[EmailActivity] Failed to load:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  const agents = useMemo(() => {
    const set = new Set(runs.map((r) => r.agent_role));
    return Array.from(set).sort((a, b) => agentName(a).localeCompare(agentName(b)));
  }, [runs]);

  const filtered = useMemo(() => {
    if (!agentFilter) return runs;
    return runs.filter((r) => r.agent_role === agentFilter);
  }, [runs, agentFilter]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="rounded-lg border border-border bg-raised px-3 py-1.5 text-sm text-txt-secondary outline-none focus:border-cyan/60"
        >
          <option value="">All Agents</option>
          {agents.map((role) => (
            <option key={role} value={role}>{agentName(role)}</option>
          ))}
        </select>
        <span className="text-[10px] text-txt-faint">
          {filtered.length} email run{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      <Card>
        {filtered.length === 0 ? (
          <p className="text-sm text-txt-faint py-8 text-center">No email activity found</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((r) => {
              const isExpanded = expandedIds.has(r.id);
              const content = r.result_summary || r.output || '';
              const isLong = content.length > 300;
              return (
                <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-1 min-w-[70px]">
                      <span className={`rounded-lg px-2 py-0.5 text-[9px] font-semibold uppercase ${
                        r.status === 'completed' ? 'text-white bg-gradient-to-r from-green-400 via-green-500 to-green-600'
                        : r.status === 'failed' ? 'text-white bg-gradient-to-r from-red-400 via-red-500 to-red-600'
                        : 'text-white bg-gradient-to-r from-gray-400 via-gray-500 to-gray-600'
                      }`}>
                        {r.status}
                      </span>
                      {r.cost != null && (
                        <span className="text-[9px] text-txt-faint">${r.cost.toFixed(3)}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5 text-xs">
                        <span className="font-semibold text-txt-primary">{agentName(r.agent_role)}</span>
                        <span className="text-txt-faint">· {r.task.replace(/_/g, ' ')}</span>
                        <span className="ml-auto text-txt-faint whitespace-nowrap">{timeAgo(r.started_at)}</span>
                      </div>
                      {content && (
                        <>
                          <div className={`mt-1 text-sm text-txt-secondary ${!isExpanded && isLong ? 'max-h-[4.5em] overflow-hidden' : ''}`}>
                            <ChatMarkdown>{content}</ChatMarkdown>
                          </div>
                          {isLong && (
                            <button
                              onClick={() => toggleExpand(r.id)}
                              className="mt-1 text-[11px] text-cyan hover:underline"
                            >
                              {isExpanded ? 'Show less' : 'Show more'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ─── Quick Assign (global) ─────────────────── */
function QuickAssign() {
  const [agents, setAgents] = useState<{ role: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [task, setTask] = useState('');
  const [expected, setExpected] = useState('');
  const [priority, setPriority] = useState<'normal' | 'high' | 'urgent' | 'low'>('normal');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const taskRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiCall<{ role: string; status: string }[]>(
          '/api/company_agents?status=active&select=role,status&order=role.asc',
        );
        setAgents(data ?? []);
      } catch {
        setAgents([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSubmit = async () => {
    if (!selectedAgent || !task.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      const resp = await fetch(`${SCHEDULER_URL}/quick-assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentRole: selectedAgent,
          taskDescription: task.trim(),
          expectedOutput: expected.trim() || undefined,
          priority,
          assignedBy: 'founder',
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setResult({
          success: true,
          message: `Assignment created (${data.id?.slice(0, 8)}…) for ${agentName(selectedAgent)}. They will pick this up on their next heartbeat.`,
        });
        setTask('');
        setExpected('');
        setPriority('normal');
      } else {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        setResult({ success: false, message: err.error || `Failed (${resp.status})` });
      }
    } catch (err) {
      setResult({ success: false, message: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="space-y-4 p-5">
        <div>
          <h3 className="text-sm font-semibold text-txt-primary">Quick Assign</h3>
          <p className="mt-1 text-xs text-txt-faint">
            Assign tracked work directly to any agent. No directive needed — the agent picks it up at P2 priority on their next heartbeat.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-txt-muted mb-1">Agent *</label>
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/60"
            >
              <option value="">Select an agent…</option>
              {agents.map((a) => (
                <option key={a.role} value={a.role}>{agentName(a.role)} ({a.role})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-txt-muted mb-1">Task Description *</label>
            <textarea
              ref={taskRef}
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="What should this agent do? Be specific about the desired outcome."
              rows={4}
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/60 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-txt-muted mb-1">Expected Output</label>
            <input
              type="text"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
              placeholder="e.g., A summary report, a code fix, a Slack message"
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/60"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-txt-muted mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
              className="rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/60"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          {result && (
            <p className={`text-xs rounded-lg px-3 py-2 ${result.success ? 'text-white bg-gradient-to-r from-green-400 via-green-500 to-green-600' : 'text-white bg-gradient-to-r from-red-400 via-red-500 to-red-600'}`}>
              {result.message}
            </p>
          )}

          <GradientButton
            variant="primary"
            size="md"
            onClick={handleSubmit}
            disabled={!selectedAgent || !task.trim() || submitting}
          >
            {submitting ? 'Assigning…' : 'Assign Task'}
          </GradientButton>
        </div>
      </Card>
    </div>
  );
}

/* ─── Main Comms Page ───────────────────────── */
export default function Comms() {
  const [tab, setTab] = useState<Tab>('feed');

  return (
    <div className="flex flex-col h-[calc(100dvh-10rem-var(--sat))] md:h-[calc(100vh-6rem)]">
      <div className="flex-shrink-0">
        <h1 className="text-xl md:text-2xl font-bold text-txt-primary">Comms</h1>
        <p className="mt-1 text-xs md:text-sm text-txt-muted">
          Inter-agent messages, email activity, and task assignment
        </p>
        <div className="mt-3">
          <PageTabs
            tabs={[
              { key: 'feed' as Tab, label: 'Inter-Agent Feed' },
              { key: 'email' as Tab, label: 'Email Activity' },
              { key: 'assign' as Tab, label: 'Quick Assign' },
              { key: 'chat' as Tab, label: 'Agent Chat' },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 mt-3 overflow-y-auto">
        {tab === 'feed' ? <InterAgentFeed />
          : tab === 'email' ? <EmailActivityFeed />
          : tab === 'assign' ? <QuickAssign />
          : <Chat embedded />}
      </div>
    </div>
  );
}
