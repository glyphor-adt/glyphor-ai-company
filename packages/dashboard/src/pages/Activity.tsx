import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { apiCall } from '../lib/firebase';
import { DISPLAY_NAME_MAP, AGENT_META } from '../lib/types';
import { normalizeText } from '../lib/normalizeText';
import ChatMarkdown from '../components/ChatMarkdown';
import {
  Card,
  SectionHeader,
  AgentAvatar,
  Skeleton,
  timeAgo,
} from '../components/ui';
import { MdChevronRight } from 'react-icons/md';

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
  thinking_tokens: number | null;
  cached_input_tokens: number | null;
  tool_calls: number | null;
  turns: number | null;
  result_summary: string | null;
  error: string | null;
  output: string | null;
  input: string | null;
  routing_rule: string | null;
  routing_capabilities: string[] | null;
  routing_model: string | null;
  reasoning_passes: number | null;
  reasoning_confidence: number | null;
  reasoning_revised: boolean | null;
  reasoning_cost_usd: number | null;
}

/* ─── Hooks ─────────────────────────────────── */
function useAgentRuns(limit = 100) {
  const [data, setData] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiCall<AgentRun[]>(`/api/agent-runs?limit=${limit}&order=started_at.desc`);
      setData(rows ?? []);
    } catch {
      setData([]);
    }
    setLoading(false);
  }, [limit]);

  useEffect(() => { refresh(); }, [refresh]);

  // Real-time not available after Firebase migration
  useEffect(() => {}, [refresh]);

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

function formatCapabilities(capabilities: string[] | null): string {
  if (!capabilities || capabilities.length === 0) return '—';
  return capabilities.join(', ');
}

function normalizeRunContent(text: string): string {
  const sectionLabels: Record<string, string> = {
    reasoning: 'Reasoning',
    approach: 'Approach',
    tradeoffs: 'Tradeoffs',
    risks: 'Risks',
    alternatives: 'Alternatives',
  };

  let value = normalizeText(text).trim();

  value = value.replace(/^##\s*#\s*/gm, '## ');

  for (const [tag, label] of Object.entries(sectionLabels)) {
    const openTag = new RegExp(`<${tag}>`, 'gi');
    const closeTag = new RegExp(`</${tag}>`, 'gi');
    value = value.replace(openTag, `\n\n### ${label}\n`);
    value = value.replace(closeTag, '');
  }

  // Convert <notify> blocks into formatted markdown callouts
  value = value.replace(
    /<notify\s+type="([^"]*?)"\s+to="([^"]*?)"\s+title="([^"]*?)">([\s\S]*?)<\/notify>/gi,
    (_match, type: string, to: string, title: string, body: string) => {
      const label = type.toUpperCase();
      return `\n\n> **[${label}]** **${title}**\n> *${type}* → ${to}\n>\n> ${body.trim().replace(/\n/g, '\n> ')}\n`;
    },
  );

  // Convert <action> blocks
  value = value.replace(
    /<action\b[^>]*>([\s\S]*?)<\/action>/gi,
    (_match, body: string) => `\n\n**Action:** ${body.trim()}\n`,
  );

  // Convert <result> blocks
  value = value.replace(
    /<result\b[^>]*>([\s\S]*?)<\/result>/gi,
    (_match, body: string) => `\n\n**Result:** ${body.trim()}\n`,
  );

  // Strip any remaining unhandled XML-like agent tags (but keep their content)
  value = value.replace(/<\/?(plan|summary|observation|diagnosis|recommendation)\b[^>]*>/gi, '');

  // Wrap top-level JSON objects/arrays as fenced code blocks when not already inside one
  value = value.replace(
    /(?:^|\n)([ \t]*\{[\s\S]*?\n[ \t]*\})/g,
    (match) => {
      if (/```/.test(match)) return match;
      return `\n\`\`\`json\n${match.trim()}\n\`\`\`\n`;
    },
  );

  return value.replace(/\n{3,}/g, '\n\n').trim();
}

