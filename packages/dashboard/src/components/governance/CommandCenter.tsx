import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, SectionHeader, Skeleton } from '../ui';
import {
  EmptyState,
  GovernanceAction,
  GovernanceChangeItem,
  GovernanceSurface,
  RiskSummaryItem,
  SeverityBadge,
  TrendPill,
  TrustMapEntry,
  average,
  formatDateTime,
  formatMetricValue,
  formatPercent,
  getDisplayName,
  getRoleTitle,
} from './shared';

interface CommandCenterProps {
  loading: boolean;
  riskSummary: RiskSummaryItem[];
  actionQueue: GovernanceAction[];
  changeLog: GovernanceChangeItem[];
  trustMap: TrustMapEntry[];
  onOpenSurface: (surface: GovernanceSurface) => void;
  onResolveDecision?: (id: string, approve: boolean) => Promise<void>;
  busyDecisionId?: string | null;
}

function labelForDay(value: string | null): string {
  if (!value) return 'Recent';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recent';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const bucket = new Date(date);
  bucket.setHours(0, 0, 0, 0);
  if (bucket.getTime() === today.getTime()) return 'Today';
  if (bucket.getTime() === yesterday.getTime()) return 'Yesterday';
  return bucket.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getActionTarget(
  actionLabel: string,
  item: GovernanceAction,
): { href?: string; surface?: GovernanceSurface; approve?: boolean } {
  const normalized = actionLabel.toLowerCase();
  if (normalized.includes('approve') && item.decisionId) return { approve: true };
  if (normalized.includes('reject') && item.decisionId) return { approve: false };
  if (normalized.includes('review agent') && item.agentRole) return { href: `/agents/${item.agentRole}` };
  if (normalized.includes('policy') || normalized.includes('amendment') || normalized.includes('revision')) {
    return { surface: 'access-control' };
  }
  if (
    normalized.includes('rotation')
    || normalized.includes('revoke')
    || normalized.includes('access')
    || normalized.includes('grant')
  ) {
    return { surface: 'access-control' };
  }
  if (normalized.includes('investigate') || normalized.includes('history')) {
    return { href: '/operations' };
  }
  return {};
}

function RiskSummaryStrip({ items }: { items: RiskSummaryItem[] }) {
  if (!items.length) {
    return (
      <EmptyState
        title="No governance risk indicators returned"
        description="The command center is connected to /api/governance/risk-summary; this view stays empty until the scheduler returns current risk data."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => item.anchor && document.getElementById(item.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="text-left"
        >
          <Card className="h-full border-border/70 hover:border-border-hover">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-txt-muted">{item.title}</p>
              <SeverityBadge severity={item.severity} />
            </div>
            <p className="mt-4 text-3xl font-semibold text-txt-primary">{formatMetricValue(item.value)}</p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-[12px] text-txt-muted">{item.subtitle ?? 'Awaiting backend detail'}</p>
              <TrendPill value={item.trend} />
            </div>
          </Card>
        </button>
      ))}
    </div>
  );
}

