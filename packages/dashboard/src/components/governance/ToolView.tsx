import { useMemo, useState } from 'react';
import { MdSearch, MdClose } from 'react-icons/md';
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
  getDisplayName,
  getRoleTitle,
  toHumanWords,
} from './shared';
import { DISPLAY_NAME_MAP, ROLE_DEPARTMENT, ROLE_TITLE, AGENT_BUILT_IN_TOOLS } from '../../lib/types';
import { getToolPlatform, getToolPlatformMeta, PLATFORM_META, type ToolPlatform } from '../../lib/toolPlatform';

type HealthFilter = null | 'high-risk' | 'stale' | 'telemetry-gap';

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
  telemetryGaps,
  activeFilter,
  onFilter,
}: {
  activeTools: EnrichedTool[];
  telemetryGaps: Array<{ toolName: string; activeGrantCount: number }>;
  activeFilter: HealthFilter;
  onFilter: (filter: HealthFilter) => void;
}) {
  const avgReliability = average(
    activeTools
      .map((tool) => tool.reliability_score)
      .filter((value): value is number => value != null),
  );
  const highRiskCount = activeTools.filter((tool) => tool.severity === 'critical' || tool.severity === 'high').length;
  const staleCount = activeTools.filter((tool) => (daysSince(tool.last_used_at) ?? 0) > 7).length;

  const cards: { label: string; value: string; tone: string; filter?: HealthFilter }[] = [
    { label: 'Active Tools', value: activeTools.length.toString(), tone: 'text-prism-sky' },
    { label: 'Avg Reliability', value: formatPercent(avgReliability, 0), tone: 'text-prism-teal' },
    { label: 'High-Risk Tools', value: highRiskCount.toString(), tone: 'text-prism-critical', filter: 'high-risk' },
    { label: 'Stale Active Tools', value: staleCount.toString(), tone: 'text-prism-elevated', filter: 'stale' },
    { label: 'Awaiting Telemetry', value: telemetryGaps.length.toString(), tone: 'text-prism-sky', filter: 'telemetry-gap' },
  ];

  return (
    <Card>
      <SectionHeader
        title="Tool Health Overview"
        subtitle="Reliability, freshness, and risk status across all active tools."
        action={activeFilter ? (
          <button
            type="button"
            onClick={() => onFilter(null)}
            className="flex items-center gap-1.5 rounded-lg border border-cyan/30 bg-cyan/10 px-3 py-1.5 text-[12px] font-medium text-cyan transition-colors hover:bg-cyan/20"
          >
            <MdClose className="h-3.5 w-3.5" />
            Clear filter
          </button>
        ) : undefined}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => {
          const isClickable = card.filter != null;
          const isActive = activeFilter === card.filter;
          return (
            <button
              key={card.label}
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onFilter(isActive ? null : card.filter!)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                isActive
                  ? 'border-cyan/40 bg-cyan/8 ring-1 ring-cyan/20'
                  : 'border-border/70 bg-prism-card/60'
              } ${isClickable ? 'cursor-pointer hover:border-border-hover' : 'cursor-default'}`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-txt-muted">{card.label}</p>
              <p className={`mt-3 text-3xl font-semibold ${card.tone}`}>{card.value}</p>
              {isClickable && (
                <p className="mt-2 text-[10px] text-txt-muted">{isActive ? 'Showing filtered' : 'Click to filter'}</p>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function ToolReputationBoard({
  items,
  activeFilter,
  onOpenSurface,
}: {
  items: EnrichedTool[];
  activeFilter: HealthFilter;
  onOpenSurface: (surface: GovernanceSurface) => void;
}) {
  const filtered = useMemo(() => {
    if (!activeFilter) return items;
    if (activeFilter === 'high-risk') return items.filter((t) => t.severity === 'critical' || t.severity === 'high');
    if (activeFilter === 'stale') return items.filter((t) => (daysSince(t.last_used_at) ?? 0) > 7);
    return items;
  }, [items, activeFilter]);

  const filterLabel = activeFilter === 'high-risk' ? 'High-Risk' : activeFilter === 'stale' ? 'Stale' : null;

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
        title={filterLabel ? `Tool Reputation Board — ${filterLabel} (${filtered.length})` : 'Tool Reputation Board'}
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
            {filtered.map((tool) => {
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
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-txt-muted">
                      {(() => {
                        const pm = getToolPlatformMeta(tool.tool_name);
                        return (
                          <span className={`rounded border ${pm.borderColor} ${pm.bgColor} px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider ${pm.color}`}>
                            {pm.label}
                          </span>
                        );
                      })()}
                      <span>{tool.tool_name}</span>
                    </p>
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

/* ── Tool Assignment Search ──────────────────────────────── */

interface AgentSearchResult {
  type: 'agent';
  key: string;
  label: string;
  subtitle: string;
  tools: string[];
}

interface ToolSearchResult {
  type: 'tool';
  key: string;
  label: string;
  subtitle: string;
  agents: string[];
}

type SearchResult = AgentSearchResult | ToolSearchResult;

function normalizeSearch(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_./:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function ToolAssignmentSearch({ grants }: { grants: ToolGrant[] }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  const results = useMemo<SearchResult[]>(() => {
    const q = normalizeSearch(query);
    if (!q) return [];

    const matches: SearchResult[] = [];

    // ── Agent matches — use AGENT_BUILT_IN_TOOLS as the canonical tool list ──
    for (const [role, displayName] of Object.entries(DISPLAY_NAME_MAP)) {
      const searchable = normalizeSearch(
        [role, displayName, ROLE_DEPARTMENT[role] ?? '', ROLE_TITLE[role] ?? ''].join(' '),
      );
      if (!q.split(' ').every((token) => searchable.includes(token))) continue;

      const tools = AGENT_BUILT_IN_TOOLS[role] ?? [];
      matches.push({
        type: 'agent',
        key: `agent:${role}`,
        label: displayName,
        subtitle: `${ROLE_TITLE[role] ?? ROLE_DEPARTMENT[role] ?? 'Unknown'} · ${tools.length} tool${tools.length === 1 ? '' : 's'}`,
        tools,
      });
    }

    // ── Tool matches — build from AGENT_BUILT_IN_TOOLS ──
    const toolToAgents = new Map<string, string[]>();
    for (const [role, tools] of Object.entries(AGENT_BUILT_IN_TOOLS)) {
      for (const tool of tools) {
        const list = toolToAgents.get(tool) ?? [];
        list.push(role);
        toolToAgents.set(tool, list);
      }
    }

    for (const [tool, agents] of toolToAgents) {
      const platform = getToolPlatform(tool);
      const pm = PLATFORM_META[platform];
      const searchable = normalizeSearch(
        [tool, toHumanWords(tool), pm.label].join(' '),
      );
      if (!q.split(' ').every((token) => searchable.includes(token))) continue;

      matches.push({
        type: 'tool',
        key: `tool:${tool}`,
        label: toHumanWords(tool),
        subtitle: `${pm.label} · ${agents.length} agent${agents.length === 1 ? '' : 's'}`,
        agents,
      });
    }

    return matches.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'agent' ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [query]);

  const showResults = focused && query.trim().length > 0;

  return (
    <Card>
      <SectionHeader
        title="Tool Assignment Search"
        subtitle="Search which tools are assigned to which agents, or find all agents that have a specific tool."
      />
      <div className="flex items-center gap-3">
        <MdSearch className="h-5 w-5 shrink-0 text-txt-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          placeholder='Search agents or tools — e.g. "Marcus", "send_email", "finance"'
          className="flex-1 bg-transparent text-sm text-txt-primary placeholder:text-txt-muted outline-none"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} className="text-txt-muted hover:text-txt-primary">
            <MdClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {showResults && (
        <div className="mt-4 space-y-3">
          {results.length === 0 ? (
            <p className="text-[13px] text-txt-muted">No agents or tools match &quot;{query.trim()}&quot;</p>
          ) : (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-txt-muted">
                {results.length} result{results.length === 1 ? '' : 's'}
              </p>
              {results.slice(0, 12).map((result) => {
                if (result.type === 'agent') {
                  // Group tools by platform
                  const byPlatform = new Map<ToolPlatform, string[]>();
                  for (const t of result.tools) {
                    const p = getToolPlatform(t);
                    const list = byPlatform.get(p) ?? [];
                    list.push(t);
                    byPlatform.set(p, list);
                  }

                  return (
                    <div key={result.key} className="rounded-xl border border-border/70 bg-prism-card/60 p-4">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-prism-sky/30 bg-prism-sky/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-prism-sky">
                          agent
                        </span>
                        <p className="text-sm font-semibold text-txt-primary">{result.label}</p>
                      </div>
                      <p className="mt-1 text-[12px] text-txt-muted">{result.subtitle}</p>

                      {result.tools.length > 0 && (
                        <div className="mt-3 space-y-2.5">
                          {[...byPlatform.entries()]
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([platform, tools]) => {
                              const pm = PLATFORM_META[platform];
                              return (
                                <div key={platform}>
                                  <p className={`mb-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] ${pm.color}`}>
                                    {pm.label} ({tools.length})
                                  </p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {tools.map((t) => (
                                      <span
                                        key={t}
                                        className={`rounded-lg border ${pm.borderColor} ${pm.bgColor} px-2 py-1 text-[11px] ${pm.color}`}
                                      >
                                        {toHumanWords(t)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  );
                }

                // Tool result — show agents who have it
                const pm = getToolPlatformMeta(result.agents[0] ? result.key.replace('tool:', '') : '');
                const toolName = result.key.replace('tool:', '');
                const toolPm = getToolPlatformMeta(toolName);
                return (
                  <div key={result.key} className="rounded-xl border border-border/70 bg-prism-card/60 p-4">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border ${toolPm.borderColor} ${toolPm.bgColor} px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${toolPm.color}`}>
                        {toolPm.label}
                      </span>
                      <p className="text-sm font-semibold text-txt-primary">{result.label}</p>
                    </div>
                    <p className="mt-1 text-[12px] text-txt-muted">{result.subtitle}</p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {result.agents.map((role) => (
                        <div
                          key={role}
                          className="rounded-lg border border-border/60 bg-surface px-2.5 py-1.5 text-[11px]"
                        >
                          <span className="text-txt-primary">{getDisplayName(role)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
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

  const [healthFilter, setHealthFilter] = useState<HealthFilter>(null);

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
      <ToolAssignmentSearch grants={grants} />
      <ToolHealthOverview
        activeTools={activeTools}
        telemetryGaps={telemetryGaps.map(({ toolName, activeGrantCount }) => ({ toolName, activeGrantCount }))}
        activeFilter={healthFilter}
        onFilter={setHealthFilter}
      />
      <ToolReputationBoard items={activeTools} activeFilter={healthFilter} onOpenSurface={onOpenSurface} />
      <TelemetryGaps items={telemetryGaps} onOpenSurface={onOpenSurface} />
    </div>
  );
}