function statusConfig(status: string) {
  switch (status) {
    case 'running':
      return { dot: 'bg-cyan animate-pulse', label: 'Running', badge: 'badge-cyan' };
    case 'completed':
      return { dot: 'bg-tier-green', label: 'Completed', badge: 'badge-green' };
    case 'failed':
      return { dot: 'bg-prism-critical', label: 'Failed', badge: 'badge-red' };
    case 'skipped_precheck':
      return { dot: 'bg-tier-yellow', label: 'Skipped', badge: 'badge-yellow' };
    default:
      return { dot: 'bg-txt-faint', label: status, badge: 'badge-gray' };
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

  // Currently running — deduplicate by agent, keep most recent run per agent
  const runningNow = useMemo(() => {
    const allRunning = runs.filter((r) => r.status === 'running');
    const byAgent = new Map<string, { run: typeof allRunning[0]; count: number }>();
    for (const run of allRunning) {
      const existing = byAgent.get(run.agent_id);
      if (!existing || new Date(run.started_at) > new Date(existing.run.started_at)) {
        byAgent.set(run.agent_id, { run, count: (existing?.count ?? 0) + 1 });
      } else {
        existing.count++;
      }
    }
    return Array.from(byAgent.values());
  }, [runs]);

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
      {/* ── Summary Stats ──────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
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
            {runningNow.map(({ run, count }) => (
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
                    {count > 1 && (
                      <span className="ml-1.5 text-[11px] font-normal text-txt-muted">×{count}</span>
                    )}
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
          <div className="divide-y divide-border overflow-x-auto">
            {/* Header */}
            <div className="grid grid-cols-[2fr_1.5fr_100px_90px_80px_80px_70px_60px_70px_90px] gap-2 bg-raised px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-txt-muted min-w-[900px]">
              <span>Agent</span>
              <span>Task</span>
              <span>Status</span>
              <span>Duration</span>
              <span>Tokens</span>
              <span>Tools</span>
              <span>Cost</span>
              <span>Passes</span>
              <span>Conf.</span>
              <span>Started</span>
            </div>

            {/* Rows */}
            {filtered.map((run) => {
              const sc = statusConfig(run.status);
              const isExpanded = expandedId === run.id;
              const hasDetail = !!(run.output || run.input || run.result_summary || run.error);
              return (
                <div key={run.id}>
                  <div
                    onClick={() => hasDetail && setExpandedId(isExpanded ? null : run.id)}
                    className={`grid grid-cols-[2fr_1.5fr_100px_90px_80px_80px_70px_60px_70px_90px] gap-2 items-center px-4 py-2.5 transition-colors hover:bg-raised/50 min-w-[900px] ${
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
                        <span className={`text-txt-faint transition-transform ${isExpanded ? 'rotate-90' : ''}`}><MdChevronRight className="text-[14px]" /></span>
                      )}
                    </div>

                    {/* Task */}
                    <span className="text-[12px] text-txt-muted truncate font-mono">
                      {run.task ?? '—'}
                    </span>

                    {/* Status */}
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block h-2 w-2 rounded-full ${sc.dot}`} />
                      <span className={`rounded-lg px-2 py-0.5 text-[10px] font-medium ${sc.badge}`}>
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

                    {/* Reasoning Passes */}
                    <span className="text-[11px] font-mono text-txt-faint">
                      {run.reasoning_passes != null ? (
                        <span className="flex items-center gap-1">
                          {run.reasoning_passes}
                          {run.reasoning_revised && (
                            <span className="h-1.5 w-1.5 rounded-full bg-tier-yellow" title="Output was revised" />
                          )}
                        </span>
                      ) : '—'}
                    </span>

                    {/* Confidence */}
                    <span className={`text-[11px] font-mono ${
                      run.reasoning_confidence != null
                        ? run.reasoning_confidence >= 0.8 ? 'text-tier-green'
                          : run.reasoning_confidence >= 0.5 ? 'text-tier-yellow'
                          : 'text-prism-critical'
                        : 'text-txt-faint'
                    }`}>
                      {run.reasoning_confidence != null
                        ? `${Math.round(run.reasoning_confidence * 100)}%`
                        : '—'}
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
                          <div className="text-[12px] text-txt-secondary bg-surface rounded-md border border-border px-3 py-2 max-h-[300px] overflow-y-auto prose-chat">
                            <ChatMarkdown>{normalizeRunContent(run.input)}</ChatMarkdown>
                          </div>
                        </div>
                      )}
                      {run.output && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-txt-muted mb-1">Output</p>
                          <div className="text-[12px] text-txt-secondary bg-surface rounded-md border border-border px-3 py-2 max-h-[400px] overflow-y-auto prose-chat">
                            <ChatMarkdown>{normalizeRunContent(run.output)}</ChatMarkdown>
                          </div>
                        </div>
                      )}
                      {run.status === 'skipped_precheck' && run.result_summary && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-tier-yellow mb-1">Precheck skip</p>
                          <p className="text-[12px] text-tier-yellow whitespace-pre-wrap bg-tier-yellow/5 rounded-md border border-tier-yellow/20 px-3 py-2">
                            {run.result_summary}
                          </p>
                        </div>
                      )}
                      {run.error && run.status !== 'skipped_precheck' && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-prism-critical mb-1">Error</p>
                          <p className="text-[12px] text-prism-critical whitespace-pre-wrap bg-prism-critical/5 rounded-md border border-prism-critical/20 px-3 py-2">
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
                      {run.reasoning_passes != null && run.reasoning_passes > 0 && (
                        <div className="mt-2 rounded-md border border-cyan/20 bg-cyan/5 px-3 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan mb-1">Reasoning</p>
                          <div className="flex gap-4 text-[11px] text-txt-secondary">
                            <span>{run.reasoning_passes} pass{run.reasoning_passes !== 1 ? 'es' : ''}</span>
                            {run.reasoning_confidence != null && (
                              <span>Confidence: {Math.round(run.reasoning_confidence * 100)}%</span>
                            )}
                            {run.reasoning_revised && (
                              <span className="text-tier-yellow">Output revised</span>
                            )}
                            {run.reasoning_cost_usd != null && (
                              <span>Reasoning cost: ${Number(run.reasoning_cost_usd).toFixed(4)}</span>
                            )}
                          </div>
                        </div>
                      )}
                      {(run.thinking_tokens != null && run.thinking_tokens > 0) || (run.cached_input_tokens != null && run.cached_input_tokens > 0) ? (
                        <div className="mt-2 rounded-md border border-emerald/20 bg-emerald/5 px-3 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-prism-teal mb-1">Token Breakdown</p>
                          <div className="flex gap-4 text-[11px] text-txt-secondary">
                            {run.thinking_tokens != null && run.thinking_tokens > 0 && (
                              <span>Thinking: {formatTokens(run.thinking_tokens)}</span>
                            )}
                            {run.cached_input_tokens != null && run.cached_input_tokens > 0 && (
                              <span className="text-prism-teal">Cached: {formatTokens(run.cached_input_tokens)} ({run.input_tokens ? Math.round((run.cached_input_tokens / run.input_tokens) * 100) : 0}% hit rate)</span>
                            )}
                          </div>
                        </div>
                      ) : null}
                      {(run.routing_rule || run.routing_model || (run.routing_capabilities && run.routing_capabilities.length > 0)) && (
                        <div className="mt-2 rounded-md border border-fuchsia-400/20 bg-fuchsia-500/5 px-3 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-300 mb-1">Routing</p>
                          <div className="grid gap-2 text-[11px] text-txt-secondary md:grid-cols-3">
                            <span><span className="text-txt-faint">Rule:</span> {run.routing_rule ?? '—'}</span>
                            <span><span className="text-txt-faint">Model:</span> {run.routing_model ?? '—'}</span>
                            <span className="md:col-span-3"><span className="text-txt-faint">Capabilities:</span> {formatCapabilities(run.routing_capabilities)}</span>
                          </div>
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
const MINI_STAT_COLORS: Record<string, string> = {
  'Total Runs': '#3B82F6',
  'Running Now': '#0891B2',
  'Completed': '#34D399',
  'Failed': '#EF4444',
  'Total Cost': '#F59E0B',
};

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
  const color = MINI_STAT_COLORS[label] ?? '#64748b';
  return (
    <div
      className="glass-surface rounded-xl px-4 py-3"
      style={{ borderTopColor: color, borderTopWidth: '2px' }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color }}>{label}</p>
      <p
        className={`mt-1 font-mono text-xl font-bold ${
          highlight ? 'text-cyan' : alert ? 'text-prism-critical' : 'text-txt-primary'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
