import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { DISPLAY_NAME_MAP, AGENT_META } from '../lib/types';
import {
  Card,
  SectionHeader,
  AgentAvatar,
  Skeleton,
  timeAgo,
} from '../components/ui';

/* ─── Types ─────────────────────────────────── */
interface AgentRun {
  id: string;
  agent_id: string;
  task: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  cost: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  tool_calls: number | null;
  turns: number | null;
  error: string | null;
  output: string | null;
  input: string | null;
}

/* ─── Hooks ─────────────────────────────────── */
function useAgentRuns(limit = 100) {
  const [data, setData] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: rows } = await supabase
      .from('agent_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);
    setData((rows as AgentRun[]) ?? []);
    setLoading(false);
  }, [limit]);

  useEffect(() => { refresh(); }, [refresh]);

  // Real-time subscription for new runs and status updates
  useEffect(() => {
    const channel = supabase
      .channel('agent_runs_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_runs' },
        () => { refresh(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refresh]);

  return { data, loading, refresh };
}

/* ─── Helpers ───────────────────────────────── */
function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatTokens(n: number | null): string {
  if (n == null) return '—';
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function statusConfig(status: string) {
  switch (status) {
    case 'running':
      return { dot: 'bg-cyan animate-pulse', label: 'Running', badge: 'border-cyan/30 bg-cyan/10 text-cyan' };
    case 'completed':
      return { dot: 'bg-tier-green', label: 'Completed', badge: 'border-tier-green/30 bg-tier-green/10 text-tier-green' };
    case 'failed':
      return { dot: 'bg-red-400', label: 'Failed', badge: 'border-red-400/30 bg-red-400/10 text-red-400' };
    default:
      return { dot: 'bg-txt-faint', label: status, badge: 'border-border bg-raised text-txt-muted' };
  }
}

/* ─── Filters ───────────────────────────────── */
type StatusFilter = 'all' | 'running' | 'completed' | 'failed';

export default function Activity() {
  const { data: runs, loading } = useAgentRuns(200);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Unique agents that have runs
  const agentIds = useMemo(() => {
    const set = new Set(runs.map((r) => r.agent_id));
    return Array.from(set).sort();
  }, [runs]);

  // Filter runs
  const filtered = useMemo(() => {
    return runs.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (agentFilter !== 'all' && r.agent_id !== agentFilter) return false;
      return true;
    });
  }, [runs, statusFilter, agentFilter]);

  // Currently running
  const runningNow = useMemo(() => runs.filter((r) => r.status === 'running'), [runs]);

  // Stats
  const stats = useMemo(() => {
    const total = runs.length;
    const running = runs.filter((r) => r.status === 'running').length;
    const completed = runs.filter((r) => r.status === 'completed').length;
    const failed = runs.filter((r) => r.status === 'failed').length;
    const totalCost = runs.reduce((s, r) => s + (Number(r.cost) || 0), 0);
    return { total, running, completed, failed, totalCost };
  }, [runs]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-txt-primary">Activity</h1>
        <p className="mt-1 text-sm text-txt-muted">Live agent runs and task history</p>
      </div>

      {/* ── Summary Stats ──────────────────── */}
      <div className="grid grid-cols-5 gap-4">
        <MiniStat label="Total Runs" value={String(stats.total)} loading={loading} />
        <MiniStat
          label="Running Now"
          value={String(stats.running)}
          loading={loading}
          highlight={stats.running > 0}
        />
        <MiniStat label="Completed" value={String(stats.completed)} loading={loading} />
        <MiniStat label="Failed" value={String(stats.failed)} loading={loading} alert={stats.failed > 0} />
        <MiniStat label="Total Cost" value={`$${stats.totalCost.toFixed(2)}`} loading={loading} />
      </div>

      {/* ── Live Running Banner ────────────── */}
      {runningNow.length > 0 && (
        <Card className="border-cyan/20 bg-cyan/5">
          <SectionHeader title={`${runningNow.length} Agent${runningNow.length > 1 ? 's' : ''} Running Now`} />
          <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {runningNow.map((run) => (
              <div
                key={run.id}
                className="flex items-center gap-3 rounded-lg border border-cyan/20 bg-surface px-3 py-2.5"
              >
                <div className="relative">
                  <AgentAvatar role={run.agent_id} size={32} />
                  <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-cyan ring-2 ring-surface animate-pulse" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-txt-primary truncate">
                    {DISPLAY_NAME_MAP[run.agent_id] ?? run.agent_id}
                  </p>
                  <p className="text-[11px] text-cyan truncate">
                    {run.task ?? 'unknown task'}
                  </p>
                  <p className="text-[10px] text-txt-faint">
                    Started {timeAgo(run.started_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Filters ────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface p-1">
          {(['all', 'running', 'completed', 'failed'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                statusFilter === s
                  ? 'bg-raised text-txt-primary shadow-sm'
                  : 'text-txt-muted hover:text-txt-secondary'
              }`}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              {s === 'running' && stats.running > 0 && (
                <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-cyan/20 text-[10px] text-cyan">
                  {stats.running}
                </span>
              )}
            </button>
          ))}
        </div>

        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] text-txt-secondary focus:outline-none focus:ring-1 focus:ring-cyan/30"
        >
          <option value="all">All agents</option>
          {agentIds.map((id) => (
            <option key={id} value={id}>{DISPLAY_NAME_MAP[id] ?? id}</option>
          ))}
        </select>

        <span className="ml-auto text-[11px] text-txt-faint">
          {filtered.length} run{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Run History Table ──────────────── */}
      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="space-y-0 divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-4 py-3">
                <Skeleton className="h-10" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-txt-faint">No runs found</p>
        ) : (
          <div className="divide-y divide-border">
            {/* Header */}
            <div className="grid grid-cols-[2fr_1.5fr_100px_90px_80px_80px_70px_90px] gap-2 bg-raised px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-txt-muted">
              <span>Agent</span>
              <span>Task</span>
              <span>Status</span>
              <span>Duration</span>
              <span>Tokens</span>
              <span>Tools</span>
              <span>Cost</span>
              <span>Started</span>
            </div>

            {/* Rows */}
            {filtered.map((run) => {
              const sc = statusConfig(run.status);
              const isExpanded = expandedId === run.id;
              const hasDetail = !!(run.output || run.input || run.error);
              return (
                <div key={run.id}>
                  <div
                    onClick={() => hasDetail && setExpandedId(isExpanded ? null : run.id)}
                    className={`grid grid-cols-[2fr_1.5fr_100px_90px_80px_80px_70px_90px] gap-2 items-center px-4 py-2.5 transition-colors hover:bg-raised/50 ${
                      run.status === 'running' ? 'bg-cyan/[0.03]' : ''
                    } ${hasDetail ? 'cursor-pointer' : ''}`}
                  >
                    {/* Agent */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AgentAvatar role={run.agent_id} size={28} />
                      <Link
                        to={`/agents/${run.agent_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[13px] font-medium text-txt-secondary hover:text-txt-primary truncate transition-colors"
                      >
                        {DISPLAY_NAME_MAP[run.agent_id] ?? run.agent_id}
                      </Link>
                      {hasDetail && (
                        <span className={`text-[10px] text-txt-faint transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                      )}
                    </div>

                    {/* Task */}
                    <span className="text-[12px] text-txt-muted truncate font-mono">
                      {run.task ?? '—'}
                    </span>

                    {/* Status */}
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block h-2 w-2 rounded-full ${sc.dot}`} />
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${sc.badge}`}>
                        {sc.label}
                      </span>
                    </div>

                    {/* Duration */}
                    <span className="text-[12px] font-mono text-txt-muted">
                      {run.status === 'running' ? (
                        <span className="text-cyan animate-pulse">…</span>
                      ) : (
                        formatDuration(run.duration_ms)
                      )}
                    </span>

                    {/* Tokens */}
                    <span className="text-[11px] text-txt-faint font-mono">
                      {run.input_tokens != null || run.output_tokens != null
                        ? `${formatTokens(run.input_tokens)}/${formatTokens(run.output_tokens)}`
                        : '—'}
                    </span>

                    {/* Tool calls */}
                    <span className="text-[11px] text-txt-faint font-mono">
                      {run.tool_calls ?? '—'}
                    </span>

                    {/* Cost */}
                    <span className="text-[12px] font-mono text-txt-muted">
                      {run.cost != null ? `$${Number(run.cost).toFixed(3)}` : '—'}
                    </span>

                    {/* Started */}
                    <span className="text-[10px] text-txt-faint">
                      {timeAgo(run.started_at)}
                    </span>
                  </div>

                  {/* Expanded detail panel */}
                  {isExpanded && (
                    <div className="border-t border-border bg-raised/30 px-6 py-4 space-y-3">
                      {run.input && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-txt-muted mb-1">Input</p>
                          <p className="text-[12px] text-txt-secondary whitespace-pre-wrap bg-surface rounded-md border border-border px-3 py-2">
                            {run.input}
                          </p>
                        </div>
                      )}
                      {run.output && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-txt-muted mb-1">Output</p>
                          <div className="text-[12px] text-txt-secondary whitespace-pre-wrap bg-surface rounded-md border border-border px-3 py-2 max-h-[400px] overflow-y-auto">
                            {run.output}
                          </div>
                        </div>
                      )}
                      {run.error && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-red-400 mb-1">Error</p>
                          <p className="text-[12px] text-red-300 whitespace-pre-wrap bg-red-400/5 rounded-md border border-red-400/20 px-3 py-2">
                            {run.error}
                          </p>
                        </div>
                      )}
                      {run.turns != null && (
                        <div className="flex gap-4 text-[11px] text-txt-faint">
                          <span>{run.turns} turn{run.turns !== 1 ? 's' : ''}</span>
                          {run.tool_calls != null && <span>{run.tool_calls} tool call{run.tool_calls !== 1 ? 's' : ''}</span>}
                          {run.completed_at && <span>Completed {timeAgo(run.completed_at)}</span>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Hint */}
            {filtered.some((r) => r.output || r.error) && (
              <div className="bg-raised px-4 py-2 text-[11px] text-txt-faint">
                Click a row to see what the agent worked on.
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─── Mini Stat Card ──────────────────────── */
function MiniStat({
  label,
  value,
  loading,
  highlight = false,
  alert = false,
}: {
  label: string;
  value: string;
  loading: boolean;
  highlight?: boolean;
  alert?: boolean;
}) {
  if (loading) return <Skeleton className="h-[72px]" />;
  return (
    <Card
      className={
        highlight
          ? 'border-cyan/20 bg-cyan/5'
          : alert
          ? 'border-red-400/20 bg-red-400/5'
          : ''
      }
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-txt-muted">{label}</p>
      <p
        className={`mt-1 font-mono text-xl font-bold ${
          highlight ? 'text-cyan' : alert ? 'text-red-400' : 'text-txt-primary'
        }`}
      >
        {value}
      </p>
    </Card>
  );
}
