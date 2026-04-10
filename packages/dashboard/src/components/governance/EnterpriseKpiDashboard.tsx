import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Card, SectionHeader, Skeleton } from '../ui';
import { apiCall } from '../../lib/firebase';
import { EmptyState, formatDateTime, formatPercent } from './shared';

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

function KpiCard({
  title,
  subtitle,
  children,
  error,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  error?: string;
}) {
  return (
    <Card className="theme-glass-panel-soft p-4">
      <SectionHeader title={title} subtitle={error ? `Error: ${error}` : subtitle} />
      <div className="mt-3 text-sm text-txt-secondary">{error ? <span className="text-prism-critical">{error}</span> : children}</div>
    </Card>
  );
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
        <SectionHeader
          title="Enterprise KPI snapshot"
          subtitle="Loading aggregates from the same sources as db/scripts/governance_enterprise_kpi_queries.sql…"
        />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <EmptyState
        title="Could not load enterprise KPI snapshot"
        description={`${fetchError} Deploy scheduler with /admin/metrics/enterprise-kpi-snapshot and ensure admin API routing reaches the scheduler.`}
      />
    );
  }

  const snap = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeader
          title="Enterprise KPI snapshot"
          subtitle="Operational checklist metrics (schedules, commitments, kill switch, audit volume, knowledge, handoffs, golden eval). Ad-hoc SQL lives in db/scripts/governance_enterprise_kpi_queries.sql."
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
        <KpiCard
          title="1 · Proactivity (schedules & runs)"
          subtitle="Cron-enabled work vs run volume in window"
          error={snap?.proactivityError}
        >
          {snap?.proactivity && (
            <ul className="space-y-1 text-txt-primary">
              <li>Enabled schedules: {snap.proactivity.enabledSchedules}</li>
              <li>Disabled schedules: {snap.proactivity.disabledSchedules}</li>
              <li>Last schedule trigger: {snap.proactivity.lastScheduleTriggerAt ? formatDateTime(snap.proactivity.lastScheduleTriggerAt) : '—'}</li>
              <li>Runs in window: {snap.proactivity.runsInWindow} (completed {snap.proactivity.runsCompletedInWindow})</li>
              <li className="pt-1 text-[11px] text-txt-muted">Top tasks: {snap.proactivity.topTasks.map((t) => `${t.task ?? '(null)'}:${t.runs}`).join(' · ') || '—'}</li>
            </ul>
          )}
        </KpiCard>

        <KpiCard
          title="2 · Commitments & approvals"
          subtitle="Registry + pending now"
          error={snap?.commitmentsError}
        >
          {snap?.commitments && (
            <ul className="space-y-1 text-txt-primary">
              <li>Pending approval (now): {snap.commitments.pendingApprovalNow}</li>
              <li className="text-[11px] text-txt-muted">
                In window: {snap.commitments.byStatusInWindow.map((s) => `${s.status}:${s.count}`).join(', ') || '—'}
              </li>
            </ul>
          )}
        </KpiCard>

        <KpiCard
          title="3 · Circuit breaker (kill switch)"
          subtitle="Fleet halt from system_config"
          error={snap?.circuitBreakerError}
        >
          {snap?.circuitBreaker && (
            <ul className="space-y-1 text-txt-primary">
              <li>Halted: {snap.circuitBreaker.haltActive ? 'yes' : 'no'}</li>
              <li>Level: {snap.circuitBreaker.haltLevel ?? '—'}</li>
              <li>Reason: {snap.circuitBreaker.haltReason ?? '—'}</li>
              <li>By: {snap.circuitBreaker.triggeredBy ?? '—'}</li>
              <li>At: {snap.circuitBreaker.triggeredAt ? formatDateTime(snap.circuitBreaker.triggeredAt) : '—'}</li>
            </ul>
          )}
        </KpiCard>

        <KpiCard
          title="4 · Audit trail density"
          subtitle="Events, runs, plan manifests, decision traces"
          error={snap?.auditTrailError}
        >
          {snap?.auditTrail && (
            <ul className="space-y-1 text-txt-primary">
              <li>agent_run_events (window): {snap.auditTrail.agentRunEventsInWindow}</li>
              <li>agent_runs (window): {snap.auditTrail.runsInWindow}</li>
              <li>Runs with plan_manifest: {snap.auditTrail.runsWithPlanManifest}</li>
              <li>decision_traces (window): {snap.auditTrail.decisionTracesInWindow ?? '—'}</li>
            </ul>
          )}
        </KpiCard>

        <KpiCard title="5 · Workspace identity" subtitle="M365 / Teams / IAM">
          <p className="text-[12px] leading-relaxed text-txt-muted">
            Not summarized in this API. Use your Microsoft write audit view, Graph delivery logs, and{' '}
            <code className="text-txt-secondary">activity_log</code> for send-as and tool identity checks.
          </p>
        </KpiCard>

        <KpiCard
          title="6 · Temporal / knowledge"
          subtitle="World model freshness & contradictions"
          error={snap?.knowledgeError}
        >
          {snap?.knowledge && (
            <ul className="space-y-1 text-txt-primary">
              <li>World model oldest update: {snap.knowledge.worldModelOldestUpdateAt ? formatDateTime(snap.knowledge.worldModelOldestUpdateAt) : '—'}</li>
              <li>World model newest: {snap.knowledge.worldModelNewestUpdateAt ? formatDateTime(snap.knowledge.worldModelNewestUpdateAt) : '—'}</li>
              <li>Unresolved contradictions (detected): {snap.knowledge.unresolvedContradictions ?? '—'}</li>
              <li className="text-[11px] text-txt-muted">
                By status: {snap.knowledge.contradictionsByStatus?.map((c) => `${c.status}:${c.count}`).join(', ') ?? '—'}
              </li>
            </ul>
          )}
        </KpiCard>

        <KpiCard
          title="7 · Handoff contracts"
          subtitle="Structured handoffs in window"
          error={snap?.handoffsError}
        >
          {snap?.handoffs && (
            <ul className="space-y-1 text-txt-primary">
              <li>Escalated in window: {snap.handoffs.escalatedInWindow}</li>
              <li className="text-[11px] text-txt-muted">
                {snap.handoffs.byStatusInWindow.map((s) => `${s.status}:${s.count}`).join(', ') || '—'}
              </li>
            </ul>
          )}
        </KpiCard>

        <KpiCard
          title="8 · Coordination"
          subtitle="Chief of Staff runs & directive assignments"
          error={snap?.coordinationError}
        >
          {snap?.coordination && (
            <ul className="space-y-1 text-txt-primary">
              <li>chief-of-staff runs (window): {snap.coordination.chiefOfStaffRunsInWindow}</li>
              <li>work_assignments created (window): {snap.coordination.workAssignmentsInWindow}</li>
            </ul>
          )}
        </KpiCard>

        <KpiCard
          title="9 · Resilience (completion gate events)"
          subtitle="Auto-repair triggers vs pass/fail events"
          error={snap?.resilienceError}
        >
          {snap?.resilience && (
            <ul className="space-y-1 text-txt-primary">
              <li>Auto-repair triggered: {snap.resilience.completionGateAutoRepairTriggersInWindow}</li>
              <li>Gate failed events: {snap.resilience.completionGateFailedEventsInWindow}</li>
              <li>Gate passed events: {snap.resilience.completionGatePassedEventsInWindow}</li>
            </ul>
          )}
        </KpiCard>

        <KpiCard
          title="10 · Golden eval (golden:%)"
          subtitle="Fleet pass rate + per role"
          error={snap?.goldenEvalError}
        >
          {snap?.goldenEval && (
            <div>
              <p className="text-txt-primary">
                Fleet: {snap.goldenEval.passed}/{snap.goldenEval.total}
                {snap.goldenEval.passRate != null ? ` (${formatPercent(snap.goldenEval.passRate, 1)})` : ''}
              </p>
              <ul className="mt-2 max-h-32 overflow-y-auto text-[11px] text-txt-muted">
                {snap.goldenEval.byRole.map((r) => (
                  <li key={r.agentRole}>
                    {r.agentRole}: {r.passed}/{r.total} ({formatPercent(r.passRate, 1)})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </KpiCard>
      </div>
    </div>
  );
}