function ActionQueueSection({
  items,
  onOpenSurface,
  onResolveDecision,
  busyDecisionId,
}: {
  items: GovernanceAction[];
  onOpenSurface: (surface: GovernanceSurface) => void;
  onResolveDecision?: (id: string, approve: boolean) => Promise<void>;
  busyDecisionId?: string | null;
}) {
  return (
    <Card id="action-queue">
      <SectionHeader
        title="Action Queue"
        subtitle="A single founder queue across trust alerts, access risk, constitutional failures, and policy decisions."
      />
      {!items.length ? (
        <p className="text-[13px] text-txt-muted">No governance actions are currently queued.</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border border-border/70 bg-prism-card/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={item.severity} />
                    <p className="text-sm font-semibold text-txt-primary">{item.title}</p>
                  </div>
                  <p className="mt-2 text-[13px] text-txt-secondary">{item.summary}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-txt-muted">
                    {item.agentRole && <span>{getDisplayName(item.agentRole)} · {getRoleTitle(item.agentRole)}</span>}
                    {item.platform && <span>{item.platform.toUpperCase()}</span>}
                    <span>{formatDateTime(item.createdAt)}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.actionButtons.map((actionLabel) => {
                    const target = getActionTarget(actionLabel, item);
                    if (typeof target.approve === 'boolean' && item.decisionId && onResolveDecision) {
                      return (
                        <button
                          key={`${item.id}-${actionLabel}`}
                          type="button"
                          disabled={busyDecisionId === item.decisionId}
                          onClick={() => onResolveDecision(item.decisionId!, target.approve!)}
                          className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
                            target.approve
                              ? 'border border-prism-teal/30 bg-prism-teal/10 text-prism-teal hover:bg-prism-teal/20'
                              : 'border border-prism-critical/30 bg-prism-critical/10 text-prism-critical hover:bg-prism-critical/20'
                          } disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          {busyDecisionId === item.decisionId ? 'Saving…' : actionLabel}
                        </button>
                      );
                    }

                    if (target.href) {
                      return (
                        <Link
                          key={`${item.id}-${actionLabel}`}
                          to={target.href}
                          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-txt-secondary transition-colors hover:border-border-hover hover:text-txt-primary"
                        >
                          {actionLabel}
                        </Link>
                      );
                    }

                    if (target.surface) {
                      return (
                        <button
                          key={`${item.id}-${actionLabel}`}
                          type="button"
                          onClick={() => onOpenSurface(target.surface!)}
                          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-txt-secondary transition-colors hover:border-border-hover hover:text-txt-primary"
                        >
                          {actionLabel}
                        </button>
                      );
                    }

                    return (
                      <span
                        key={`${item.id}-${actionLabel}`}
                        className="rounded-lg border border-border/70 bg-prism-card px-3 py-1.5 text-[12px] font-medium text-txt-muted"
                      >
                        {actionLabel}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ChangeLogSection({ items }: { items: GovernanceChangeItem[] }) {
  const groups = useMemo(() => {
    const grouped = new Map<string, GovernanceChangeItem[]>();
    for (const item of items) {
      const key = labelForDay(item.createdAt);
      const list = grouped.get(key) ?? [];
      list.push(item);
      grouped.set(key, list);
    }
    return [...grouped.entries()];
  }, [items]);

  return (
    <Card id="change-log">
      <SectionHeader
        title="Change Log"
        subtitle="Governance-significant changes grouped by day, rather than raw platform telemetry."
      />
      {!items.length ? (
        <p className="text-[13px] text-txt-muted">No recent governance changes were returned.</p>
      ) : (
        <div className="space-y-5">
          {groups.map(([label, entries]) => (
            <div key={label}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-txt-muted">{label}</p>
              <div className="mt-3 space-y-3">
                {entries.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-border/60 bg-prism-card/50 px-4 py-3">
                    <p className="text-[13px] font-medium text-txt-primary">{entry.title}</p>
                    <p className="mt-1 text-[12px] text-txt-secondary">{entry.description}</p>
                    <p className="mt-2 text-[11px] text-txt-muted">{formatDateTime(entry.createdAt)}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SystemTrustMap({ entries }: { entries: TrustMapEntry[] }) {
  const groups = useMemo(() => {
    const byDept = new Map<string, TrustMapEntry[]>();
    for (const entry of entries) {
      const list = byDept.get(entry.department) ?? [];
      list.push(entry);
      byDept.set(entry.department, list);
    }
    return [...byDept.entries()]
      .map(([department, members]) => ({
        department,
        members: members.sort((left, right) => right.trustScore - left.trustScore),
        averageScore: average(members.map((member) => member.trustScore)) ?? 0,
      }))
      .sort((left, right) => right.averageScore - left.averageScore);
  }, [entries]);

  if (!entries.length) {
    return (
      <EmptyState
        title="No trust-map entries returned"
        description="This surface reads /api/governance/trust-map and will populate once the scheduler returns current agent trust scores."
      />
    );
  }

  return (
    <Card id="trust-map">
      <SectionHeader
        title="System Trust Map"
        subtitle="All agents grouped by department so founders can spot trust regressions without diving into a raw table."
      />
      <div className="space-y-4">
        {groups.map((group) => (
          <div key={group.department} className="rounded-xl border border-border/70 bg-prism-card/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-txt-primary">{group.department}</p>
                <p className="mt-1 text-[12px] text-txt-muted">Average trust {formatPercent(group.averageScore, 0)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.members.map((member) => {
                  const tone = member.trustScore < 0.4
                    ? 'bg-prism-critical'
                    : member.trustScore < 0.7
                      ? 'bg-prism-elevated'
                      : 'bg-prism-teal';
                  return (
                    <Link
                      key={`${group.department}-${member.agentRole}`}
                      to={`/agents/${member.agentRole}`}
                      className="group rounded-full border border-transparent px-1 py-1 transition-colors hover:border-border"
                      title={`${member.displayName} · ${formatPercent(member.trustScore, 0)}`}
                    >
                      <span className={`inline-flex h-4 w-4 rounded-full ${tone} opacity-85 group-hover:opacity-100`} />
                    </Link>
                  );
                })}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {group.members.map((member) => (
                <span key={member.agentRole} className="rounded-full border border-border/60 bg-surface px-2.5 py-1 text-[11px] text-txt-secondary">
                  {member.displayName} {formatPercent(member.trustScore, 0)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function CommandCenter({
  loading,
  riskSummary,
  actionQueue,
  changeLog,
  trustMap,
  onOpenSurface,
  onResolveDecision,
  busyDecisionId,
}: CommandCenterProps) {
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-32 w-full" />)}
        </div>
        <Skeleton className="h-72 w-full" />
        <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <RiskSummaryStrip items={riskSummary} />
      <ActionQueueSection
        items={actionQueue}
        onOpenSurface={onOpenSurface}
        onResolveDecision={onResolveDecision}
        busyDecisionId={busyDecisionId}
      />
      <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <ChangeLogSection items={changeLog} />
        <SystemTrustMap entries={trustMap} />
      </div>
    </div>
  );
}
