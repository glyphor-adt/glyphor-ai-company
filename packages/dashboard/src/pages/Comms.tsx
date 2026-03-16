import { useCallback, useEffect, useMemo, useState } from 'react';
import Chat from './Chat';
import { apiCall } from '../lib/firebase';
import { DISPLAY_NAME_MAP } from '../lib/types';
import { Card, PageTabs, Skeleton, timeAgo } from '../components/ui';

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

const TYPE_STYLES: Record<string, string> = {
  request:  'bg-prism-fill-3/15 text-prism-sky',
  response: 'bg-tier-green/15 text-tier-green',
  info:     'bg-prism-moderate/15 text-prism-moderate',
  followup: 'bg-prism-violet/15 text-prism-violet',
  task:     'bg-prism-elevated/15 text-prism-elevated',
  alert:    'bg-prism-critical/15 text-prism-critical',
  blocker:  'bg-prism-critical/15 text-prism-critical',
  escalation: 'bg-prism-critical/15 text-prism-critical',
  notification: 'bg-cyan/15 text-cyan',
  status_update: 'bg-prism-moderate/15 text-prism-moderate',
  delegation: 'bg-prism-violet/15 text-prism-violet',
};

function agentName(role: string): string {
  return DISPLAY_NAME_MAP[role] ?? role;
}

type Tab = 'chat' | 'feed';

/* ─── Inter-Agent Feed ──────────────────────── */
function InterAgentFeed() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'urgent' | 'requests'>('all');

  const load = useCallback(async () => {
    try {
      const data = await apiCall<AgentMessage[]>(
        '/api/agent_messages?order=created_at.desc&limit=100',
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
    const interval = setInterval(load, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'urgent') return messages.filter((m) => m.priority === 'urgent');
    if (filter === 'requests') return messages.filter((m) => m.message_type === 'request' || m.message_type === 'task');
    return messages;
  }, [messages, filter]);

  // Stats
  const stats = useMemo(() => {
    const now = Date.now();
    const last24h = messages.filter((m) => now - new Date(m.created_at).getTime() < 86_400_000);
    const urgent = last24h.filter((m) => m.priority === 'urgent');
    const pending = messages.filter((m) => m.status === 'pending');
    const uniquePairs = new Set(messages.map((m) => `${m.from_agent}->${m.to_agent}`));
    return { total24h: last24h.length, urgent: urgent.length, pending: pending.length, pairs: uniquePairs.size };
  }, [messages]);

  if (loading) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Messages (24h)', value: stats.total24h },
          { label: 'Urgent', value: stats.urgent, accent: stats.urgent > 0 },
          { label: 'Unread', value: stats.pending, accent: stats.pending > 0 },
          { label: 'Active Pairs', value: stats.pairs },
        ].map((s) => (
          <Card key={s.label} className="text-center py-3">
            <p className={`text-xl font-bold ${s.accent ? 'text-prism-critical' : 'text-txt-primary'}`}>{s.value}</p>
            <p className="text-[10px] font-medium uppercase tracking-wider text-txt-faint">{s.label}</p>
          </Card>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        {(['all', 'urgent', 'requests'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
              filter === f
                ? 'bg-cyan/15 text-cyan'
                : 'text-txt-muted hover:text-txt-secondary hover:bg-white/5'
            }`}
          >
            {f === 'all' ? 'All' : f === 'urgent' ? '🔴 Urgent' : '📨 Requests'}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-txt-faint">
          {filtered.length} message{filtered.length !== 1 ? 's' : ''} · auto-refreshes
        </span>
      </div>

      {/* Message feed */}
      <Card className="max-h-[65vh] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-sm text-txt-faint py-8 text-center">No messages match this filter</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((m) => (
              <li key={m.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  {/* Type + priority badges */}
                  <div className="flex flex-col items-center gap-1 min-w-[70px]">
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${TYPE_STYLES[m.message_type] ?? TYPE_STYLES.info}`}>
                      {m.message_type}
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
                    <p className="mt-1 text-sm text-txt-secondary whitespace-pre-wrap break-words line-clamp-4">
                      {m.message}
                    </p>
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
            ))}
          </ul>
        )}
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
          Inter-agent messages and founder chat
        </p>
        <div className="mt-3">
          <PageTabs
            tabs={[
              { key: 'feed' as Tab, label: 'Inter-Agent Feed' },
              { key: 'chat' as Tab, label: 'Agent Chat' },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 mt-3 overflow-y-auto">
        {tab === 'chat' ? <Chat embedded /> : <InterAgentFeed />}
      </div>
    </div>
  );
}
