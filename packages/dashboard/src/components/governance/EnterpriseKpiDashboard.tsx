import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Card, SectionHeader, Skeleton } from '../ui';
import { apiCall } from '../../lib/firebase';
import { daysSince, EmptyState, formatDateTime, formatPercent } from './shared';

type WindowDays = 7 | 30 | 90;

interface EnterpriseKpiSnapshot {
  windowDays: number;
  generatedAt: string;
  proactivity: {
    enabledSchedules: number;
    disabledSchedules: number;
    lastScheduleTriggerAt: string | null;
    runsInWindow: number;
    runsCompletedInWindow: number;
    topTasks: Array<{ task: string | null; runs: number }>;
  } | null;
  proactivityError?: string;
  commitments: {
    pendingApprovalNow: number;
    byStatusInWindow: Array<{ status: string; count: number }>;
  } | null;
  commitmentsError?: string;
  circuitBreaker: {
    haltActive: boolean;
    haltLevel: number | null;
    haltReason: string | null;
    triggeredAt: string | null;
    triggeredBy: string | null;
  } | null;
  circuitBreakerError?: string;
  auditTrail: {
    agentRunEventsInWindow: number;
    runsWithPlanManifest: number;
    runsInWindow: number;
    decisionTracesInWindow: number | null;
  } | null;
  auditTrailError?: string;
  knowledge: {
    worldModelOldestUpdateAt: string | null;
    worldModelNewestUpdateAt: string | null;
    contradictionsByStatus: Array<{ status: string; count: number }> | null;
    unresolvedContradictions: number | null;
  } | null;
  knowledgeError?: string;
  handoffs: {
    byStatusInWindow: Array<{ status: string; count: number }>;
    escalatedInWindow: number;
  } | null;
  handoffsError?: string;
  coordination: {
    chiefOfStaffRunsInWindow: number;
    workAssignmentsInWindow: number;
  } | null;
  coordinationError?: string;
  resilience: {
    completionGateAutoRepairTriggersInWindow: number;
    completionGateFailedEventsInWindow: number;
    completionGatePassedEventsInWindow: number;
  } | null;
  resilienceError?: string;
  goldenEval: {
    total: number;
    passed: number;
    passRate: number | null;
    byRole: Array<{ agentRole: string; total: number; passed: number; passRate: number }>;
  } | null;
  goldenEvalError?: string;
}

/* ── Health status helpers ── */
type Health = 'green' | 'yellow' | 'red' | 'neutral';

const healthColors: Record<Health, string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-red-400',
  neutral: 'bg-zinc-500',
};

const healthBorders: Record<Health, string> = {
  green: 'border-emerald-500/30',
  yellow: 'border-amber-500/30',
  red: 'border-red-500/30',
  neutral: 'border-zinc-500/20',
};

