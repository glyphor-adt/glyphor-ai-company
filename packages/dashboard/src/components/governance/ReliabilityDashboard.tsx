import { useEffect, useMemo, useState } from 'react';
import { Card, SectionHeader, Skeleton } from '../ui';
import { apiCall, SCHEDULER_URL } from '../../lib/firebase';

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

interface PlanningGateRoleSummary {
  role: string;
  runsObserved: number;
  runsWithPlanning: number;
  runsWithGatePass: number;
  runsWithGateFail: number;
  planningEvents: number;
  gatePassEvents: number;
  gateFailEvents: number;
  maxRetryAttempt: number;
  avgMissingCriteriaMentions: number;
  passRate: number;
}

interface PlanningGateSnapshot {
  windowDays: number;
  totals: {
    runsObserved: number;
    runsWithPlanning: number;
    runsWithGatePass: number;
    runsWithGateFail: number;
    planningEvents: number;
    gatePassEvents: number;
    gateFailEvents: number;
    maxRetryAttempt: number;
    avgMissingCriteriaMentions: number;
    passRate: number;
  };
  roles: PlanningGateRoleSummary[];
}

interface PlanningGateEvalSuggestion {
  agentRole: string;
  scenarioName: string;
  criterion: string;
  gateFailureCount: number;
  inputPrompt: string;
  passCriteria: string;
  failIndicators: string;
  knowledgeTags: string[];
  scenarioAlreadyExists: boolean;
  existingScenarioId: string | null;
  seedRow: {
    agent_role: string;
    scenario_name: string;
    input_prompt: string;
    pass_criteria: string;
    fail_indicators: string;
    knowledge_tags: string[];
    tenant_id: string;
  };
}

interface PlanningGateEvalSuggestionsResponse {
  windowDays: number;
  generatedAt: string;
  suggestions: PlanningGateEvalSuggestion[];
  insertSql: string;
}

const CANONICAL_SCHEDULER_BASE = 'https://glyphor-scheduler-610179349713.us-central1.run.app';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlanningGateSnapshot(value: unknown): value is PlanningGateSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const totals = record.totals;
  return Boolean(
    typeof record.windowDays === 'number'
    && totals
    && typeof totals === 'object'
    && Array.isArray(record.roles),
  );
}

function isPlanningGateEvalSuggestionsResponse(value: unknown): value is PlanningGateEvalSuggestionsResponse {
  if (!isRecord(value)) return false;
  if (typeof value.windowDays !== 'number' || typeof value.generatedAt !== 'string') return false;
  if (typeof value.insertSql !== 'string') return false;
  if (!Array.isArray(value.suggestions)) return false;
  return true;
}

async function fetchPlanningGateSnapshot(windowDays: 7 | 30 | 90): Promise<PlanningGateSnapshot> {
  const path = `/admin/metrics/planning-gate?window=${windowDays}`;

  // Primary path: existing API client (keeps auth/header behavior).
  try {
    const response = await apiCall<PlanningGateSnapshot>(path);
    if (isPlanningGateSnapshot(response)) return response;
  } catch {
    // Fall through to direct scheduler fetch.
  }

  // Fallback path: direct scheduler origin to bypass miswired API base/proxy.
  const schedulerBase = (SCHEDULER_URL ?? '').trim();
  const fallbackBases = [schedulerBase, window.location.origin, CANONICAL_SCHEDULER_BASE]
    .map((base) => base.trim())
    .filter(Boolean);

  for (const base of fallbackBases) {
    try {
      const response = await fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (isPlanningGateSnapshot(data)) return data;
    } catch {
      // Continue trying additional fallback bases.
    }
  }

  throw new Error('Planning gate metrics unavailable: scheduler URL not configured');
}

