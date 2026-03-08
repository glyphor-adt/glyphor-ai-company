import { useMemo } from 'react';
import { Card, SectionHeader, Skeleton } from '../ui';
import {
  EmptyState,
  GovernanceSurface,
  Severity,
  SeverityBadge,
  ToolGrant,
  ToolReputation,
  average,
  daysSince,
  formatDateTime,
  formatPercent,
  toHumanWords,
} from './shared';

interface ToolViewProps {
  loading: boolean;
  toolReputation: ToolReputation[];
  grants: ToolGrant[];
  onOpenSurface: (surface: GovernanceSurface) => void;
}

interface EnrichedTool extends ToolReputation {
  activeGrantCount: number;
  timeoutRate: number | null;
  severity: Severity;
}

function getToolSeverity(tool: ToolReputation): Severity {
  if (!tool.is_active) return 'warning';
  const successRate = tool.success_rate ?? null;
  const reliability = tool.reliability_score ?? null;
  const timeoutRate = tool.total_calls > 0 ? tool.timeout_calls / tool.total_calls : 0;
  const staleDays = daysSince(tool.last_used_at);
  const missingScoresWithUsage = tool.total_calls > 0 && reliability == null && successRate == null;

  if (reliability != null && reliability < 0.5) return 'critical';
  if (successRate != null && successRate < 0.65) return 'critical';
  if (missingScoresWithUsage) return 'medium';
  if (timeoutRate >= 0.3) return 'high';
  if (tool.downstream_defect_count >= 3) return 'high';
  if (staleDays != null && staleDays > 7) return 'medium';
  if (reliability != null && reliability < 0.8) return 'medium';
  return 'good';
}

