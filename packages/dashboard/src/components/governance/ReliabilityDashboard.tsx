import { useEffect, useMemo, useState } from 'react';
import { Card, SectionHeader, Skeleton } from '../ui';
import { apiCall } from '../../lib/firebase';

interface FleetLeaderMetric {
  agentId: string;
  agentName: string;
  value: number;
}

interface FleetMetricsSnapshot {
  windowDays: number;
  tasksDispatched: number;
  completionRate: number;
  escalationRate: number;
  avgAutonomyLevel: number | null;
  mostReliableAgent: FleetLeaderMetric | null;
  mostEscalations: FleetLeaderMetric | null;
  mostImproved: (FleetLeaderMetric & { previousValue: number; delta: number }) | null;
}

interface AgentMetricsSnapshot {
  agentId: string;
  agentName: string;
  department: string | null;
  roleCategory: string | null;
  windowDays: number;
  tasksDispatched: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksEscalated: number;
  completionRate: number;
  escalationRate: number;
  avgConfidenceScore: number | null;
  avgTimeToCompletionMinutes: number | null;
  computeCostPerTask: number;
  slaBreachRate: number;
  contradictionRate: number;
  trustScoreCurrent: number | null;
}

interface ExceptionLogEntry {
  taskId: string;
  agentId: string;
  agentName: string;
  escalationReason: string | null;
  escalatedAt: string;
  resolvedByHumanId: string | null;
  resolution: string | null;
  resolutionTimeMinutes: number | null;
}

type SortKey = keyof Pick<AgentMetricsSnapshot,
  'agentName' |
  'department' |
  'tasksDispatched' |
  'tasksCompleted' |
  'tasksFailed' |
  'tasksEscalated' |
  'completionRate' |
  'escalationRate' |
  'avgConfidenceScore' |
  'avgTimeToCompletionMinutes' |
  'computeCostPerTask' |
  'slaBreachRate' |
  'contradictionRate' |
  'trustScoreCurrent'>;

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits > 0 ? Math.min(digits, 1) : 0 });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function autonomyLabel(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value < 1.5) return 'Observe';
  if (value < 2.5) return 'Draft';
  if (value < 3.5) return 'Execute';
  return 'Commit';
}

function statusTone(item: ExceptionLogEntry): string {
  return item.resolution ? 'badge-teal' : 'badge-amber';
}

