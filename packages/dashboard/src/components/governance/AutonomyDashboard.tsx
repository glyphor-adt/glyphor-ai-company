import { useEffect, useMemo, useState } from 'react';
import { ButtonOutlineSecondary, Card, GradientButton, SectionHeader, Skeleton, Sparkline } from '../ui';
import { apiCall } from '../../lib/firebase';
import type {
  AutonomyAgentDetail,
  AutonomyCohortBenchmark,
  AutonomyOverviewItem,
  Severity,
} from './shared';
import {
  EmptyState,
  SeverityBadge,
  formatDateTime,
  formatMetricValue,
  formatPercent,
  getDisplayName,
  toHumanWords,
} from './shared';

type SortMode = 'level_desc' | 'trajectory_desc' | 'trust_desc' | 'composite_desc' | 'risk_desc' | 'name_asc';

interface AutonomyDashboardProps {
  isAdmin: boolean;
  currentUserEmail: string | null;
}

function severityForAgent(item: AutonomyOverviewItem): Severity {
  if (item.currentLevel < item.suggestedLevel) return 'good';
  if (item.currentLevel > item.suggestedLevel) return 'warning';
  if (item.metrics.slaBreachRate >= 0.1 || item.metrics.contradictionRate >= 0.1) return 'high';
  return 'info';
}

function sortItems(items: AutonomyOverviewItem[], sortMode: SortMode): AutonomyOverviewItem[] {
  const next = [...items];
  next.sort((left, right) => {
    if (sortMode === 'level_desc') {
      return right.currentLevel - left.currentLevel || right.metrics.currentTrustScore - left.metrics.currentTrustScore;
    }
    if (sortMode === 'trajectory_desc') {
      return right.metrics.trustTrend30d - left.metrics.trustTrend30d || right.metrics.currentTrustScore - left.metrics.currentTrustScore;
    }
    if (sortMode === 'trust_desc') {
      return right.metrics.currentTrustScore - left.metrics.currentTrustScore;
    }
    if (sortMode === 'composite_desc') {
      return right.metrics.autonomyCompositeScore - left.metrics.autonomyCompositeScore
        || right.metrics.currentTrustScore - left.metrics.currentTrustScore;
    }
    if (sortMode === 'risk_desc') {
      const leftRisk = left.metrics.escalationRate + left.metrics.contradictionRate + left.metrics.slaBreachRate;
      const rightRisk = right.metrics.escalationRate + right.metrics.contradictionRate + right.metrics.slaBreachRate;
      return rightRisk - leftRisk;
    }
    return left.displayName.localeCompare(right.displayName);
  });
  return next;
}

function gateGoldenLabel(metrics: AutonomyOverviewItem['metrics']): string {
  const gateOk = metrics.gatePassDenominator30d > 0;
  const goldenOk = metrics.goldenEvalCount30d > 0;
  const gate = gateOk ? formatPercent(metrics.gatePassRate30d, 1) : '—';
  const golden = goldenOk ? formatPercent(metrics.goldenEvalPassRate30d, 1) : '—';
  return `Gate ${gate} · Golden ${golden}`;
}

function metricTone(value: number, inverse = false): string {
  if (inverse) {
    if (value <= 0.03) return 'text-emerald-300';
    if (value <= 0.08) return 'text-amber-300';
    return 'text-rose-300';
  }
  if (value >= 0.95) return 'text-emerald-300';
  if (value >= 0.85) return 'text-amber-300';
  return 'text-rose-300';
}