async function fetchMetricWithFallback<T>(
  path: string,
  guard: (value: unknown) => value is T,
): Promise<T> {
  try {
    const response = await apiCall<T>(path);
    if (guard(response)) return response;
  } catch {
    // fall through to direct fetch
  }

  const fallbackBases = [window.location.origin, (SCHEDULER_URL ?? '').trim(), CANONICAL_SCHEDULER_BASE]
    .map((base) => base.trim())
    .filter(Boolean);

  for (const base of fallbackBases) {
    try {
      const response = await fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (guard(data)) return data;
    } catch {
      // Continue trying additional fallback bases.
    }
  }

  throw new Error(`Metric unavailable for ${path}`);
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

function formatSignedPercentDelta(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const basisPoints = value * 100;
  const sign = basisPoints > 0 ? '+' : '';
  return `${sign}${basisPoints.toFixed(1)}pp`;
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
  const [planningGate, setPlanningGate] = useState<PlanningGateSnapshot | null>(null);
  const [planningGate7d, setPlanningGate7d] = useState<PlanningGateSnapshot | null>(null);
  const [planningGate30d, setPlanningGate30d] = useState<PlanningGateSnapshot | null>(null);
  const [evalSuggestions, setEvalSuggestions] = useState<PlanningGateEvalSuggestionsResponse | null>(null);
  const [evalSuggestionsCopyHint, setEvalSuggestionsCopyHint] = useState<string | null>(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      try {
        const emptyPlanningGate: PlanningGateSnapshot = {
          windowDays,
          totals: {
            runsObserved: 0,
            runsWithPlanning: 0,
            runsWithGatePass: 0,
            runsWithGateFail: 0,
            planningEvents: 0,
            gatePassEvents: 0,
            gateFailEvents: 0,
            maxRetryAttempt: 0,
            avgMissingCriteriaMentions: 0,
            passRate: 0,
          },
          roles: [],
        };
        const [fleetCurrent, fleetThirty, agentResponse, exceptionResponse, planningGateResponse, planningGateWeek, planningGateMonth, evalSug] = await Promise.all([
          fetchMetricWithFallback<FleetMetricsSnapshot>(
            `/admin/metrics/fleet?window=${windowDays}`,
            (value): value is FleetMetricsSnapshot => isRecord(value) && typeof value.windowDays === 'number' && typeof value.tasksDispatched === 'number',
          ).catch(() => null),
          fetchMetricWithFallback<FleetMetricsSnapshot>(
            '/admin/metrics/fleet?window=30',
            (value): value is FleetMetricsSnapshot => isRecord(value) && typeof value.windowDays === 'number' && typeof value.tasksDispatched === 'number',
          ).catch(() => null),
          fetchMetricWithFallback<{ windowDays: number; agents: AgentMetricsSnapshot[] }>(
            `/admin/metrics/agents?window=${windowDays}`,
            (value): value is { windowDays: number; agents: AgentMetricsSnapshot[] } => isRecord(value) && Array.isArray(value.agents),
          ).catch(() => ({ windowDays, agents: [] })),
          fetchMetricWithFallback<{ items: ExceptionLogEntry[] }>(
            '/admin/metrics/exceptions?pageSize=12',
            (value): value is { items: ExceptionLogEntry[] } => isRecord(value) && Array.isArray(value.items),
          ).catch(() => ({ items: [] })),
          fetchPlanningGateSnapshot(windowDays).catch(() => null),
          fetchPlanningGateSnapshot(7).catch(() => null),
          fetchPlanningGateSnapshot(30).catch(() => null),
          fetchMetricWithFallback<PlanningGateEvalSuggestionsResponse>(
            `/admin/metrics/planning-gate-eval-suggestions?window=${windowDays}&limit=12`,
            isPlanningGateEvalSuggestionsResponse,
          ).catch(() => null),
        ]);

        if (!active) return;
        setFleet(fleetCurrent);
        setFleetMonth(fleetThirty);
        setAgents(agentResponse?.agents ?? []);
        setExceptions(exceptionResponse?.items ?? []);
        setPlanningGate(planningGateResponse ?? emptyPlanningGate);
        setPlanningGate7d(planningGateWeek ?? { ...emptyPlanningGate, windowDays: 7 });
        setPlanningGate30d(planningGateMonth ?? { ...emptyPlanningGate, windowDays: 30 });
        setEvalSuggestions(evalSug);
      } catch (error) {
        if (!active) return;
        setPlanningGate({
          windowDays,
          totals: {
            runsObserved: 0,
            runsWithPlanning: 0,
            runsWithGatePass: 0,
            runsWithGateFail: 0,
            planningEvents: 0,
            gatePassEvents: 0,
            gateFailEvents: 0,
            maxRetryAttempt: 0,
            avgMissingCriteriaMentions: 0,
            passRate: 0,
          },
          roles: [],
        });
        setPlanningGate7d(null);
        setPlanningGate30d(null);
        setEvalSuggestions(null);
        console.warn('[ReliabilityDashboard] Failed to load metrics:', error);
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
      const emptyPlanningGate: PlanningGateSnapshot = {
        windowDays,
        totals: {
          runsObserved: 0,
          runsWithPlanning: 0,
          runsWithGatePass: 0,
          runsWithGateFail: 0,
          planningEvents: 0,
          gatePassEvents: 0,
          gateFailEvents: 0,
          maxRetryAttempt: 0,
          avgMissingCriteriaMentions: 0,
          passRate: 0,
        },
        roles: [],
      };
      const [fleetCurrent, fleetThirty, agentResponse, exceptionResponse, planningGateResponse, planningGateWeek, planningGateMonth, evalSug] = await Promise.all([
        fetchMetricWithFallback<FleetMetricsSnapshot>(
          `/admin/metrics/fleet?window=${windowDays}`,
          (value): value is FleetMetricsSnapshot => isRecord(value) && typeof value.windowDays === 'number' && typeof value.tasksDispatched === 'number',
        ).catch(() => null),
        fetchMetricWithFallback<FleetMetricsSnapshot>(
          '/admin/metrics/fleet?window=30',
          (value): value is FleetMetricsSnapshot => isRecord(value) && typeof value.windowDays === 'number' && typeof value.tasksDispatched === 'number',
        ).catch(() => null),
        fetchMetricWithFallback<{ windowDays: number; agents: AgentMetricsSnapshot[] }>(
          `/admin/metrics/agents?window=${windowDays}`,
          (value): value is { windowDays: number; agents: AgentMetricsSnapshot[] } => isRecord(value) && Array.isArray(value.agents),
        ).catch(() => ({ windowDays, agents: [] })),
        fetchMetricWithFallback<{ items: ExceptionLogEntry[] }>(
          '/admin/metrics/exceptions?pageSize=12',
          (value): value is { items: ExceptionLogEntry[] } => isRecord(value) && Array.isArray(value.items),
        ).catch(() => ({ items: [] })),
        fetchPlanningGateSnapshot(windowDays).catch(() => null),
        fetchPlanningGateSnapshot(7).catch(() => null),
        fetchPlanningGateSnapshot(30).catch(() => null),
        fetchMetricWithFallback<PlanningGateEvalSuggestionsResponse>(
          `/admin/metrics/planning-gate-eval-suggestions?window=${windowDays}&limit=12`,
          isPlanningGateEvalSuggestionsResponse,
        ).catch(() => null),
      ]);
      setFleet(fleetCurrent);
      setFleetMonth(fleetThirty);
      setAgents(agentResponse?.agents ?? []);
      setExceptions(exceptionResponse?.items ?? []);
      setPlanningGate(planningGateResponse ?? emptyPlanningGate);
      setPlanningGate7d(planningGateWeek ?? { ...emptyPlanningGate, windowDays: 7 });
      setPlanningGate30d(planningGateMonth ?? { ...emptyPlanningGate, windowDays: 30 });
      setEvalSuggestions(evalSug);
    } catch (error) {
      console.warn('[ReliabilityDashboard] Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const passRateTrendDelta = useMemo(() => {
    if (!planningGate7d || !planningGate30d) return null;
    return planningGate7d.totals.passRate - planningGate30d.totals.passRate;
  }, [planningGate7d, planningGate30d]);

  const retryTrendDelta = useMemo(() => {
    if (!planningGate7d || !planningGate30d) return null;
    return planningGate7d.totals.maxRetryAttempt - planningGate30d.totals.maxRetryAttempt;
  }, [planningGate7d, planningGate30d]);

  const rolePassRateRegressions = useMemo(() => {
    if (!planningGate7d || !planningGate30d) return [];
    const monthByRole = new Map(planningGate30d.roles.map((role) => [role.role, role]));
    return planningGate7d.roles
      .map((weekRole) => {
        const monthRole = monthByRole.get(weekRole.role);
        const monthPass = monthRole?.passRate ?? 0;
        return {
          role: weekRole.role,
          weekPassRate: weekRole.passRate,
          monthPassRate: monthPass,
          delta: weekRole.passRate - monthPass,
          weekRuns: weekRole.runsWithPlanning,
          weekMaxRetry: weekRole.maxRetryAttempt,
        };
      })
      .filter((role) => role.weekRuns > 0)
      .sort((a, b) => a.delta - b.delta || b.weekMaxRetry - a.weekMaxRetry)
      .slice(0, 6);
  }, [planningGate7d, planningGate30d]);

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

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          title={`Completion Gate Pass Rate (${windowDays}d)`}
          value={formatPercent(planningGate?.totals.passRate)}
          subtitle={`${formatNumber(planningGate?.totals.runsWithGatePass ?? 0, 0)} passed / ${formatNumber(planningGate?.totals.runsWithPlanning ?? 0, 0)} planned runs`}
        />
        <MetricCard
          title="Completion Gate Fails"
          value={formatNumber(planningGate?.totals.gateFailEvents ?? 0, 0)}
          subtitle={`${formatNumber(planningGate?.totals.runsWithGateFail ?? 0, 0)} runs had at least one failure`}
        />
        <MetricCard
          title="Max Gate Retry Attempt"
          value={formatNumber(planningGate?.totals.maxRetryAttempt ?? 0, 0)}
          subtitle={`Avg missing criteria mentions: ${formatNumber(planningGate?.totals.avgMissingCriteriaMentions ?? 0)}`}
        />
      </div>

      <Card>
        <SectionHeader
          title="Planning Gate Trend"
          subtitle="7-day behavior compared against 30-day baseline."
        />
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Gate Pass Rate (7d)"
            value={formatPercent(planningGate7d?.totals.passRate)}
            subtitle={`30d baseline: ${formatPercent(planningGate30d?.totals.passRate)}`}
          />
          <MetricCard
            title="Pass Rate Delta"
            value={formatSignedPercentDelta(passRateTrendDelta)}
            subtitle="7d minus 30d baseline"
          />
          <MetricCard
            title="Max Retry (7d)"
            value={formatNumber(planningGate7d?.totals.maxRetryAttempt ?? 0, 0)}
            subtitle={`30d baseline: ${formatNumber(planningGate30d?.totals.maxRetryAttempt ?? 0, 0)}`}
          />
          <MetricCard
            title="Retry Delta"
            value={formatNumber(retryTrendDelta, 0)}
            subtitle="7d minus 30d baseline"
          />
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-[12px] text-txt-secondary">
            <thead>
              <tr className="border-b border-border/70 text-[11px] uppercase tracking-[0.16em] text-txt-muted">
                <th className="px-3 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">7d Pass Rate</th>
                <th className="px-3 py-3 font-medium">30d Pass Rate</th>
                <th className="px-3 py-3 font-medium">Delta</th>
                <th className="px-3 py-3 font-medium">7d Planned Runs</th>
                <th className="px-3 py-3 font-medium">7d Max Retry</th>
              </tr>
            </thead>
            <tbody>
              {rolePassRateRegressions.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-txt-muted" colSpan={6}>
                    No role trend data found yet.
                  </td>
                </tr>
              ) : (
                rolePassRateRegressions.map((role) => (
                  <tr key={role.role} className="border-b border-border/50 align-top hover:bg-white/5">
                    <td className="px-3 py-3 text-txt-primary">{role.role}</td>
                    <td className="px-3 py-3">{formatPercent(role.weekPassRate)}</td>
                    <td className="px-3 py-3">{formatPercent(role.monthPassRate)}</td>
                    <td className="px-3 py-3">{formatSignedPercentDelta(role.delta)}</td>
                    <td className="px-3 py-3">{formatNumber(role.weekRuns, 0)}</td>
                    <td className="px-3 py-3">{formatNumber(role.weekMaxRetry, 0)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <SectionHeader
            title="Golden eval drafts from gate misses"
            subtitle="When agents often fail the completion gate for the same reason, this lists draft “practice tasks” you can promote into your official quality checks—so improvements are measurable, not guessed."
          />
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:flex-wrap">
            {evalSuggestionsCopyHint ? (
              <span className="text-[11px] text-txt-muted">{evalSuggestionsCopyHint}</span>
            ) : null}
            <button
              type="button"
              disabled={!evalSuggestions?.suggestions.length}
              onClick={() => {
                if (!evalSuggestions?.suggestions.length) return;
                const payload = evalSuggestions.suggestions.map((s) => s.seedRow);
                void navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
                  .then(() => {
                    setEvalSuggestionsCopyHint('Copied seed JSON');
                    window.setTimeout(() => setEvalSuggestionsCopyHint(null), 2500);
                  })
                  .catch(() => {
                    setEvalSuggestionsCopyHint('Copy failed — check browser permissions');
                    window.setTimeout(() => setEvalSuggestionsCopyHint(null), 4000);
                  });
              }}
              title="Structured list of every row in the table—for spreadsheets, tickets, or custom tools."
              className="rounded-lg theme-glass-panel-soft px-4 py-2 text-[13px] font-medium text-txt-secondary transition-colors hover:border-primary/40 hover:text-txt-primary disabled:opacity-50"
            >
              Copy seed JSON
            </button>
            <button
              type="button"
              disabled={!evalSuggestions?.insertSql?.includes('INSERT INTO')}
              title="Database-ready text for rows marked New only. Usually handed to whoever adds official practice tasks to the system."
              onClick={() => {
                if (!evalSuggestions?.insertSql?.includes('INSERT INTO')) return;
                void navigator.clipboard.writeText(evalSuggestions.insertSql)
                  .then(() => {
                    setEvalSuggestionsCopyHint('Copied INSERT SQL (new scenarios only)');
                    window.setTimeout(() => setEvalSuggestionsCopyHint(null), 2500);
                  })
                  .catch(() => {
                    setEvalSuggestionsCopyHint('Copy failed — check browser permissions');
                    window.setTimeout(() => setEvalSuggestionsCopyHint(null), 4000);
                  });
              }}
              className="rounded-lg theme-glass-panel-soft px-4 py-2 text-[13px] font-medium text-txt-secondary transition-colors hover:border-primary/40 hover:text-txt-primary disabled:opacity-50"
            >
              Copy INSERT SQL
            </button>
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-border/60 bg-bg-elevated/40 p-3 text-[12px] leading-relaxed text-txt-secondary">
          <p className="font-semibold text-txt-primary">When do I use this?</p>
          <ul className="mt-2 list-inside list-disc space-y-1.5 text-[12px]">
            <li>
              <span className="font-medium text-txt-primary">Same problem, many times:</span>
              {' '}
              a requirement keeps showing up as “missing”—good signal you want a standing check, not a one-off fix.
            </li>
            <li>
              <span className="font-medium text-txt-primary">Before or after a big change:</span>
              {' '}
              you adjusted prompts, tools, or models and want a clear before/after quality signal (golden evals).
            </li>
            <li>
              <span className="font-medium text-txt-primary">What the buttons do:</span>
              {' '}
              they do not change production by themselves. They package drafts for review; <strong className="text-txt-primary">New</strong> vs <strong className="text-txt-primary">In suite</strong> shows whether that practice task already exists.
            </li>
          </ul>
          <p className="mt-2 text-[11px] text-txt-muted">
            Technical note: drafts use names like <code className="rounded bg-white/5 px-1 font-mono text-[10px]">golden:from-gate:…</code>
            {' '}
            so they stay grouped with other golden tasks. Nothing is saved until someone applies the copied text in your normal release process.
          </p>
        </div>
        <p className="mt-2 text-[11px] text-txt-muted">
          Generated {formatDateTime(evalSuggestions?.generatedAt)} · window {evalSuggestions?.windowDays ?? windowDays}d · top {evalSuggestions?.suggestions.length ?? 0} role×criterion pairs
          {evalSuggestions?.suggestions.length
            ? ` · ${evalSuggestions.suggestions.filter((s) => !s.scenarioAlreadyExists).length} new · ${evalSuggestions.suggestions.filter((s) => s.scenarioAlreadyExists).length} already in suite`
            : ''}
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-[12px] text-txt-secondary">
            <thead>
              <tr className="border-b border-border/70 text-[11px] uppercase tracking-[0.16em] text-txt-muted">
                <th className="px-3 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">Suite</th>
                <th className="px-3 py-3 font-medium">Gate fails</th>
                <th className="px-3 py-3 font-medium">Missing criterion</th>
                <th className="px-3 py-3 font-medium">Scenario name</th>
              </tr>
            </thead>
            <tbody>
              {!evalSuggestions?.suggestions.length ? (
                <tr>
                  <td className="px-3 py-3 text-txt-muted" colSpan={5}>
                    No completion-gate failures with structured missing criteria in this window.
                  </td>
                </tr>
              ) : (
                evalSuggestions.suggestions.map((row) => (
                  <tr key={`${row.agentRole}-${row.scenarioName}`} className="border-b border-border/50 align-top hover:bg-white/5">
                    <td className="px-3 py-3 text-txt-primary">{row.agentRole}</td>
                    <td className="px-3 py-3">
                      {row.scenarioAlreadyExists ? (
                        <span className="rounded border border-border/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-txt-muted" title={row.existingScenarioId ?? undefined}>
                          In suite
                        </span>
                      ) : (
                        <span className="rounded border border-prism-sky/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-prism-sky">
                          New
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">{formatNumber(row.gateFailureCount, 0)}</td>
                    <td className="max-w-md px-3 py-3 text-txt-secondary">{row.criterion}</td>
                    <td className="px-3 py-3 font-mono text-[11px] text-txt-muted">{row.scenarioName}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

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

      <Card>
        <SectionHeader
          title="Planning & Completion Gate"
          subtitle="Run-level planning and completion-gate telemetry aggregated from runtime ledger events."
        />
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-[12px] text-txt-secondary">
            <thead>
              <tr className="border-b border-border/70 text-[11px] uppercase tracking-[0.16em] text-txt-muted">
                <th className="px-3 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">Runs</th>
                <th className="px-3 py-3 font-medium">With Planning</th>
                <th className="px-3 py-3 font-medium">Gate Pass Rate</th>
                <th className="px-3 py-3 font-medium">Gate Fails</th>
                <th className="px-3 py-3 font-medium">Max Retry</th>
                <th className="px-3 py-3 font-medium">Avg Missing Criteria</th>
              </tr>
            </thead>
            <tbody>
              {(planningGate?.roles ?? []).length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-txt-muted" colSpan={7}>
                    No planning/completion-gate events found for this window.
                  </td>
                </tr>
              ) : (
                (planningGate?.roles ?? []).map((role) => (
                  <tr key={role.role} className="border-b border-border/50 align-top hover:bg-white/5">
                    <td className="px-3 py-3 text-txt-primary">{role.role}</td>
                    <td className="px-3 py-3">{formatNumber(role.runsObserved, 0)}</td>
                    <td className="px-3 py-3">{formatNumber(role.runsWithPlanning, 0)}</td>
                    <td className="px-3 py-3">{formatPercent(role.passRate)}</td>
                    <td className="px-3 py-3">{formatNumber(role.gateFailEvents, 0)}</td>
                    <td className="px-3 py-3">{formatNumber(role.maxRetryAttempt, 0)}</td>
                    <td className="px-3 py-3">{formatNumber(role.avgMissingCriteriaMentions)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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