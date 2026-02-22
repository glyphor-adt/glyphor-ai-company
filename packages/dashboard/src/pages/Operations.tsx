import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { DISPLAY_NAME_MAP, AGENT_META } from '../lib/types';
import {
  Card,
  SectionHeader,
  AgentAvatar,
  Skeleton,
  timeAgo,
} from '../components/ui';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts';

interface AgentRow {
  id: string;
  role: string;
  codename: string;
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

function useAgentRuns() {
  const [data, setData] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: rows } = await supabase
      .from('company_agents')
      .select('id, role, codename, total_runs, total_cost_usd, last_run_at, last_run_duration_ms, performance_score')
      .order('role', { ascending: true });
    setData((rows as AgentRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { data, loading };
}

function useReflections(days = 14) {
  const [data, setData] = useState<ReflectionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data: rows } = await supabase
        .from('agent_reflections')
        .select('id, agent_role, quality_score, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: true });
      setData((rows as ReflectionRow[]) ?? []);
      setLoading(false);
    })();
  }, [days]);

  return { data, loading };
}

const ROLE_ORDER = ['chief-of-staff', 'cto', 'cpo', 'cfo', 'cmo', 'vp-customer-success', 'vp-sales', 'ops'];

interface SyncRow {
  id: string;
  source_name: string;
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
  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase.from('data_sync_status').select('*');
      setData((rows as SyncRow[] | null) ?? []);
      setLoading(false);
    })();
  }, []);
  return { data, loading };
}

function useIncidents() {
  const [data, setData] = useState<IncidentRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase.from('incidents').select('*').order('created_at', { ascending: false }).limit(20);
      setData((rows as IncidentRow[] | null) ?? []);
      setLoading(false);
    })();
  }, []);
  return { data, loading };
}

export default function Operations() {
  const { data: agents, loading: agentsLoading } = useAgentRuns();
  const { data: reflections, loading: reflectionsLoading } = useReflections(14);

  const loading = agentsLoading || reflectionsLoading;

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
        cost: parseFloat(a.total_cost_usd?.toFixed(2) ?? '0'),
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
      <div>
        <h1 className="text-2xl font-bold text-txt-primary">Operations</h1>
        <p className="mt-1 text-sm text-txt-muted">Agent performance, runs, and costs</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard label="Total Runs" value={String(totalRuns)} loading={loading} />
        <SummaryCard label="Total AI Spend" value={`$${totalCost.toFixed(2)}`} loading={loading} />
        <SummaryCard label="Avg Score" value={`${avgScore}/100`} loading={loading} />
        <SummaryCard label="Active Agents" value={`${agents.length}`} loading={loading} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Runs per Agent */}
        <Card>
          <SectionHeader title="Runs per Agent" />
          {loading ? (
            <Skeleton className="h-64" />
          ) : runsData.length === 0 ? (
            <EmptyChart message="No run data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={runsData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} width={70} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-txt-secondary)' }}
                />
                <Bar dataKey="runs" radius={[0, 4, 4, 0]}>
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
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={costData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${v}`} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} width={70} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-txt-secondary)' }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`]}
                />
                <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
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
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={qualityTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--color-txt-secondary)' }}
                formatter={(value: number) => [`${value}/100`, 'Avg Score']}
              />
              <Line type="monotone" dataKey="score" stroke="#623CEA" strokeWidth={2} dot={{ r: 3, fill: '#623CEA' }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Agent Detail Cards */}
      <div>
        <SectionHeader title="Agent Details" />
        <div className="grid grid-cols-2 gap-4">
          {agents.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)).map((agent) => (
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
                  <p className="text-[11px] text-txt-faint">${(agent.total_cost_usd ?? 0).toFixed(2)} total</p>
                </div>
              </div>
              {agent.last_run_duration_ms && (
                <p className="mt-2 text-[11px] text-txt-faint">
                  Last run: {(agent.last_run_duration_ms / 1000).toFixed(1)}s
                </p>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
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
