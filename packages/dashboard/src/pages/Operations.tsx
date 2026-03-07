import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

const POLL_INTERVAL = 60_000;
import { apiCall, SCHEDULER_URL } from '../lib/firebase';
import { DISPLAY_NAME_MAP, AGENT_META } from '../lib/types';
import {
  Card,
  SectionHeader,
  AgentAvatar,
  Skeleton,
  timeAgo,
  PageTabs,
} from '../components/ui';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts';
import Activity from './Activity';

async function schedulerApi<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${SCHEDULER_URL}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

interface AgentRow {
  id: string;
  role: string;
  total_runs: number;
  total_cost_usd: number;
  last_run_at: string | null;
  last_run_duration_ms: number | null;
  performance_score: number | null;
}

interface ReflectionRow {
  id: string;
  agent_role: string;
  quality_score: number;
  created_at: string;
}

interface RecentRunRow {
  agent_id: string;
  status: string;
  duration_ms: number | null;
  error: string | null;
  started_at: string;
}

interface AgentHealthMetrics {
  successRate: number | null;
  avgDuration: number | null;
  failureCount: number;
  qualityScore: number | null;
  totalRuns: number;
  composite: number;
}

function useAgentRuns() {
  const [data, setData] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiCall<AgentRow[]>('/api/company-agents?fields=id,role,total_runs,total_cost_usd,last_run_at,last_run_duration_ms,performance_score');
      setData(rows ?? []);
    } catch {
      setData([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);
  return { data, loading, refresh };
}

function useReflections(days = 14) {
  const [data, setData] = useState<ReflectionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    try {
      const rows = await apiCall<ReflectionRow[]>(`/api/agent-reflections?since=${since}`);
      setData(rows ?? []);
    } catch {
      setData([]);
    }
    setLoading(false);
  }, [days]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);

  return { data, loading };
}

function useRecentRuns(hours = 48) {
  const [data, setData] = useState<RecentRunRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    try {
      const rows = await apiCall<RecentRunRow[]>(`/api/agent-runs?since=${since}`);
      setData(rows ?? []);
    } catch {
      setData([]);
    }
    setLoading(false);
  }, [hours]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);

  return { data, loading };
}

function computeHealthMap(
  agents: AgentRow[],
  recentRuns: RecentRunRow[],
  reflections: ReflectionRow[],
): Map<string, AgentHealthMetrics> {
  const map = new Map<string, AgentHealthMetrics>();

  const byAgent = new Map<string, RecentRunRow[]>();
  for (const run of recentRuns) {
    const arr = byAgent.get(run.agent_id) ?? [];
    arr.push(run);
    byAgent.set(run.agent_id, arr);
  }

  const reflByAgent = new Map<string, number[]>();
  for (const r of reflections) {
    const arr = reflByAgent.get(r.agent_role) ?? [];
    arr.push(r.quality_score);
    reflByAgent.set(r.agent_role, arr);
  }

  for (const agent of agents) {
    const runs = byAgent.get(agent.role) ?? [];
    const total = runs.length;
    const successes = runs.filter(r => r.status === 'completed' || r.status === 'success').length;
    const failures = runs.filter(r => r.status === 'error' || r.status === 'failed').length;
    const durations = runs.map(r => r.duration_ms).filter((d): d is number => d != null);
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;

    const qualityScores = reflByAgent.get(agent.role) ?? [];
    const avgQuality = qualityScores.length > 0
      ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
      : null;

    const successRate = total > 0 ? successes / total : null;
    const perfScore = agent.performance_score ?? 0;

    // Composite health: weighted average of available signals
    let composite = perfScore;
    if (total > 0) {
      let weight = 0;
      let score = 0;

      if (successRate !== null) { score += successRate * 0.4; weight += 0.4; }
      if (avgQuality !== null) { score += (avgQuality / 100) * 0.25; weight += 0.25; }
      score += perfScore * 0.2; weight += 0.2;

      const hasRecentRun = runs.some(r =>
        Date.now() - new Date(r.started_at).getTime() < 24 * 60 * 60 * 1000,
      );
      score += (hasRecentRun ? 1 : 0.3) * 0.15; weight += 0.15;

      composite = weight > 0 ? score / weight : perfScore;
    }

    map.set(agent.role, {
      successRate,
      avgDuration,
      failureCount: failures,
      qualityScore: avgQuality,
      totalRuns: total,
      composite,
    });
  }

  return map;
}

const ROLE_ORDER = [
  'chief-of-staff', 'cto', 'cpo', 'cfo', 'cmo', 'clo',
  'vp-customer-success', 'vp-sales', 'vp-design', 'vp-research', 'ops',
  'platform-engineer', 'quality-engineer', 'devops-engineer',
  'user-researcher', 'competitive-intel', 'revenue-analyst', 'cost-analyst',
  'content-creator', 'seo-analyst', 'social-media-manager',
  'onboarding-specialist', 'support-triage', 'account-research',
  'ui-ux-designer', 'frontend-engineer', 'design-critic', 'template-architect',
  'm365-admin', 'global-admin',
  'competitive-research-analyst', 'market-research-analyst',
  'technical-research-analyst', 'industry-research-analyst',
];