function HealthDot({ status }: { status: Health }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${healthColors[status]}`} />;
}

function Headline({ value, unit, sub }: { value: string; unit?: string; sub?: string }) {
  return (
    <div className="mt-2 mb-1">
      <span className="text-2xl font-semibold text-txt-primary">{value}</span>
      {unit && <span className="ml-1 text-sm text-txt-muted">{unit}</span>}
      {sub && <p className="mt-0.5 text-[11px] text-txt-muted">{sub}</p>}
    </div>
  );
}

function KpiCard({
  title,
  health = 'neutral',
  children,
  error,
}: {
  title: string;
  health?: Health;
  children: ReactNode;
  error?: string;
}) {
  return (
    <Card className={`theme-glass-panel-soft p-4 border ${healthBorders[health]}`}>
      <div className="flex items-center gap-2">
        <HealthDot status={error ? 'red' : health} />
        <span className="text-[13px] font-medium text-txt-primary">{title}</span>
      </div>
      <div className="mt-1 text-sm text-txt-secondary">
        {error ? <span className="text-prism-critical text-[12px]">{error}</span> : children}
      </div>
    </Card>
  );
}

function rateHealth(rate: number, good: number, warn: number): Health {
  if (rate >= good) return 'green';
  if (rate >= warn) return 'yellow';
  return 'red';
}

function fmtNum(n: number): string {
  return n >= 1000 ? n.toLocaleString() : String(n);
}

export default function EnterpriseKpiDashboard() {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [data, setData] = useState<EnterpriseKpiSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const json = await apiCall<EnterpriseKpiSnapshot>(
        `/admin/metrics/enterprise-kpi-snapshot?window=${windowDays}`,
      );
      if (
        !json
        || typeof json !== 'object'
        || typeof (json as EnterpriseKpiSnapshot).generatedAt !== 'string'
        || typeof (json as EnterpriseKpiSnapshot).windowDays !== 'number'
      ) {
        throw new Error(
          'Enterprise KPI response was missing fields (expected generatedAt, windowDays). '
          + 'Confirm the scheduler is deployed with GET /admin/metrics/enterprise-kpi-snapshot.',
        );
      }
      setData(json);
    } catch (err) {
      setData(null);
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [windowDays]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <SectionHeader title="Enterprise KPIs" subtitle="Loading…" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <EmptyState
        title="Could not load enterprise KPIs"
        description={`${fetchError} Deploy scheduler with /admin/metrics/enterprise-kpi-snapshot and ensure admin API routing reaches the scheduler.`}
      />
    );
  }

  const snap = data;

  /* ── Computed KPIs ── */
  const completionRate = snap?.proactivity && snap.proactivity.runsInWindow > 0
    ? snap.proactivity.runsCompletedInWindow / snap.proactivity.runsInWindow
    : null;

  const commitTotal = snap?.commitments?.byStatusInWindow.reduce((s, c) => s + c.count, 0) ?? 0;
  const commitApproved = snap?.commitments?.byStatusInWindow.find((s) => s.status === 'approved')?.count ?? 0;
  const approvalRate = commitTotal > 0 ? commitApproved / commitTotal : null;

  const eventsPerRun = snap?.auditTrail && snap.auditTrail.runsInWindow > 0
    ? snap.auditTrail.agentRunEventsInWindow / snap.auditTrail.runsInWindow
    : null;
  const planCoverage = snap?.auditTrail && snap.auditTrail.runsInWindow > 0
    ? snap.auditTrail.runsWithPlanManifest / snap.auditTrail.runsInWindow
    : null;

  const knowledgeAgeDays = daysSince(snap?.knowledge?.worldModelNewestUpdateAt);

  const handoffTotal = snap?.handoffs?.byStatusInWindow.reduce((s, h) => s + h.count, 0) ?? 0;
  const handoffCompleted = snap?.handoffs?.byStatusInWindow.find((s) => s.status === 'completed')?.count ?? 0;
  const handoffCompletionRate = handoffTotal > 0 ? handoffCompleted / handoffTotal : null;

  const gateTotal = snap?.resilience
    ? snap.resilience.completionGatePassedEventsInWindow + snap.resilience.completionGateFailedEventsInWindow
    : 0;
  const gatePassRate = gateTotal > 0 ? snap!.resilience!.completionGatePassedEventsInWindow / gateTotal : null;

  const goldenRate = snap?.goldenEval?.passRate ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeader
          title="Enterprise KPIs"
          subtitle="Fleet health at a glance — computed from live operational data"
        />
        <div className="flex items-center gap-2">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setWindowDays(d)}
              className={`rounded-lg px-3 py-1.5 text-[12px] font-medium ${
                windowDays === d
                  ? 'bg-prism-teal/20 text-prism-teal'
                  : 'theme-glass-panel-soft text-txt-muted hover:text-txt-secondary'
              }`}
            >
              {d}d
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg theme-glass-panel-soft px-3 py-1.5 text-[12px] font-medium text-txt-secondary hover:text-txt-primary"
          >
            Refresh
          </button>
        </div>
      </div>
      {snap?.generatedAt && (
        <p className="text-[11px] text-txt-muted">Generated {formatDateTime(snap.generatedAt)} · window {snap.windowDays}d</p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* ── 1. Proactivity ── */}
        <KpiCard
          title="Run Completion Rate"
          health={completionRate != null ? rateHealth(completionRate, 0.70, 0.50) : 'neutral'}
          error={snap?.proactivityError}
        >
          {snap?.proactivity && (
            <>
              <Headline
                value={completionRate != null ? formatPercent(completionRate, 1) : '—'}
                sub={`${fmtNum(snap.proactivity.runsCompletedInWindow)} of ${fmtNum(snap.proactivity.runsInWindow)} runs completed`}
              />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-txt-muted">
                <span>{snap.proactivity.enabledSchedules} schedules active</span>
                <span>{snap.proactivity.disabledSchedules} disabled</span>
              </div>
              {snap.proactivity.topTasks.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {snap.proactivity.topTasks.slice(0, 5).map((t) => {
                    const pct = snap.proactivity!.runsInWindow > 0
                      ? (t.runs / snap.proactivity!.runsInWindow) * 100
                      : 0;
                    return (
                      <div key={t.task} className="flex items-center gap-2 text-[11px]">
                        <div className="h-1.5 rounded-full bg-prism-teal/40" style={{ width: `${Math.max(pct, 2)}%` }} />
                        <span className="text-txt-muted whitespace-nowrap">{t.task ?? '(null)'}</span>
                        <span className="text-txt-secondary ml-auto">{fmtNum(t.runs)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </KpiCard>

        {/* ── 2. Commitments ── */}
        <KpiCard
          title="Commitment Approval Rate"
          health={snap?.commitments?.pendingApprovalNow ? 'yellow' : approvalRate != null ? rateHealth(approvalRate, 0.80, 0.50) : 'neutral'}
          error={snap?.commitmentsError}
        >
          {snap?.commitments && (
            <>
              <Headline
                value={approvalRate != null ? formatPercent(approvalRate, 1) : '—'}
                sub={`${fmtNum(commitApproved)} approved of ${fmtNum(commitTotal)} total`}
              />
              {snap.commitments.pendingApprovalNow > 0 && (
                <p className="mt-1 text-[12px] font-medium text-amber-400">
                  {snap.commitments.pendingApprovalNow} pending approval now
                </p>
              )}
              {snap.commitments.pendingApprovalNow === 0 && (
                <p className="mt-1 text-[11px] text-txt-muted">No items awaiting approval</p>
              )}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-txt-muted">
                {snap.commitments.byStatusInWindow.map((s) => (
                  <span key={s.status}>{s.status}: {fmtNum(s.count)}</span>
                ))}
              </div>
            </>
          )}
        </KpiCard>

        {/* ── 3. Circuit Breaker ── */}
        <KpiCard
          title="Circuit Breaker"
          health={snap?.circuitBreaker?.haltActive ? 'red' : 'green'}
          error={snap?.circuitBreakerError}
        >
          {snap?.circuitBreaker && (
            <>
              <Headline
                value={snap.circuitBreaker.haltActive ? 'HALTED' : 'CLEAR'}
                sub={snap.circuitBreaker.haltActive ? `Level ${snap.circuitBreaker.haltLevel ?? '?'}` : 'Fleet operating normally'}
              />
              {snap.circuitBreaker.haltActive && snap.circuitBreaker.haltReason && (
                <p className="mt-1 text-[12px] text-red-400">{snap.circuitBreaker.haltReason}</p>
              )}
              {snap.circuitBreaker.haltActive && snap.circuitBreaker.triggeredBy && (
                <p className="mt-1 text-[11px] text-txt-muted">
                  By {snap.circuitBreaker.triggeredBy} · {snap.circuitBreaker.triggeredAt ? formatDateTime(snap.circuitBreaker.triggeredAt) : '—'}
                </p>
              )}
            </>
          )}
        </KpiCard>

        {/* ── 4. Audit Trail Density ── */}
        <KpiCard
          title="Audit Trail Density"
          health={eventsPerRun != null ? (eventsPerRun >= 5 ? 'green' : eventsPerRun >= 2 ? 'yellow' : 'red') : 'neutral'}
          error={snap?.auditTrailError}
        >
          {snap?.auditTrail && (
            <>
              <Headline
                value={eventsPerRun != null ? eventsPerRun.toFixed(1) : '—'}
                unit="events / run"
                sub={`${fmtNum(snap.auditTrail.agentRunEventsInWindow)} events across ${fmtNum(snap.auditTrail.runsInWindow)} runs`}
              />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-txt-muted">
                <span>Plan coverage: {planCoverage != null ? formatPercent(planCoverage, 1) : '—'}</span>
                <span>Decision traces: {snap.auditTrail.decisionTracesInWindow != null ? fmtNum(snap.auditTrail.decisionTracesInWindow) : '—'}</span>
              </div>
            </>
          )}
        </KpiCard>

        {/* ── 5. Knowledge Freshness ── */}
        <KpiCard
          title="Knowledge Freshness"
          health={knowledgeAgeDays != null ? (knowledgeAgeDays <= 7 ? 'green' : knowledgeAgeDays <= 30 ? 'yellow' : 'red') : 'neutral'}
          error={snap?.knowledgeError}
        >
          {snap?.knowledge && (
            <>
              <Headline
                value={knowledgeAgeDays != null ? (knowledgeAgeDays === 0 ? 'Today' : `${knowledgeAgeDays}d`) : '—'}
                unit={knowledgeAgeDays != null && knowledgeAgeDays > 0 ? 'ago' : undefined}
                sub="Since last world model update"
              />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-txt-muted">
                <span>Oldest entry: {snap.knowledge.worldModelOldestUpdateAt ? formatDateTime(snap.knowledge.worldModelOldestUpdateAt) : '—'}</span>
                <span>Contradictions: {snap.knowledge.unresolvedContradictions ?? 0} unresolved</span>
              </div>
            </>
          )}
        </KpiCard>

        {/* ── 6. Handoff Contracts ── */}
        <KpiCard
          title="Handoff Completion"
          health={
            snap?.handoffs?.escalatedInWindow
              ? 'yellow'
              : handoffCompletionRate != null
                ? rateHealth(handoffCompletionRate, 0.70, 0.40)
                : 'neutral'
          }
          error={snap?.handoffsError}
        >
          {snap?.handoffs && (
            <>
              <Headline
                value={handoffTotal > 0 ? (handoffCompletionRate != null ? formatPercent(handoffCompletionRate, 1) : '—') : '0'}
                unit={handoffTotal === 0 ? 'handoffs' : undefined}
                sub={handoffTotal > 0 ? `${fmtNum(handoffCompleted)} completed of ${fmtNum(handoffTotal)}` : 'No handoffs in window'}
              />
              {snap.handoffs.escalatedInWindow > 0 && (
                <p className="mt-1 text-[12px] font-medium text-amber-400">
                  {snap.handoffs.escalatedInWindow} escalated
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-txt-muted">
                {snap.handoffs.byStatusInWindow.map((s) => (
                  <span key={s.status}>{s.status}: {fmtNum(s.count)}</span>
                ))}
              </div>
            </>
          )}
        </KpiCard>

        {/* ── 7. Coordination ── */}
        <KpiCard
          title="Coordination Efficiency"
          health={snap?.coordination ? (snap.coordination.workAssignmentsInWindow > 0 ? 'green' : 'yellow') : 'neutral'}
          error={snap?.coordinationError}
        >
          {snap?.coordination && (
            <>
              <Headline
                value={fmtNum(snap.coordination.chiefOfStaffRunsInWindow)}
                unit="CoS runs"
                sub={`Produced ${fmtNum(snap.coordination.workAssignmentsInWindow)} work assignments`}
              />
              {snap.coordination.chiefOfStaffRunsInWindow > 0 && (
                <p className="mt-2 text-[11px] text-txt-muted">
                  Yield: {(snap.coordination.workAssignmentsInWindow / snap.coordination.chiefOfStaffRunsInWindow * 100).toFixed(1)}% of runs produce assignments
                </p>
              )}
            </>
          )}
        </KpiCard>

        {/* ── 8. Completion Gate Pass Rate ── */}
        <KpiCard
          title="Completion Gate Pass Rate"
          health={gatePassRate != null ? rateHealth(gatePassRate, 0.70, 0.40) : 'neutral'}
          error={snap?.resilienceError}
        >
          {snap?.resilience && (
            <>
              <Headline
                value={gatePassRate != null ? formatPercent(gatePassRate, 1) : (gateTotal === 0 ? '—' : '0%')}
                sub={gateTotal > 0
                  ? `${snap.resilience.completionGatePassedEventsInWindow} passed · ${snap.resilience.completionGateFailedEventsInWindow} failed`
                  : 'No gate events yet — gates are ramping up'}
              />
              {snap.resilience.completionGateAutoRepairTriggersInWindow > 0 && (
                <p className="mt-1 text-[12px] text-prism-teal">
                  {snap.resilience.completionGateAutoRepairTriggersInWindow} auto-repair triggers
                </p>
              )}
              {snap.resilience.completionGateAutoRepairTriggersInWindow === 0 && gateTotal > 0 && (
                <p className="mt-1 text-[11px] text-txt-muted">No auto-repairs triggered</p>
              )}
            </>
          )}
        </KpiCard>

        {/* ── 9. Golden Eval ── */}
        <KpiCard
          title="Golden Eval Pass Rate"
          health={goldenRate != null ? rateHealth(goldenRate, 0.70, 0.50) : 'neutral'}
          error={snap?.goldenEvalError}
        >
          {snap?.goldenEval && (
            <>
              <Headline
                value={goldenRate != null ? formatPercent(goldenRate, 1) : '—'}
                sub={`${fmtNum(snap.goldenEval.passed)} passed of ${fmtNum(snap.goldenEval.total)} evaluations`}
              />
              {snap.goldenEval.byRole.length > 0 && (
                <div className="mt-2 space-y-0.5 max-h-28 overflow-y-auto">
                  {snap.goldenEval.byRole
                    .sort((a, b) => a.passRate - b.passRate)
                    .map((r) => {
                      const h = rateHealth(r.passRate, 0.70, 0.50);
                      return (
                        <div key={r.agentRole} className="flex items-center gap-2 text-[11px]">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${healthColors[h]}`} />
                          <span className="text-txt-muted truncate">{r.agentRole}</span>
                          <span className="text-txt-secondary ml-auto tabular-nums">{formatPercent(r.passRate, 0)}</span>
                        </div>
                      );
                    })}
                </div>
              )}
            </>
          )}
        </KpiCard>
      </div>
    </div>
  );
}