export default function AutonomyDashboard({ isAdmin, currentUserEmail }: AutonomyDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [overview, setOverview] = useState<AutonomyOverviewItem[]>([]);
  const [benchmarks, setBenchmarks] = useState<AutonomyCohortBenchmark[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [detail, setDetail] = useState<AutonomyAgentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [sortMode, setSortMode] = useState<SortMode>('level_desc');
  const [configDraft, setConfigDraft] = useState({
    maxAllowedLevel: 0,
    autoPromote: true,
    autoDemote: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadOverview() {
      setLoading(true);
      try {
        const [overviewRaw, benchmarksRaw] = await Promise.all([
          apiCall<AutonomyOverviewItem[]>('/admin/autonomy'),
          apiCall<AutonomyCohortBenchmark[]>('/admin/autonomy/cohort-benchmarks'),
        ]);
        if (cancelled) return;
        setOverview(Array.isArray(overviewRaw) ? overviewRaw : []);
        setBenchmarks(Array.isArray(benchmarksRaw) ? benchmarksRaw : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadOverview();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  useEffect(() => {
    const handle = window.setInterval(() => setRefreshTick((value) => value + 1), 60_000);
    return () => window.clearInterval(handle);
  }, []);

  const departments = useMemo(() => {
    const values = Array.from(new Set(overview.map((item) => item.department || 'Other'))).sort((left, right) => left.localeCompare(right));
    return ['All', ...values];
  }, [overview]);

  const filteredItems = useMemo(() => {
    const items = departmentFilter === 'All'
      ? overview
      : overview.filter((item) => (item.department || 'Other') === departmentFilter);
    return sortItems(items, sortMode);
  }, [departmentFilter, overview, sortMode]);

  useEffect(() => {
    if (!filteredItems.length) {
      setSelectedAgentId('');
      return;
    }

    if (selectedAgentId && filteredItems.some((item) => item.agentId === selectedAgentId)) {
      return;
    }

    setSelectedAgentId(filteredItems[0].agentId);
  }, [filteredItems, selectedAgentId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedAgentId) {
      setDetail(null);
      return;
    }

    async function loadDetail() {
      setDetailLoading(true);
      try {
        const response = await apiCall<AutonomyAgentDetail>(`/admin/autonomy/${encodeURIComponent(selectedAgentId)}`);
        if (cancelled) return;
        setDetail(response ?? null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    }

    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedAgentId, refreshTick]);

  useEffect(() => {
    if (!detail) return;
    setConfigDraft({
      maxAllowedLevel: detail.config.maxAllowedLevel,
      autoPromote: detail.config.autoPromote,
      autoDemote: detail.config.autoDemote,
    });
  }, [detail]);

  async function refreshAll() {
    setRefreshTick((value) => value + 1);
  }

  async function saveConfig() {
    if (!detail) return;
    setSaving(true);
    try {
      await apiCall(`/admin/autonomy/${encodeURIComponent(detail.agent.role)}`, {
        method: 'PUT',
        body: JSON.stringify({
          maxAllowedLevel: configDraft.maxAllowedLevel,
          autoPromote: configDraft.autoPromote,
          autoDemote: configDraft.autoDemote,
          updatedBy: currentUserEmail ?? 'dashboard',
          reason: 'Updated from autonomy dashboard',
        }),
      });
      await refreshAll();
    } finally {
      setSaving(false);
    }
  }

  async function shiftLevel(direction: 'promote' | 'demote') {
    if (!detail) return;
    setSaving(true);
    try {
      await apiCall(`/admin/autonomy/${encodeURIComponent(detail.agent.role)}/${direction}`, {
        method: 'POST',
        body: JSON.stringify({
          changedBy: currentUserEmail ?? 'dashboard',
          reason: `Manual ${direction} from autonomy dashboard`,
        }),
      });
      await refreshAll();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-36 w-full" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <Skeleton className="h-[480px] w-full" />
          <Skeleton className="h-[480px] w-full" />
        </div>
      </div>
    );
  }

  if (!overview.length) {
    return (
      <EmptyState
        title="No autonomy profiles available"
        description="Autonomy scores will appear here once agents have trust history and autonomy config records."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeader
            title="Autonomy Framework"
            subtitle="Map every agent's 30-day TrustScorer trajectory to a configurable five-level operating model, with admin ceilings and daily adjustment automation."
          />

          <div className="flex flex-wrap gap-3">
            <label className="text-[12px] text-txt-muted">
              <span className="mb-2 block font-medium text-txt-secondary">Department</span>
              <select
                value={departmentFilter}
                onChange={(event) => setDepartmentFilter(event.target.value)}
                className="rounded-xl border border-border bg-transparent px-3 py-2 text-[13px] text-txt-primary outline-none transition-colors focus:border-prism-sky/50"
              >
                {departments.map((department) => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
            </label>

            <label className="text-[12px] text-txt-muted">
              <span className="mb-2 block font-medium text-txt-secondary">Sort</span>
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="rounded-xl border border-border bg-transparent px-3 py-2 text-[13px] text-txt-primary outline-none transition-colors focus:border-prism-sky/50"
              >
                <option value="level_desc">Highest level</option>
                <option value="trajectory_desc">Fastest trajectory</option>
                <option value="trust_desc">Highest trust</option>
                <option value="risk_desc">Highest risk</option>
                <option value="name_asc">Name</option>
              </select>
            </label>

            <ButtonOutlineSecondary onClick={() => refreshAll()} className="self-end">Refresh</ButtonOutlineSecondary>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {benchmarks.slice(0, 4).map((benchmark) => (
          <Card key={benchmark.roleCategory} className="bg-prism-sky/5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-txt-muted">{benchmark.roleCategory}</p>
            <p className="mt-2 text-2xl font-semibold text-txt-primary">Level {formatMetricValue(benchmark.averageLevel)}</p>
            <p className="mt-2 text-[12px] text-txt-muted">
              Avg days to L3: {benchmark.averageDaysToLevel3 == null ? '—' : formatMetricValue(benchmark.averageDaysToLevel3)}
            </p>
            <p className="mt-1 text-[12px] text-txt-muted">
              Avg days to L4: {benchmark.averageDaysToLevel4 == null ? '—' : formatMetricValue(benchmark.averageDaysToLevel4)}
            </p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {filteredItems.map((item) => {
              const selected = item.agentId === selectedAgentId;
              const severity = severityForAgent(item);
              return (
                <button
                  key={item.agentId}
                  type="button"
                  onClick={() => setSelectedAgentId(item.agentId)}
                  className="text-left"
                >
                  <Card className={selected ? 'border-prism-sky/60 bg-prism-sky/10' : ''} interactive>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-txt-primary">{item.displayName || getDisplayName(item.role)}</p>
                          <SeverityBadge severity={severity} />
                        </div>
                        <p className="mt-1 text-[12px] text-txt-muted">{item.title ?? toHumanWords(item.role)} · {item.department ?? 'Other'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">Autonomy</p>
                        <p className="text-xl font-semibold text-txt-primary">L{item.currentLevel}</p>
                      </div>
                    </div>

                    <div className="mt-3 text-[11px] text-txt-muted">
                      <span className="font-semibold text-txt-secondary">Composite </span>
                      {formatPercent(item.metrics.autonomyCompositeScore, 1)}
                      <span className="mx-2 text-border">·</span>
                      {gateGoldenLabel(item.metrics)}
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">Trust trajectory</p>
                        <div className="mt-2 flex items-center gap-3">
                          <Sparkline data={item.metrics.sparkline30d} color={selected ? '#38BDF8' : '#10B981'} width={96} height={28} />
                          <span className={`text-xs font-semibold ${item.metrics.trustTrend30d >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                            {item.metrics.trustTrend30d >= 0 ? '+' : ''}{item.metrics.trustTrend30d.toFixed(2)} / 30d
                          </span>
                        </div>
                      </div>
                      <div className="text-right text-[12px] text-txt-muted">
                        <p>Trust {formatPercent(item.metrics.currentTrustScore, 1)}</p>
                        <p>Ceiling L{item.maxAllowedLevel}</p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl theme-glass-panel p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">Completion</p>
                        <p className={`mt-1 text-sm font-semibold ${metricTone(item.metrics.avgCompletionRate)}`}>{formatPercent(item.metrics.avgCompletionRate, 1)}</p>
                      </div>
                      <div className="rounded-xl theme-glass-panel p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">Escalation</p>
                        <p className={`mt-1 text-sm font-semibold ${metricTone(item.metrics.escalationRate, true)}`}>{formatPercent(item.metrics.escalationRate, 1)}</p>
                      </div>
                    </div>
                  </Card>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          {detailLoading ? (
            <Skeleton className="h-[720px] w-full" />
          ) : !detail ? (
            <EmptyState title="Select an agent" description="Choose an autonomy card to inspect thresholds, history, and controls." />
          ) : (
            <div className="space-y-4">
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-txt-primary">{detail.agent.displayName}</p>
                    <p className="mt-1 text-[12px] text-txt-muted">{detail.agent.title ?? toHumanWords(detail.agent.role)} · {detail.agent.department ?? 'Other'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">Level</p>
                    <p className="text-2xl font-semibold text-txt-primary">L{detail.config.currentLevel}</p>
                    <p className="text-[12px] text-txt-muted">Suggested L{detail.evaluation.suggestedLevel}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl theme-glass-panel p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">Current trust</p>
                    <p className="mt-2 text-xl font-semibold text-txt-primary">{formatPercent(detail.evaluation.metrics.currentTrustScore, 1)}</p>
                    <div className="mt-3">
                      <Sparkline data={detail.evaluation.metrics.sparkline30d} color="#38BDF8" width={180} height={44} />
                    </div>
                  </div>
                  <div className="rounded-xl theme-glass-panel p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">Last change</p>
                    <p className="mt-2 text-sm font-semibold text-txt-primary">{formatDateTime(detail.config.lastLevelChangeAt)}</p>
                    <p className="mt-1 text-[12px] text-txt-muted">{detail.config.lastLevelChangeReason ?? 'No recorded reason'}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-xl theme-glass-panel p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">Composite quality</p>
                    <p className={`mt-1 text-sm font-semibold ${metricTone(detail.evaluation.metrics.autonomyCompositeScore)}`}>{formatPercent(detail.evaluation.metrics.autonomyCompositeScore, 1)}</p>
                    <p className="mt-1 text-[11px] text-txt-muted">Trust + gate + golden (when enough samples)</p>
                  </div>
                  <div className="rounded-xl theme-glass-panel p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">Gate pass (30d)</p>
                    <p className={`mt-1 text-sm font-semibold ${detail.evaluation.metrics.gatePassDenominator30d > 0 ? metricTone(detail.evaluation.metrics.gatePassRate30d) : 'text-txt-muted'}`}>
                      {detail.evaluation.metrics.gatePassDenominator30d > 0
                        ? formatPercent(detail.evaluation.metrics.gatePassRate30d, 1)
                        : '—'}
                    </p>
                    <p className="mt-1 text-[11px] text-txt-muted">
                      n={detail.evaluation.metrics.gatePassDenominator30d} runs (30d, gate denominator)
                    </p>
                  </div>
                  <div className="rounded-xl theme-glass-panel p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">Golden eval (30d)</p>
                    <p className={`mt-1 text-sm font-semibold ${detail.evaluation.metrics.goldenEvalCount30d > 0 ? metricTone(detail.evaluation.metrics.goldenEvalPassRate30d) : 'text-txt-muted'}`}>
                      {detail.evaluation.metrics.goldenEvalCount30d > 0
                        ? formatPercent(detail.evaluation.metrics.goldenEvalPassRate30d, 1)
                        : '—'}
                    </p>
                    <p className="mt-1 text-[11px] text-txt-muted">n={detail.evaluation.metrics.goldenEvalCount30d} results</p>
                  </div>
                  <div className="rounded-xl theme-glass-panel p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">Completion</p>
                    <p className={`mt-1 text-sm font-semibold ${metricTone(detail.evaluation.metrics.avgCompletionRate)}`}>{formatPercent(detail.evaluation.metrics.avgCompletionRate, 1)}</p>
                  </div>
                  <div className="rounded-xl theme-glass-panel p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">Confidence</p>
                    <p className={`mt-1 text-sm font-semibold ${metricTone(detail.evaluation.metrics.avgConfidenceScore)}`}>{formatPercent(detail.evaluation.metrics.avgConfidenceScore, 1)}</p>
                  </div>
                  <div className="rounded-xl theme-glass-panel p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">SLA breach</p>
                    <p className={`mt-1 text-sm font-semibold ${metricTone(detail.evaluation.metrics.slaBreachRate, true)}`}>{formatPercent(detail.evaluation.metrics.slaBreachRate, 1)}</p>
                  </div>
                </div>

                {isAdmin && (
                  <div className="mt-5 space-y-4 border-t border-border/70 pt-4">
                    <p className="text-sm font-semibold text-txt-primary">Admin controls</p>

                    <div className="grid gap-4 md:grid-cols-3">
                      <label className="text-[12px] text-txt-muted">
                        <span className="mb-2 block font-medium text-txt-secondary">Max allowed level</span>
                        <select
                          value={configDraft.maxAllowedLevel}
                          onChange={(event) => setConfigDraft((current) => ({ ...current, maxAllowedLevel: Number(event.target.value) }))}
                          className="w-full rounded-xl border border-border bg-transparent px-3 py-2 text-[13px] text-txt-primary outline-none transition-colors focus:border-prism-sky/50"
                        >
                          {[0, 1, 2, 3, 4].map((level) => <option key={level} value={level}>Level {level}</option>)}
                        </select>
                      </label>

                      <label className="flex items-center gap-3 rounded-xl theme-glass-panel p-3 text-[12px] text-txt-secondary">
                        <input
                          type="checkbox"
                          checked={configDraft.autoPromote}
                          onChange={(event) => setConfigDraft((current) => ({ ...current, autoPromote: event.target.checked }))}
                        />
                        Auto-promote
                      </label>

                      <label className="flex items-center gap-3 rounded-xl theme-glass-panel p-3 text-[12px] text-txt-secondary">
                        <input
                          type="checkbox"
                          checked={configDraft.autoDemote}
                          onChange={(event) => setConfigDraft((current) => ({ ...current, autoDemote: event.target.checked }))}
                        />
                        Auto-demote
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <GradientButton onClick={() => saveConfig()} disabled={saving} variant="primary" size="sm" className="disabled:opacity-50">
                        {saving ? 'Saving…' : 'Save controls'}
                      </GradientButton>
                      <ButtonOutlineSecondary onClick={() => shiftLevel('promote')} disabled={saving || detail.config.currentLevel >= detail.config.maxAllowedLevel} size="sm" className="disabled:opacity-50">
                        Promote
                      </ButtonOutlineSecondary>
                      <ButtonOutlineSecondary onClick={() => shiftLevel('demote')} disabled={saving || detail.config.currentLevel <= 0} size="sm" className="disabled:opacity-50">
                        Demote
                      </ButtonOutlineSecondary>
                    </div>
                  </div>
                )}
              </Card>

              <Card>
                <SectionHeader title="Threshold fit" subtitle="Each level is evaluated against configurable database thresholds over the last 30 days." />
                <div className="space-y-3">
                  {detail.evaluation.thresholdProgress.map((threshold) => (
                    <div key={threshold.level} className="rounded-xl theme-glass-panel p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-txt-primary">Level {threshold.level}: {threshold.label}</p>
                          <p className="mt-1 text-[12px] text-txt-muted">{detail.levels.find((level) => level.level === threshold.level)?.description ?? 'No description'}</p>
                        </div>
                        <SeverityBadge severity={threshold.met ? 'good' : 'warning'} />
                      </div>
                      <div className="mt-3 space-y-2">
                        {threshold.requirements.length === 0 ? (
                          <p className="text-[12px] text-txt-muted">Baseline level with no gating threshold.</p>
                        ) : threshold.requirements.map((requirement) => (
                          <div key={requirement.key}>
                            <div className="flex items-center justify-between gap-3 text-[12px] text-txt-secondary">
                              <span>{requirement.label}</span>
                              <span>
                                {formatMetricValue(requirement.actual)} {requirement.operator} {formatMetricValue(requirement.target)}
                              </span>
                            </div>
                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
                              <div
                                className={`h-full rounded-full ${requirement.met ? 'bg-emerald-400' : 'bg-amber-400'}`}
                                style={{ width: `${Math.max(4, requirement.progress * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <SectionHeader title="History" subtitle="Promotion, demotion, and override events are logged for audit and client review." />
                <div className="space-y-3">
                  {detail.history.slice(0, 8).map((entry) => (
                    <div key={entry.id} className="rounded-xl theme-glass-panel p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-txt-primary">
                          L{entry.fromLevel} → L{entry.toLevel} · {toHumanWords(entry.changeType)}
                        </p>
                        <span className="text-[12px] text-txt-muted">{formatDateTime(entry.createdAt)}</span>
                      </div>
                      <p className="mt-2 text-[12px] text-txt-muted">{entry.reason ?? 'No reason recorded.'}</p>
                      <p className="mt-1 text-[12px] text-txt-muted">Changed by {entry.changedBy}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}