interface SyncRow {
  id: string;
  status: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
}

interface IncidentRow {
  id: string;
  title: string;
  severity: string;
  status: string;
  created_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

function useDataSyncs() {
  const [data, setData] = useState<SyncRow[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const rows = await apiCall<SyncRow[]>('/api/data-sync-status');
      setData(rows ?? []);
    } catch {
      setData([]);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);
  return { data, loading };
}

function useIncidents() {
  const [data, setData] = useState<IncidentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const rows = await apiCall<IncidentRow[]>('/api/incidents?limit=20');
      setData(rows ?? []);
    } catch {
      setData([]);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);
  return { data, loading };
}

interface PlanVerificationRow {
  id: string;
  directive_id: string;
  verdict: string;
  overall_score: number;
  suggestions: string[];
  assignment_count: number;
  created_at: string;
}

function usePlanVerifications(days = 30) {
  const [data, setData] = useState<PlanVerificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    try {
      const rows = await apiCall<PlanVerificationRow[]>(`/api/plan-verifications?since=${since}&order=created_at.desc&limit=200`);
      setData(rows ?? []);
    } catch {
      setData([]);
    }
    setLoading(false);
  }, [days]);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);
  return { data, loading };
}

// ─── Workflow monitoring ────────────────────────────────────────

interface WorkflowStep {
  id: string;
  type: string;
  agents: string[];
  status: 'completed' | 'running' | 'waiting' | 'pending' | 'failed' | 'skipped';
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  cost_usd: number | null;
  error: string | null;
}

interface WorkflowRecord {
  id: string;
  type: string;
  initiator: string;
  directive_title: string | null;
  status: 'running' | 'completed' | 'failed' | 'waiting' | 'cancelled';
  steps: WorkflowStep[];
  current_step: number;
  total_steps: number;
  waiting_for: string | null;
  started_at: string;
  completed_at: string | null;
  total_cost_usd: number;
  error: string | null;
}

interface WorkflowMetrics {
  total_started: number;
  total_completed: number;
  total_failed: number;
  avg_completion_time_ms: number;
  by_type: { type: string; count: number; avg_time_ms: number; avg_cost: number }[];
}

const WORKFLOW_POLL = 10_000;