export default function ReliabilityDashboard() {
  const [windowDays, setWindowDays] = useState<7 | 30 | 90>(30);
  const [department, setDepartment] = useState('all');
  const [sortKey, setSortKey] = useState<SortKey>('completionRate');
  const [sortDescending, setSortDescending] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fleet, setFleet] = useState<FleetMetricsSnapshot | null>(null);
  const [fleetMonth, setFleetMonth] = useState<FleetMetricsSnapshot | null>(null);
  const [agents, setAgents] = useState<AgentMetricsSnapshot[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionLogEntry[]>([]);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      try {
        const [fleetCurrent, fleetThirty, agentResponse, exceptionResponse] = await Promise.all([
          apiCall<FleetMetricsSnapshot>(`/admin/metrics/fleet?window=${windowDays}`),
          apiCall<FleetMetricsSnapshot>('/admin/metrics/fleet?window=30'),
          apiCall<{ windowDays: number; agents: AgentMetricsSnapshot[] }>(`/admin/metrics/agents?window=${windowDays}`),
          apiCall<{ items: ExceptionLogEntry[] }>('/admin/metrics/exceptions?pageSize=12'),
        ]);

        if (!active) return;
        setFleet(fleetCurrent);
        setFleetMonth(fleetThirty);
        setAgents(agentResponse?.agents ?? []);
        setExceptions(exceptionResponse?.items ?? []);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => { active = false; };
  }, [windowDays]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const [fleetCurrent, fleetThirty, agentResponse, exceptionResponse] = await Promise.all([
        apiCall<FleetMetricsSnapshot>(`/admin/metrics/fleet?window=${windowDays}`),
        apiCall<FleetMetricsSnapshot>('/admin/metrics/fleet?window=30'),
        apiCall<{ windowDays: number; agents: AgentMetricsSnapshot[] }>(`/admin/metrics/agents?window=${windowDays}`),
        apiCall<{ items: ExceptionLogEntry[] }>('/admin/metrics/exceptions?pageSize=12'),
      ]);
      setFleet(fleetCurrent);
      setFleetMonth(fleetThirty);
      setAgents(agentResponse?.agents ?? []);
      setExceptions(exceptionResponse?.items ?? []);
    } finally {
      setRefreshing(false);
    }
  };

  const departmentOptions = useMemo(() => {
    const values = new Set<string>();
    agents.forEach((agent) => {
      if (agent.department) values.add(agent.department);
    });
    return ['all', ...Array.from(values).sort((left, right) => left.localeCompare(right))];
  }, [agents]);

  const filteredAgents = useMemo(() => {
    const source = department === 'all'
      ? agents
      : agents.filter((agent) => agent.department === department);

    const list = [...source];
    list.sort((left, right) => {
      const leftValue = left[sortKey] ?? null;
      const rightValue = right[sortKey] ?? null;
      let comparison = 0;
      if (typeof leftValue === 'string' || typeof rightValue === 'string') {
        comparison = String(leftValue ?? '').localeCompare(String(rightValue ?? ''));
      } else {
        comparison = Number(leftValue ?? Number.NEGATIVE_INFINITY) - Number(rightValue ?? Number.NEGATIVE_INFINITY);
      }
      return sortDescending ? -comparison : comparison;
    });
    return list;
  }, [agents, department, sortDescending, sortKey]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDescending((value) => !value);
      return;
    }
    setSortKey(key);
    setSortDescending(true);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Reliability Overview" subtitle="Loading fleet reliability metrics, agent scorecards, and recent escalations…" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((index) => <Skeleton key={index} className="h-32 w-full" />)}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <SectionHeader
          title="Reliability Overview"
          subtitle="Per-agent completion, escalation, contradiction, trust, and compute metrics sourced from the runtime audit trail."
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-[12px] text-txt-muted">
            <span className="mr-2">Window</span>
            <select
              value={windowDays}
              onChange={(event) => setWindowDays(Number(event.target.value) as 7 | 30 | 90)}
              className="rounded-xl border border-border bg-transparent px-3 py-2 text-[13px] text-txt-primary outline-none transition-colors focus:border-prism-sky/50"
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="rounded-lg theme-glass-panel-soft px-4 py-2 text-[13px] font-medium text-txt-secondary transition-colors hover:border-primary/40 hover:text-txt-primary disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title={`Fleet Completion Rate (${windowDays}d)`} value={formatPercent(fleet?.completionRate)} subtitle={fleet?.mostReliableAgent ? `Best: ${fleet.mostReliableAgent.agentName}` : 'No leader yet'} />
        <MetricCard title={`Fleet Escalation Rate (${windowDays}d)`} value={formatPercent(fleet?.escalationRate)} subtitle={fleet?.mostEscalations ? `Most escalations: ${fleet.mostEscalations.agentName}` : 'No escalations recorded'} />
        <MetricCard title="Total Tasks This Month" value={formatNumber(fleetMonth?.tasksDispatched ?? 0, 0)} subtitle="30-day dispatched assignment volume" />
        <MetricCard title="Avg Autonomy Level" value={fleet?.avgAutonomyLevel != null ? `${formatNumber(fleet.avgAutonomyLevel)} · ${autonomyLabel(fleet.avgAutonomyLevel)}` : '—'} subtitle={fleet?.mostImproved ? `Most improved: ${fleet.mostImproved.agentName}` : 'No improvement delta yet'} />
      </div>

      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeader title="Agent Reliability Table" subtitle="Sortable per-agent scorecard with dynamic rows for any number of active agents." />
          <label className="text-[12px] text-txt-muted">
            <span className="mr-2">Department</span>
            <select
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              className="rounded-xl border border-border bg-transparent px-3 py-2 text-[13px] text-txt-primary outline-none transition-colors focus:border-prism-sky/50"
            >
              {departmentOptions.map((option) => (
                <option key={option} value={option}>{option === 'all' ? 'All departments' : option}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-[12px] text-txt-secondary">
            <thead>
              <tr className="border-b border-border/70 text-[11px] uppercase tracking-[0.16em] text-txt-muted">
                <SortableHeader label="Agent" active={sortKey === 'agentName'} descending={sortDescending} onClick={() => toggleSort('agentName')} />
                <SortableHeader label="Department" active={sortKey === 'department'} descending={sortDescending} onClick={() => toggleSort('department')} />
                <SortableHeader label="Completion" active={sortKey === 'completionRate'} descending={sortDescending} onClick={() => toggleSort('completionRate')} />
                <SortableHeader label="Escalation" active={sortKey === 'escalationRate'} descending={sortDescending} onClick={() => toggleSort('escalationRate')} />
                <SortableHeader label="Dispatched" active={sortKey === 'tasksDispatched'} descending={sortDescending} onClick={() => toggleSort('tasksDispatched')} />
                <SortableHeader label="Completed" active={sortKey === 'tasksCompleted'} descending={sortDescending} onClick={() => toggleSort('tasksCompleted')} />
                <SortableHeader label="Failed" active={sortKey === 'tasksFailed'} descending={sortDescending} onClick={() => toggleSort('tasksFailed')} />
                <SortableHeader label="Confidence" active={sortKey === 'avgConfidenceScore'} descending={sortDescending} onClick={() => toggleSort('avgConfidenceScore')} />
                <SortableHeader label="Time To Complete" active={sortKey === 'avgTimeToCompletionMinutes'} descending={sortDescending} onClick={() => toggleSort('avgTimeToCompletionMinutes')} />
                <SortableHeader label="Tokens / Task" active={sortKey === 'computeCostPerTask'} descending={sortDescending} onClick={() => toggleSort('computeCostPerTask')} />
                <SortableHeader label="SLA Breach" active={sortKey === 'slaBreachRate'} descending={sortDescending} onClick={() => toggleSort('slaBreachRate')} />
                <SortableHeader label="Contradiction" active={sortKey === 'contradictionRate'} descending={sortDescending} onClick={() => toggleSort('contradictionRate')} />
                <SortableHeader label="Trust" active={sortKey === 'trustScoreCurrent'} descending={sortDescending} onClick={() => toggleSort('trustScoreCurrent')} />
              </tr>
            </thead>
            <tbody>
              {filteredAgents.map((agent) => (
                <tr key={agent.agentId} className="border-b border-border/50 align-top hover:bg-white/5">
                  <td className="px-3 py-3 text-txt-primary">
                    <div className="font-semibold">{agent.agentName}</div>
                    <div className="mt-1 text-[11px] text-txt-muted">{agent.agentId}</div>
                  </td>
                  <td className="px-3 py-3">{agent.department ?? '—'}</td>
                  <td className="px-3 py-3">{formatPercent(agent.completionRate)}</td>
                  <td className="px-3 py-3">{formatPercent(agent.escalationRate)}</td>
                  <td className="px-3 py-3">{formatNumber(agent.tasksDispatched, 0)}</td>
                  <td className="px-3 py-3">{formatNumber(agent.tasksCompleted, 0)}</td>
                  <td className="px-3 py-3">{formatNumber(agent.tasksFailed, 0)}</td>
                  <td className="px-3 py-3">{formatPercent(agent.avgConfidenceScore)}</td>
                  <td className="px-3 py-3">{agent.avgTimeToCompletionMinutes != null ? `${formatNumber(agent.avgTimeToCompletionMinutes)} min` : '—'}</td>
                  <td className="px-3 py-3">{formatNumber(agent.computeCostPerTask)}</td>
                  <td className="px-3 py-3">{formatPercent(agent.slaBreachRate)}</td>
                  <td className="px-3 py-3">{formatPercent(agent.contradictionRate)}</td>
                  <td className="px-3 py-3">{formatPercent(agent.trustScoreCurrent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <SectionHeader title="Exception Log" subtitle="Recent escalations requiring human attention, with resolution state and elapsed resolution time when available." />
        <div className="mt-4 space-y-3">
          {exceptions.length === 0 ? (
            <p className="text-[13px] text-txt-muted">No escalated tasks were returned.</p>
          ) : exceptions.map((item) => {
            const expanded = Boolean(expandedTaskIds[item.taskId]);
            return (
              <div key={`${item.taskId}-${item.escalatedAt}`} className="rounded-xl theme-glass-panel p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={statusTone(item)}>{item.resolution ? 'Resolved' : 'Open'}</span>
                      <p className="text-sm font-semibold text-txt-primary">{item.agentName}</p>
                      <p className="text-[12px] text-txt-muted">Task {item.taskId}</p>
                    </div>
                    <p className="mt-2 text-[13px] text-txt-secondary">{item.escalationReason ?? 'No escalation reason recorded.'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedTaskIds((current) => ({ ...current, [item.taskId]: !expanded }))}
                    className="rounded-lg border border-border px-3 py-1 text-[12px] text-txt-secondary transition-colors hover:border-prism-sky/40 hover:text-txt-primary"
                  >
                    {expanded ? 'Collapse' : 'Expand'}
                  </button>
                </div>
                {expanded && (
                  <div className="mt-4 grid gap-3 text-[12px] text-txt-secondary md:grid-cols-2 xl:grid-cols-4">
                    <Detail label="Escalated At" value={formatDateTime(item.escalatedAt)} />
                    <Detail label="Resolved By Human" value={item.resolvedByHumanId ?? '—'} />
                    <Detail label="Resolution" value={item.resolution ?? 'Still open'} />
                    <Detail label="Resolution Time" value={item.resolutionTimeMinutes != null ? `${formatNumber(item.resolutionTimeMinutes)} min` : '—'} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function MetricCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <Card>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-txt-muted">{title}</p>
      <p className="mt-3 text-2xl font-semibold text-txt-primary">{value}</p>
      <p className="mt-2 text-[12px] text-txt-muted">{subtitle}</p>
    </Card>
  );
}

function SortableHeader({ label, active, descending, onClick }: { label: string; active: boolean; descending: boolean; onClick: () => void }) {
  return (
    <th className="px-3 py-3 font-medium">
      <button type="button" onClick={onClick} className={`transition-colors hover:text-txt-primary ${active ? 'text-txt-primary' : ''}`}>
        {label}{active ? (descending ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-txt-muted">{label}</p>
      <p className="mt-2 text-[13px] text-txt-primary">{value}</p>
    </div>
  );
}