function ToolHealthOverview({
  activeTools,
  recentExpired,
  telemetryGaps,
  onOpenSurface,
}: {
  activeTools: EnrichedTool[];
  recentExpired: ToolReputation[];
  telemetryGaps: Array<{ toolName: string; activeGrantCount: number }>;
  onOpenSurface: (surface: GovernanceSurface) => void;
}) {
  const avgReliability = average(
    activeTools
      .map((tool) => tool.reliability_score)
      .filter((value): value is number => value != null),
  );
  const highRiskCount = activeTools.filter((tool) => tool.severity === 'critical' || tool.severity === 'high').length;
  const staleCount = activeTools.filter((tool) => (daysSince(tool.last_used_at) ?? 0) > 7).length;

  const cards = [
    { label: 'Active Tools', value: activeTools.length.toString(), tone: 'text-prism-sky' },
    { label: 'Avg Reliability', value: formatPercent(avgReliability, 0), tone: 'text-prism-teal' },
    { label: 'High-Risk Tools', value: highRiskCount.toString(), tone: 'text-prism-critical' },
    { label: 'Stale Active Tools', value: staleCount.toString(), tone: 'text-prism-elevated' },
    { label: 'Expired in 30d', value: recentExpired.length.toString(), tone: 'text-prism-high' },
    { label: 'Awaiting Telemetry', value: telemetryGaps.length.toString(), tone: 'text-prism-sky' },
  ];

  return (
    <Card>
      <SectionHeader
        title="Tool Health Overview"
        subtitle="Restored tool-focused telemetry for reliability, freshness, and expiration events without undoing the new governance layout."
        action={(
          <button
            type="button"
            onClick={() => onOpenSurface('access-control')}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-txt-secondary transition-colors hover:border-border-hover hover:text-txt-primary"
          >
            Search grant inventory
          </button>
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-border/70 bg-prism-card/60 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-txt-muted">{card.label}</p>
            <p className={`mt-3 text-3xl font-semibold ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ToolReputationBoard({
  items,
  onOpenSurface,
}: {
  items: EnrichedTool[];
  onOpenSurface: (surface: GovernanceSurface) => void;
}) {
  if (!items.length) {
    return (
      <EmptyState
        title="Tool reputation is waiting on /api/tool-reputation"
        description="The governance page is wired back to tool reputation telemetry and will populate once the scheduler dashboard API returns tool health rows."
      />
    );
  }

  return (
    <Card>
      <SectionHeader
        title="Tool Reputation Board"
        subtitle="Worst-first view of active tools, combining runtime health with current governance grants."
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-border/70 text-txt-muted">
              <th className="pb-2 pr-3 font-medium">Tool</th>
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 pr-3 font-medium">Reliability</th>
              <th className="pb-2 pr-3 font-medium">Success</th>
              <th className="pb-2 pr-3 font-medium">Usage</th>
              <th className="pb-2 pr-3 font-medium">Latency</th>
              <th className="pb-2 pr-3 font-medium">Granted</th>
              <th className="pb-2 pr-3 font-medium">Last used</th>
            </tr>
          </thead>
          <tbody>
            {items.map((tool) => {
              const staleDays = daysSince(tool.last_used_at);
              const tone = tool.severity === 'critical'
                ? 'bg-prism-critical/6'
                : tool.severity === 'high'
                  ? 'bg-prism-high/6'
                  : tool.severity === 'medium'
                    ? 'bg-prism-elevated/6'
                    : '';
              return (
                <tr key={tool.id} className={`border-b border-border/50 align-top ${tone}`}>
                  <td className="py-3 pr-3">
                    <p className="font-medium text-txt-primary">{toHumanWords(tool.tool_name)}</p>
                    <p className="mt-1 text-[11px] text-txt-muted">{tool.tool_name} · {tool.tool_source}</p>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={tool.severity} />
                      {staleDays != null && staleDays > 7 && (
                        <span className="rounded-full border border-prism-elevated/25 bg-prism-elevated/10 px-2 py-0.5 text-[11px] text-prism-elevated">
                          {staleDays}d stale
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-txt-secondary">{formatPercent(tool.reliability_score, 0)}</td>
                  <td className="py-3 pr-3 text-txt-secondary">{formatPercent(tool.success_rate, 0)}</td>
                  <td className="py-3 pr-3 text-txt-secondary">
                    <div>{tool.total_calls.toLocaleString()} calls</div>
                    <div className="mt-1 text-[11px] text-txt-muted">
                      {tool.timeoutRate == null ? '—' : `${formatPercent(tool.timeoutRate, 0)} timeouts`} · {tool.downstream_defect_count} defects
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-txt-secondary">
                    {tool.avg_latency_ms == null ? '—' : `${Math.round(tool.avg_latency_ms).toLocaleString()} ms`}
                  </td>
                  <td className="py-3 pr-3">
                    {tool.activeGrantCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => onOpenSurface('access-control')}
                        className="rounded-full border border-border/70 bg-surface px-2.5 py-1 text-[11px] text-txt-secondary transition-colors hover:border-border-hover hover:text-txt-primary"
                      >
                        {tool.activeGrantCount} active grant{tool.activeGrantCount === 1 ? '' : 's'}
                      </button>
                    ) : (
                      <span className="text-txt-muted">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-txt-secondary">{formatDateTime(tool.last_used_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RecentlyExpiredTools({
  items,
  grantCounts,
  onOpenSurface,
}: {
  items: ToolReputation[];
  grantCounts: Map<string, number>;
  onOpenSurface: (surface: GovernanceSurface) => void;
}) {
  return (
    <Card>
      <SectionHeader
        title="Recently Expired Tools"
        subtitle="Most recent tool expirations from the scheduler, so founders can see what aged out and why."
      />
      {!items.length ? (
        <p className="text-[13px] text-txt-muted">No tools have expired in the last 30 days.</p>
      ) : (
        <div className="space-y-3">
          {items.map((tool) => {
            const activeGrantCount = grantCounts.get(tool.tool_name) ?? 0;
            return (
              <div key={tool.id} className="rounded-xl border border-border/70 bg-prism-card/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity="warning" />
                      <p className="text-sm font-semibold text-txt-primary">{toHumanWords(tool.tool_name)}</p>
                    </div>
                    <p className="mt-2 text-[13px] text-txt-secondary">
                      {tool.expiration_reason ? `Expired for ${tool.expiration_reason.replace(/_/g, ' ')}.` : 'Marked inactive by the scheduler.'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-txt-muted">
                      <span>{tool.tool_source}</span>
                      <span>Expired {formatDateTime(tool.expired_at ?? tool.updated_at)}</span>
                      <span>Last used {formatDateTime(tool.last_used_at)}</span>
                      <span>Reliability {formatPercent(tool.reliability_score, 0)}</span>
                    </div>
                  </div>
                  {activeGrantCount > 0 && (
                    <button
                      type="button"
                      onClick={() => onOpenSurface('access-control')}
                      className="rounded-lg border border-prism-elevated/30 bg-prism-elevated/10 px-3 py-1.5 text-[12px] font-medium text-prism-elevated transition-colors hover:bg-prism-elevated/20"
                    >
                      {activeGrantCount} active grant{activeGrantCount === 1 ? '' : 's'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function TelemetryGaps({
  items,
  onOpenSurface,
}: {
  items: Array<{ toolName: string; activeGrantCount: number; nextExpiry: string | null }>;
  onOpenSurface: (surface: GovernanceSurface) => void;
}) {
  if (!items.length) return null;

  return (
    <Card>
      <SectionHeader
        title="Granted Tools Awaiting Telemetry"
        subtitle="Active grants that do not yet have a corresponding tool reputation row."
      />
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.toolName} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-prism-card/60 p-4">
            <div>
              <p className="text-sm font-semibold text-txt-primary">{toHumanWords(item.toolName)}</p>
              <p className="mt-1 text-[12px] text-txt-muted">
                {item.activeGrantCount} active grant{item.activeGrantCount === 1 ? '' : 's'} · next expiry {item.nextExpiry ? formatDateTime(item.nextExpiry) : 'not set'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenSurface('access-control')}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-txt-secondary transition-colors hover:border-border-hover hover:text-txt-primary"
            >
              Manage grants
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function ToolView({
  loading,
  toolReputation,
  grants,
  onOpenSurface,
}: ToolViewProps) {
  const activeGrantCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const grant of grants) {
      if (!grant.is_active) continue;
      counts.set(grant.tool_name, (counts.get(grant.tool_name) ?? 0) + 1);
    }
    return counts;
  }, [grants]);

  const activeTools = useMemo<EnrichedTool[]>(() => {
    return toolReputation
      .filter((tool) => tool.is_active)
      .map((tool) => ({
        ...tool,
        activeGrantCount: activeGrantCounts.get(tool.tool_name) ?? 0,
        timeoutRate: tool.total_calls > 0 ? tool.timeout_calls / tool.total_calls : null,
        severity: getToolSeverity(tool),
      }))
      .sort((left, right) => {
        const severityRank: Record<Severity, number> = {
          critical: 0,
          high: 1,
          medium: 2,
          warning: 3,
          low: 4,
          info: 5,
          good: 6,
        };
        return severityRank[left.severity] - severityRank[right.severity]
          || (left.reliability_score ?? left.success_rate ?? -1) - (right.reliability_score ?? right.success_rate ?? -1)
          || (right.total_calls - left.total_calls);
      });
  }, [activeGrantCounts, toolReputation]);

  const recentExpired = useMemo(() => {
    const cutoff = Date.now() - 30 * 86_400_000;
    return toolReputation
      .filter((tool) => {
        if (tool.is_active) return false;
        const eventAt = tool.expired_at ?? tool.updated_at;
        return new Date(eventAt).getTime() >= cutoff;
      })
      .sort((left, right) => new Date(right.expired_at ?? right.updated_at).getTime() - new Date(left.expired_at ?? left.updated_at).getTime())
      .slice(0, 12);
  }, [toolReputation]);

  const telemetryGaps = useMemo(() => {
    const knownTools = new Set(toolReputation.map((tool) => tool.tool_name));
    const grouped = new Map<string, { toolName: string; activeGrantCount: number; nextExpiry: string | null }>();

    for (const grant of grants) {
      if (!grant.is_active || knownTools.has(grant.tool_name)) continue;
      const current = grouped.get(grant.tool_name);
      const nextExpiry = !current?.nextExpiry
        ? grant.expires_at
        : !grant.expires_at
          ? current.nextExpiry
          : new Date(grant.expires_at).getTime() < new Date(current.nextExpiry).getTime()
            ? grant.expires_at
            : current.nextExpiry;

      grouped.set(grant.tool_name, {
        toolName: grant.tool_name,
        activeGrantCount: (current?.activeGrantCount ?? 0) + 1,
        nextExpiry,
      });
    }

    return [...grouped.values()].sort((left, right) => right.activeGrantCount - left.activeGrantCount || left.toolName.localeCompare(right.toolName));
  }, [grants, toolReputation]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-44 w-full" />
        <div className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ToolHealthOverview
        activeTools={activeTools}
        recentExpired={recentExpired}
        telemetryGaps={telemetryGaps.map(({ toolName, activeGrantCount }) => ({ toolName, activeGrantCount }))}
        onOpenSurface={onOpenSurface}
      />
      <div className="grid gap-6 xl:grid-cols-[1.15fr,0.85fr]">
        <ToolReputationBoard items={activeTools} onOpenSurface={onOpenSurface} />
        <RecentlyExpiredTools items={recentExpired} grantCounts={activeGrantCounts} onOpenSurface={onOpenSurface} />
      </div>
      <TelemetryGaps items={telemetryGaps} onOpenSurface={onOpenSurface} />
    </div>
  );
}