function useWorkflows() {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [metrics, setMetrics] = useState<WorkflowMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [wfs, m] = await Promise.all([
        schedulerApi<WorkflowRecord[]>('/workflows'),
        schedulerApi<WorkflowMetrics>('/workflows/metrics?days=30'),
      ]);
      setWorkflows(wfs ?? []);
      setMetrics(m ?? null);
    } catch {
      setWorkflows([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const hasActive = workflows.some(w => w.status === 'running' || w.status === 'waiting');
    const interval = setInterval(refresh, hasActive ? WORKFLOW_POLL : POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [workflows, refresh]);

  return { workflows, metrics, loading, refresh };
}

// ─── Memory Health hooks ────────────────────────────────────────

interface MemoryLifecycleRow {
  id: string;
  source_table: string;
  source_id: string;
  current_layer: string;
  promoted_at: string | null;
  created_at: string;
}

interface MemoryTableCount {
  table: string;
  count: number;
}

const MEMORY_TABLES = ['memory_lifecycle', 'memory_archive', 'agent_memory', 'agent_reflections'] as const;
const LAYER_COLORS: Record<string, string> = {
  raw: '#64748b',
  distilled: '#7C3AED',
  operative: '#0EA5E9',
  archived: '#F59E0B',
};

function useMemoryLayerCounts() {
  const [data, setData] = useState<{ layer: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const rows = await apiCall<MemoryLifecycleRow[]>('/api/memory_lifecycle?limit=5000');
      const counts = new Map<string, number>();
      for (const r of (rows ?? [])) {
        counts.set(r.current_layer, (counts.get(r.current_layer) ?? 0) + 1);
      }
      setData(
        ['raw', 'distilled', 'operative', 'archived'].map(layer => ({
          layer,
          count: counts.get(layer) ?? 0,
        })),
      );
    } catch {
      setData([]);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);
  return { data, loading, refresh };
}

function useMemoryTableCounts() {
  const [data, setData] = useState<MemoryTableCount[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const results = await Promise.all(
        MEMORY_TABLES.map(async (table) => {
          try {
            const res = await apiCall<{ count: number }>(`/api/${table}?count=true`);
            return { table, count: res?.count ?? 0 };
          } catch {
            return { table, count: 0 };
          }
        }),
      );
      setData(results);
    } catch {
      setData([]);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);
  return { data, loading };
}

function useConsolidationActivity(days = 30) {
  const [data, setData] = useState<{ date: string; promoted: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    try {
      const rows = await apiCall<MemoryLifecycleRow[]>(
        `/api/memory_lifecycle?promoted_at=gte.${since}&limit=5000`,
      );
      const byDate = new Map<string, number>();
      for (const r of (rows ?? [])) {
        if (r.promoted_at) {
          const date = r.promoted_at.split('T')[0];
          byDate.set(date, (byDate.get(date) ?? 0) + 1);
        }
      }
      setData(
        Array.from(byDate.entries())
          .map(([date, promoted]) => ({ date: formatDate(date), promoted }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      );
    } catch {
      setData([]);
    }
    setLoading(false);
  }, [days]);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);
  return { data, loading };
}

type Tab = 'overview' | 'history';

export default function Operations() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-txt-primary">Operations</h1>
        <p className="mt-1 text-sm text-txt-muted">Agent performance, runs, and costs</p>
      </div>
      <PageTabs
        tabs={[
          { key: 'overview' as Tab, label: 'Overview' },
          { key: 'history' as Tab, label: 'Run History' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'history' ? <Activity /> : <OperationsOverview />}
    </div>
  );
}

function OperationsOverview() {
  const { data: agents, loading: agentsLoading, refresh: refreshAgents } = useAgentRuns();
  const { data: reflections, loading: reflectionsLoading } = useReflections(14);
  const { data: recentRuns, loading: recentRunsLoading } = useRecentRuns(48);
  const { data: syncs, loading: syncsLoading } = useDataSyncs();
  const { data: incidents, loading: incidentsLoading } = useIncidents();
  const { data: planVerifications, loading: pvLoading } = usePlanVerifications(30);
  const { data: layerCounts, loading: layersLoading, refresh: refreshLayers } = useMemoryLayerCounts();
  const { data: tableCounts, loading: tableCountsLoading } = useMemoryTableCounts();
  const { data: consolidationActivity, loading: consolidationLoading } = useConsolidationActivity(30);
  const { workflows, metrics: wfMetrics, loading: wfLoading, refresh: refreshWorkflows } = useWorkflows();

  const loading = agentsLoading || reflectionsLoading || recentRunsLoading;
  const lastRefresh = useRef(new Date());

  const handleRefresh = useCallback(() => {
    lastRefresh.current = new Date();
    refreshAgents();
  }, [refreshAgents]);

  const healthMap = useMemo(
    () => computeHealthMap(agents, recentRuns, reflections),
    [agents, recentRuns, reflections],
  );

  // Agent runs per agent
  const runsData = useMemo(() =>
    agents
      .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
      .map((a) => ({
        name: DISPLAY_NAME_MAP[a.role] ?? a.role,
        role: a.role,
        runs: a.total_runs,
        cost: a.total_cost_usd,
      })),
    [agents],
  );

  // Cost per agent
  const costData = useMemo(() =>
    agents
      .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
      .map((a) => ({
        name: DISPLAY_NAME_MAP[a.role] ?? a.role,
        role: a.role,
        cost: parseFloat(Number(a.total_cost_usd ?? 0).toFixed(2)),
      })),
    [agents],
  );

  // Quality score over time (daily average across all agents)
  const qualityTrend = useMemo(() => {
    const byDate = new Map<string, { total: number; count: number }>();
    for (const r of reflections) {
      const date = r.created_at.split('T')[0];
      const entry = byDate.get(date) ?? { total: 0, count: 0 };
      entry.total += r.quality_score;
      entry.count++;
      byDate.set(date, entry);
    }
    return Array.from(byDate.entries())
      .map(([date, { total, count }]) => ({
        date: formatDate(date),
        score: Math.round(total / count),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [reflections]);

  // Summary stats
  const totalRuns = agents.reduce((s, a) => s + a.total_runs, 0);
  const totalCost = agents.reduce((s, a) => s + (a.total_cost_usd ?? 0), 0);
  const avgScore = agents.length > 0
    ? Math.round(agents.reduce((s, a) => s + (a.performance_score ?? 0), 0) / agents.length * 100)
    : 0;

  return (
    <div className="space-y-8">
      {/* Refresh bar */}
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-txt-faint">Auto-refreshes every 60s</span>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="rounded-md border border-border bg-raised px-3 py-1.5 text-xs font-medium text-txt-secondary hover:bg-surface disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard label="Total Runs" value={String(totalRuns)} loading={loading} />
        <SummaryCard label="Total AI Spend" value={`$${totalCost.toFixed(2)}`} loading={loading} />
        <SummaryCard label="Avg Score" value={`${avgScore}/100`} loading={loading} />
        <SummaryCard label="Active Agents" value={`${agents.length}`} loading={loading} />
      </div>

      {/* Plan Quality Card */}
      <PlanQualityCard verifications={planVerifications} loading={pvLoading} />

      {/* Active Workflows */}
      <ActiveWorkflowsSection
        workflows={workflows}
        metrics={wfMetrics}
        loading={wfLoading}
        onRefresh={refreshWorkflows}
      />

      <div className="grid grid-cols-2 gap-6">
        {/* Runs per Agent */}
        <Card>
          <SectionHeader title="Runs per Agent" />
          {loading ? (
            <Skeleton className="h-64" />
          ) : runsData.length === 0 ? (
            <EmptyChart message="No run data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(300, runsData.length * 38)}>
              <BarChart data={runsData} layout="vertical" margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} width={120} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-txt-secondary)' }}
                />
                <Bar dataKey="runs" radius={[0, 4, 4, 0]} maxBarSize={28}>
                  {runsData.map((entry) => (
                    <Cell key={entry.role} fill={AGENT_META[entry.role]?.color ?? '#64748b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Cost per Agent */}
        <Card>
          <SectionHeader title="Cost per Agent" />
          {loading ? (
            <Skeleton className="h-64" />
          ) : costData.length === 0 ? (
            <EmptyChart message="No cost data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(300, costData.length * 38)}>
              <BarChart data={costData} layout="vertical" margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${v}`} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} width={120} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-txt-secondary)' }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`]}
                />
                <Bar dataKey="cost" radius={[0, 4, 4, 0]} maxBarSize={28}>
                  {costData.map((entry) => (
                    <Cell key={entry.role} fill={AGENT_META[entry.role]?.color ?? '#64748b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Quality Score Trend */}
      <Card>
        <SectionHeader title="Quality Score Trend (14 days)" />
        {loading ? (
          <Skeleton className="h-64" />
        ) : qualityTrend.length === 0 ? (
          <EmptyChart message="No reflection data yet" />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={qualityTrend} margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }}
                interval={Math.max(0, Math.floor(qualityTrend.length / 10) - 1)}
              />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} domain={[0, 100]} width={40} />
              <Tooltip
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--color-txt-secondary)' }}
                formatter={(value: number) => [`${value}/100`, 'Avg Score']}
              />
              <Line type="monotone" dataKey="score" stroke="#7C3AED" strokeWidth={2} dot={{ r: 3, fill: '#7C3AED' }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Data Sync Status + Incident Log */}
      <div className="grid grid-cols-2 gap-6">
        <Card>
          <SectionHeader title="Data Sync Status" />
          {syncsLoading ? (
            <Skeleton className="h-40" />
          ) : syncs.length === 0 ? (
            <p className="py-4 text-center text-sm text-txt-faint">No sync sources configured</p>
          ) : (
            <div className="space-y-2">
              {syncs.map((sync) => (
                <div
                  key={sync.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-raised px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        sync.status === 'ok'
                          ? 'bg-tier-green'
                          : sync.status === 'stale'
                          ? 'bg-tier-yellow'
                          : 'bg-prism-critical'
                      }`}
                    />
                    <span className="text-sm font-medium text-txt-secondary">{sync.id}</span>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    {sync.consecutive_failures > 0 && (
                      <span className="text-[10px] text-prism-critical">{sync.consecutive_failures} failures</span>
                    )}
                    <span className="text-[11px] text-txt-faint">
                      {sync.last_success_at ? timeAgo(sync.last_success_at) : 'never'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader title="Incident Log" />
          {incidentsLoading ? (
            <Skeleton className="h-40" />
          ) : incidents.length === 0 ? (
            <p className="py-4 text-center text-sm text-txt-faint">No incidents recorded</p>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {incidents.map((inc) => (
                <div
                  key={inc.id}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                    inc.status === 'open'
                      ? 'border-prism-critical/20 bg-prism-critical/5'
                      : 'border-border bg-raised'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        inc.status === 'open' ? 'bg-prism-critical' : 'bg-tier-green'
                      }`}
                    />
                    <span className="text-sm font-medium text-txt-secondary">{inc.title}</span>
                    <span
                      className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                        inc.severity === 'critical'
                          ? 'border-prism-critical/30 bg-prism-critical/15 text-prism-critical'
                          : inc.severity === 'high'
                          ? 'border-prism-high/30 bg-prism-high/15 text-prism-high'
                          : 'border-prism-fill-3/30 bg-prism-fill-3/15 text-prism-sky'
                      }`}
                    >
                      {inc.severity}
                    </span>
                  </div>
                  <span className="text-[10px] text-txt-faint">{timeAgo(inc.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Agent Health Matrix */}
      <Card>
        <SectionHeader title="Agent Health Matrix" subtitle="Composite score: 40% success rate + 25% quality + 20% performance + 15% recency" />
        {loading ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="grid grid-cols-3 gap-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
            {agents
              .sort((a, b) => {
                const ai = ROLE_ORDER.indexOf(a.role);
                const bi = ROLE_ORDER.indexOf(b.role);
                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
              })
              .map((agent) => {
                const h = healthMap.get(agent.role);
                const composite = h?.composite ?? agent.performance_score ?? 0;
                const health = composite >= 0.8 ? 'healthy' : composite >= 0.5 ? 'degraded' : 'critical';
                const successPct = h?.successRate != null ? Math.round(h.successRate * 100) : null;
                const avgDur = h?.avgDuration != null
                  ? h.avgDuration < 1000 ? `${Math.round(h.avgDuration)}ms`
                  : h.avgDuration < 60_000 ? `${(h.avgDuration / 1000).toFixed(1)}s`
                  : `${(h.avgDuration / 60_000).toFixed(1)}m`
                  : null;

                return (
                  <div
                    key={agent.id}
                    className={`relative flex flex-col gap-1.5 rounded-lg border p-3 ${
                      health === 'healthy'
                        ? 'border-tier-green/25 bg-tier-green/5'
                        : health === 'degraded'
                        ? 'border-tier-yellow/25 bg-tier-yellow/5'
                        : 'border-prism-critical/25 bg-prism-critical/5'
                    }`}
                  >
                    {/* Header: avatar + name + composite */}
                    <div className="flex items-center gap-2">
                      <AgentAvatar role={agent.role} size={28} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-semibold text-txt-secondary">
                          {DISPLAY_NAME_MAP[agent.role] ?? agent.role}
                        </p>
                      </div>
                      <span
                        className={`text-sm font-bold tabular-nums ${
                          health === 'healthy'
                            ? 'text-tier-green'
                            : health === 'degraded'
                            ? 'text-tier-yellow'
                            : 'text-prism-critical'
                        }`}
                      >
                        {Math.round(composite * 100)}
                      </span>
                    </div>

                    {/* Metrics row 1: success rate + avg duration */}
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-txt-muted">
                        {successPct != null ? (
                          <><span className={successPct >= 80 ? 'text-tier-green' : successPct >= 50 ? 'text-tier-yellow' : 'text-prism-critical'}>&#10003; {successPct}%</span></>
                        ) : (
                          <span className="text-txt-faint">no runs</span>
                        )}
                      </span>
                      {avgDur && <span className="text-txt-faint">&#9201; {avgDur}</span>}
                    </div>

                    {/* Metrics row 2: quality + failures */}
                    <div className="flex items-center justify-between text-[10px]">
                      {h?.qualityScore != null ? (
                        <span className={`font-medium ${h.qualityScore >= 70 ? 'text-prism-violet' : h.qualityScore >= 40 ? 'text-prism-elevated' : 'text-prism-critical'}`}>
                          &#9733; {Math.round(h.qualityScore)}
                        </span>
                      ) : (
                        <span className="text-txt-faint">&#9733; —</span>
                      )}
                      {(h?.failureCount ?? 0) > 0 ? (
                        <span className="font-medium text-prism-critical">
                          {h!.failureCount} fail{h!.failureCount > 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="text-txt-faint">{h?.totalRuns ?? 0} runs</span>
                      )}
                    </div>

                    {/* Activity bar: last 48h runs visualized as dots */}
                    {h && h.totalRuns > 0 && (
                      <div className="flex items-center gap-0.5 pt-0.5">
                        {recentRuns
                          .filter(r => r.agent_id === agent.role)
                          .slice(-10)
                          .map((r, i) => (
                            <span
                              key={i}
                              className={`inline-block h-1.5 w-1.5 rounded-full ${
                                r.status === 'completed' || r.status === 'success'
                                  ? 'bg-tier-green'
                                  : r.status === 'running'
                                  ? 'bg-prism-sky'
                                  : 'bg-prism-critical'
                              }`}
                            />
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </Card>

      {/* Memory Health */}
      <MemoryHealthSection
        layerCounts={layerCounts}
        layersLoading={layersLoading}
        tableCounts={tableCounts}
        tableCountsLoading={tableCountsLoading}
        consolidationActivity={consolidationActivity}
        consolidationLoading={consolidationLoading}
        onRefresh={refreshLayers}
      />

      {/* Agent Detail Cards */}
      <div>
        <SectionHeader title="Agent Details" />
        <div className="grid grid-cols-2 gap-4">
          {agents.sort((a, b) => {
            const ai = ROLE_ORDER.indexOf(a.role);
            const bi = ROLE_ORDER.indexOf(b.role);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
          }).map((agent) => (
            <Card key={agent.id}>
              <div className="flex items-center gap-3">
                <AgentAvatar role={agent.role} size={36} />
                <div className="flex-1">
                  <h3 className="text-[14px] font-semibold text-txt-primary">
                    {DISPLAY_NAME_MAP[agent.role] ?? agent.role}
                  </h3>
                  <p className="text-[11px] text-txt-muted">{agent.role}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm text-txt-secondary">{agent.total_runs} runs</p>
                  <p className="text-[11px] text-txt-faint">${Number(agent.total_cost_usd ?? 0).toFixed(2)} total</p>
                </div>
              </div>
              {agent.last_run_duration_ms && (
                <p className="mt-2 text-[11px] text-txt-faint">
                  Last run: {(Number(agent.last_run_duration_ms) / 1000).toFixed(1)}s
                </p>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function workflowStatusColor(status: string) {
  if (status === 'completed') return 'bg-tier-green';
  if (status === 'failed' || status === 'cancelled') return 'bg-prism-critical';
  if (status === 'waiting') return 'bg-prism-elevated animate-pulse';
  return 'bg-cyan animate-pulse';
}

function workflowStatusBadge(status: string) {
  if (status === 'completed') return 'border-tier-green/30 bg-tier-green/15 text-tier-green';
  if (status === 'failed' || status === 'cancelled') return 'border-prism-critical/30 bg-prism-critical/15 text-prism-critical';
  if (status === 'waiting') return 'border-prism-elevated/30 bg-prism-elevated/15 text-prism-elevated';
  return 'border-cyan/30 bg-cyan/15 text-cyan';
}

function stepStatusIcon(status: string) {
  if (status === 'completed') return <span className="text-tier-green font-medium">✓</span>;
  if (status === 'running') return <span className="text-cyan animate-pulse font-medium">⟳</span>;
  if (status === 'waiting') return <span className="text-prism-elevated">⏳</span>;
  if (status === 'failed') return <span className="text-prism-critical font-medium">✗</span>;
  if (status === 'skipped') return <span className="text-txt-faint">⏭</span>;
  return <span className="text-txt-faint">–</span>;
}

function formatMs(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function elapsedSince(iso: string) {
  return formatMs(Date.now() - new Date(iso).getTime());
}

function ActiveWorkflowsSection({
  workflows,
  metrics,
  loading,
  onRefresh,
}: {
  workflows: WorkflowRecord[];
  metrics: WorkflowMetrics | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const waitingWorkflows = workflows.filter(w => w.status === 'waiting');
  const activeWorkflows = workflows.filter(w => w.status === 'running' || w.status === 'waiting');
  const recentWorkflows = workflows.slice(0, 20);

  const cancelWorkflow = async (id: string) => {
    setActionLoading(`cancel-${id}`);
    try {
      await fetch(`${SCHEDULER_URL}/workflows/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      onRefresh();
    } catch { /* ignore */ }
    setActionLoading(null);
  };

  const retryWorkflow = async (id: string) => {
    setActionLoading(`retry-${id}`);
    try {
      await fetch(`${SCHEDULER_URL}/workflows/${id}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      onRefresh();
    } catch { /* ignore */ }
    setActionLoading(null);
  };

  return (
    <>
      <SectionHeader title="Active Workflows" subtitle="Real-time workflow monitoring · polls every 10s for active workflows" />

      {/* Waiting workflows highlight */}
      {waitingWorkflows.length > 0 && (
        <div className="space-y-2">
          {waitingWorkflows.map(w => (
            <div
              key={w.id}
              className="flex items-center justify-between rounded-lg border border-prism-elevated/30 bg-prism-elevated/10 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full bg-prism-elevated animate-pulse" />
                <div>
                  <p className="text-sm font-medium text-txt-primary">
                    {w.directive_title ?? w.type}
                  </p>
                  <p className="text-[11px] text-prism-elevated">
                    Waiting for: {w.waiting_for ?? 'Human approval'} · {elapsedSince(w.started_at)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => cancelWorkflow(w.id)}
                disabled={actionLoading !== null}
                className="rounded-md border border-prism-critical/30 bg-prism-critical/10 px-3 py-1 text-xs font-medium text-prism-critical hover:bg-prism-critical/20 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Workflow Metrics (30 days) */}
      {metrics && (
        <div className="grid grid-cols-4 gap-4">
          <SummaryCard label="Started (30d)" value={String(metrics.total_started)} loading={loading} />
          <SummaryCard label="Completed" value={String(metrics.total_completed)} loading={loading} />
          <SummaryCard label="Failed" value={String(metrics.total_failed)} loading={loading} />
          <SummaryCard label="Avg Time" value={formatMs(metrics.avg_completion_time_ms)} loading={loading} />
        </div>
      )}

      {/* Cost by workflow type */}
      {metrics && metrics.by_type.length > 0 && (
        <Card>
          <SectionHeader title="Workflow Metrics by Type (30 days)" />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wider text-txt-muted">
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Count</th>
                  <th className="py-2 pr-4">Avg Time</th>
                  <th className="py-2">Avg Cost</th>
                </tr>
              </thead>
              <tbody>
                {metrics.by_type.map(t => (
                  <tr key={t.type} className="border-b border-border/50">
                    <td className="py-2 pr-4 font-medium text-txt-secondary">{t.type}</td>
                    <td className="py-2 pr-4 font-mono text-txt-primary">{t.count}</td>
                    <td className="py-2 pr-4 text-txt-muted">{formatMs(t.avg_time_ms)}</td>
                    <td className="py-2 font-mono text-txt-muted">${t.avg_cost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Workflows table */}
      <Card>
        <SectionHeader title={`Workflows${activeWorkflows.length > 0 ? ` (${activeWorkflows.length} active)` : ''}`} />
        {loading ? (
          <Skeleton className="h-40" />
        ) : recentWorkflows.length === 0 ? (
          <p className="py-4 text-center text-sm text-txt-faint">No workflows recorded</p>
        ) : (
          <div className="space-y-1">
            {recentWorkflows.map(w => (
              <div key={w.id}>
                <button
                  onClick={() => setExpanded(expanded === w.id ? null : w.id)}
                  className="w-full text-left rounded-lg border border-border bg-raised px-4 py-2.5 hover:bg-surface transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${workflowStatusColor(w.status)}`} />
                      <span className="text-sm font-medium text-txt-secondary truncate">{w.type}</span>
                      <span className="text-[11px] text-txt-faint truncate">{w.initiator}</span>
                      {w.directive_title && (
                        <span className="text-[11px] text-txt-muted truncate hidden md:inline">{w.directive_title}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[11px] font-mono text-txt-muted">{w.current_step}/{w.total_steps}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${workflowStatusBadge(w.status)}`}>
                        {w.status}
                      </span>
                      <span className="text-[10px] text-txt-faint">{elapsedSince(w.started_at)}</span>
                    </div>
                  </div>
                </button>

                {expanded === w.id && (
                  <div className="ml-4 mt-1 mb-2 rounded-lg border border-border/50 bg-surface px-4 py-3 space-y-2">
                    {/* Step progress */}
                    {w.steps.map((step, i) => (
                      <div key={step.id} className="flex items-center gap-3 text-[12px]">
                        <span className="w-5 text-center shrink-0">{stepStatusIcon(step.status)}</span>
                        <span className="w-5 text-txt-faint font-mono">{i + 1}</span>
                        <span className="flex-1 text-txt-secondary font-medium">{step.type}</span>
                        {step.agents.length > 0 && (
                          <span className="text-txt-faint truncate max-w-[120px]">{step.agents.join(', ')}</span>
                        )}
                        {step.duration_ms != null && (
                          <span className="text-txt-faint font-mono">{formatMs(step.duration_ms)}</span>
                        )}
                        {step.cost_usd != null && step.cost_usd > 0 && (
                          <span className="text-txt-faint font-mono">${step.cost_usd.toFixed(3)}</span>
                        )}
                        {step.error && (
                          <span className="text-prism-critical truncate max-w-[200px]" title={step.error}>
                            {step.error}
                          </span>
                        )}
                      </div>
                    ))}

                    {/* Controls */}
                    {(w.status === 'running' || w.status === 'waiting') && (
                      <div className="flex gap-2 pt-2 border-t border-border/50">
                        <button
                          onClick={() => cancelWorkflow(w.id)}
                          disabled={actionLoading !== null}
                          className="rounded-md border border-prism-critical/30 bg-prism-critical/10 px-3 py-1 text-xs font-medium text-prism-critical hover:bg-prism-critical/20 disabled:opacity-50"
                        >
                          {actionLoading === `cancel-${w.id}` ? 'Cancelling…' : 'Cancel'}
                        </button>
                      </div>
                    )}
                    {w.status === 'failed' && (
                      <div className="flex gap-2 pt-2 border-t border-border/50">
                        <button
                          onClick={() => retryWorkflow(w.id)}
                          disabled={actionLoading !== null}
                          className="rounded-md border border-cyan/30 bg-cyan/10 px-3 py-1 text-xs font-medium text-cyan hover:bg-cyan/20 disabled:opacity-50"
                        >
                          {actionLoading === `retry-${w.id}` ? 'Retrying…' : 'Retry'}
                        </button>
                      </div>
                    )}

                    {w.total_cost_usd > 0 && (
                      <p className="text-[11px] text-txt-faint pt-1">Total cost: ${w.total_cost_usd.toFixed(3)}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function MemoryHealthSection({
  layerCounts,
  layersLoading,
  tableCounts,
  tableCountsLoading,
  consolidationActivity,
  consolidationLoading,
  onRefresh,
}: {
  layerCounts: { layer: string; count: number }[];
  layersLoading: boolean;
  tableCounts: { table: string; count: number }[];
  tableCountsLoading: boolean;
  consolidationActivity: { date: string; promoted: number }[];
  consolidationLoading: boolean;
  onRefresh: () => void;
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const totalTracked = layerCounts.reduce((s, l) => s + l.count, 0);
  const rawCount = layerCounts.find(l => l.layer === 'raw')?.count ?? 0;
  const hasLayerData = layerCounts.some(l => l.count > 0);

  const runAction = async (action: 'consolidate' | 'archive') => {
    setActionLoading(action);
    setActionResult(null);
    try {
      const res = await fetch(`${SCHEDULER_URL}/memory/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setActionResult({ type: 'success', message: data.success ? `${action} completed` : `${action} finished with warnings` });
      onRefresh();
    } catch (err) {
      setActionResult({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    setActionLoading(null);
  };

  return (
    <>
      <SectionHeader title="Memory Health" />

      {/* Summary stats row */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Total Tracked</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-txt-primary">
            {layersLoading ? '…' : totalTracked}
          </p>
        </Card>
        <Card>
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Raw Traces</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-txt-primary">
            {layersLoading ? '…' : rawCount}
          </p>
        </Card>
        <Card>
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Promoted (30d)</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-txt-primary">
            {consolidationLoading ? '…' : consolidationActivity.reduce((s, d) => s + d.promoted, 0)}
          </p>
        </Card>
        <Card>
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Archived</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-txt-primary">
            {layersLoading ? '…' : (layerCounts.find(l => l.layer === 'archived')?.count ?? 0)}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Layer Distribution */}
        <Card>
          <SectionHeader title="Layer Distribution" />
          {layersLoading ? (
            <Skeleton className="h-48" />
          ) : !hasLayerData ? (
            <EmptyChart message="No memory lifecycle data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={layerCounts.filter(l => l.count > 0)}
                  dataKey="count"
                  nameKey="layer"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={45}
                  paddingAngle={2}
                  label={({ layer, count }: { layer: string; count: number }) =>
                    `${layer} (${count})`
                  }
                >
                  {layerCounts.filter(l => l.count > 0).map((entry) => (
                    <Cell key={entry.layer} fill={LAYER_COLORS[entry.layer] ?? '#64748b'} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number) => [value, 'Records']}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Consolidation Activity */}
        <Card>
          <SectionHeader title="Consolidation Activity (30 days)" />
          {consolidationLoading ? (
            <Skeleton className="h-48" />
          ) : consolidationActivity.length === 0 ? (
            <EmptyChart message="No promotions recorded yet" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={consolidationActivity} margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }}
                  interval={Math.max(0, Math.floor(consolidationActivity.length / 8) - 1)}
                />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} width={40} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-txt-secondary)' }}
                  formatter={(value: number) => [value, 'Promoted']}
                />
                <Bar dataKey="promoted" fill="#7C3AED" radius={[4, 4, 0, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Storage Metrics */}
        <Card>
          <SectionHeader title="Storage Metrics" />
          {tableCountsLoading ? (
            <Skeleton className="h-32" />
          ) : tableCounts.length === 0 ? (
            <p className="py-4 text-center text-sm text-txt-faint">No data available</p>
          ) : (
            <div className="space-y-2">
              {tableCounts.map((t) => (
                <div
                  key={t.table}
                  className="flex items-center justify-between rounded-lg border border-border bg-raised px-3 py-2.5"
                >
                  <span className="text-sm font-medium text-txt-secondary">{t.table}</span>
                  <span className="font-mono text-sm text-txt-primary">{t.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Manual Controls */}
        <Card>
          <SectionHeader title="Manual Controls" />
          <div className="space-y-3">
            <button
              onClick={() => runAction('consolidate')}
              disabled={actionLoading !== null}
              className="w-full rounded-md border border-border bg-raised px-4 py-2.5 text-sm font-medium text-txt-secondary hover:bg-surface disabled:opacity-50"
            >
              {actionLoading === 'consolidate' ? 'Running Consolidation…' : 'Run Consolidation Now'}
            </button>
            <button
              onClick={() => runAction('archive')}
              disabled={actionLoading !== null}
              className="w-full rounded-md border border-border bg-raised px-4 py-2.5 text-sm font-medium text-txt-secondary hover:bg-surface disabled:opacity-50"
            >
              {actionLoading === 'archive' ? 'Running Archival…' : 'Run Archival Now'}
            </button>
            {actionResult && (
              <div
                className={`rounded-md px-3 py-2 text-sm ${
                  actionResult.type === 'success'
                    ? 'border border-tier-green/25 bg-tier-green/5 text-tier-green'
                    : 'border border-prism-critical/25 bg-prism-critical/5 text-prism-critical'
                }`}
              >
                {actionResult.message}
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function PlanQualityCard({ verifications, loading }: { verifications: PlanVerificationRow[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-32" />;
  if (verifications.length === 0) {
    return (
      <Card>
        <SectionHeader title="Plan Quality (30 days)" />
        <p className="py-4 text-center text-sm text-txt-faint">No plan verifications recorded yet</p>
      </Card>
    );
  }

  const total = verifications.length;
  const approved = verifications.filter(v => v.verdict === 'APPROVE').length;
  const warned = verifications.filter(v => v.verdict === 'WARN').length;
  const revised = verifications.filter(v => v.verdict === 'REVISE').length;
  const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;
  const avgAssignments = total > 0
    ? (verifications.reduce((s, v) => s + (v.assignment_count ?? 0), 0) / total).toFixed(1)
    : '0';

  // Most common failure reasons (from suggestions)
  const reasonCounts = new Map<string, number>();
  for (const v of verifications) {
    for (const s of (v.suggestions ?? [])) {
      const key = s.length > 60 ? s.slice(0, 60) + '…' : s;
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
  }
  const topReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <Card>
      <SectionHeader title="Plan Quality (30 days)" />
      <div className="grid grid-cols-4 gap-4 mt-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-txt-muted">Approval Rate</p>
          <p className={`font-mono text-xl font-semibold ${approvalRate >= 80 ? 'text-tier-green' : approvalRate >= 50 ? 'text-prism-elevated' : 'text-prism-critical'}`}>
            {approvalRate}%
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-txt-muted">Total Checks</p>
          <p className="font-mono text-xl font-semibold text-txt-primary">{total}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-txt-muted">Verdicts</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] text-tier-green font-medium">{approved} ✓</span>
            <span className="text-[11px] text-prism-elevated font-medium">{warned} ⚠</span>
            <span className="text-[11px] text-prism-critical font-medium">{revised} ✗</span>
          </div>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-txt-muted">Avg Assignments</p>
          <p className="font-mono text-xl font-semibold text-txt-primary">{avgAssignments}</p>
        </div>
      </div>
      {topReasons.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-txt-muted mb-1">Top Failure Reasons</p>
          <div className="space-y-1">
            {topReasons.map(([reason, count], i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-prism-elevated">{count}×</span>
                <span className="text-[11px] text-txt-muted truncate">{reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function SummaryCard({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  if (loading) return <Skeleton className="h-20" />;
  return (
    <Card>
      <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold text-txt-primary">{value}</p>
    </Card>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-64 items-center justify-center">
      <p className="text-sm text-txt-faint">{message}</p>
    </div>
  );
}

function formatDate(d: string) {
  const parts = d.split('-');
  return `${parts[1]}/${parts[2]}`;
}
