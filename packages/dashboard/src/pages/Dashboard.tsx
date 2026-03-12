import {
  MdCheckCircle, MdArrowForward, MdWarning, MdFlag,
  MdTrendingUp, MdTrendingDown, MdLightbulb, MdSmartToy,
  MdAccountBalance, MdCloud, MdAttachMoney,
} from 'react-icons/md';
import {
  useDecisions, useOpenIncidents, useCompanyPulse,
  useActiveDirectives, useTopReflections,
} from '../lib/hooks';
import { DISPLAY_NAME_MAP, TIER_TO_IMPACT } from '../lib/types';
import {
  Card,
  InnerCard,
  SectionHeader,
  AgentAvatar,
  ImpactBadge,
  Skeleton,
  timeAgo,
} from '../components/ui';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { apiCall } from '../lib/firebase';
import { useAuth } from '../lib/auth';

/* ── Types ─────────────────────────────────── */

interface KgNodeRow {
  node_type: string;
}

interface FinancialRow {
  metric: string;
  value: number;
  date: string;
}

interface GcpBillingRow {
  cost_usd: number;
  recorded_at: string;
}

/* ── Helpers ───────────────────────────────── */

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-prism-critical',
  high: 'text-prism-elevated',
  medium: 'text-prism-sky',
  low: 'text-txt-faint',
};

function fmtUsd(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function normalizeHighlights(highlights: unknown[] | null | undefined): string[] {
  if (!Array.isArray(highlights)) return [];
  return highlights
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const candidate = item as { text?: unknown; agent?: unknown; type?: unknown };
        if (typeof candidate.text === 'string' && candidate.text.trim().length > 0) return candidate.text;
        const parts = [candidate.agent, candidate.type]
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .join(' · ');
        return parts || null;
      }
      return null;
    })
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/* ── Dashboard ─────────────────────────────── */

export default function Dashboard() {
  const { user } = useAuth();
  const { data: pulse, loading: pulseLoading } = useCompanyPulse();
  const { data: decisions, loading: decisionsLoading } = useDecisions();
  const { data: incidents, loading: incidentsLoading } = useOpenIncidents();
  const { data: directives, loading: directivesLoading } = useActiveDirectives();
  const { data: reflections, loading: reflectionsLoading } = useTopReflections(5);

  const [kgNodes, setKgNodes] = useState<KgNodeRow[]>([]);
  const [cashBalance, setCashBalance] = useState<number | null>(null);
  const [computeToday, setComputeToday] = useState<number | null>(null);
  const [computeMonthly, setComputeMonthly] = useState<number | null>(null);

  // Fetch agent performance (last 7 days aggregate)
  useEffect(() => {
    (async () => {
      try {
        const since = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
        const rows = await apiCall<AgentPerfRow[]>(
          `/api/agent_performance?date=gte.${encodeURIComponent(since)}&order=total_runs.desc`
        );
        // Aggregate by agent
        const byAgent = new Map<string, AgentPerfRow>();
        for (const r of rows ?? []) {
          const e = byAgent.get(r.agent_id);
          if (!e) {
            byAgent.set(r.agent_id, { ...r });
          } else {
            e.total_runs += r.total_runs;
            e.successful_runs += r.successful_runs;
            e.failed_runs += r.failed_runs;
            e.total_cost += r.total_cost;
            e.tasks_completed += r.tasks_completed;
            if (r.avg_quality_score != null) {
              e.avg_quality_score = e.avg_quality_score != null
                ? (e.avg_quality_score + r.avg_quality_score) / 2
                : r.avg_quality_score;
            }
          }
        }
        setAgentPerf(Array.from(byAgent.values()));
      } catch {
        setAgentPerf([]);
      }
    })();
  }, []);

  // Fetch knowledge graph stats
  useEffect(() => {
    (async () => {
      try {
        const rows = await apiCall<KgNodeRow[]>('/api/kg-nodes?fields=node_type');
        setKgNodes(rows ?? []);
      } catch {
        setKgNodes([]);
      }
    })();
  }, []);

  // Fetch cash balance (latest financials metric)
  useEffect(() => {
    (async () => {
      try {
        const rows = await apiCall<FinancialRow[]>('/api/financials?order=date.desc&limit=50');
        const cash = (rows ?? []).find(r => r.metric === 'cash_balance' || r.metric === 'bank_balance');
        if (cash) setCashBalance(cash.value);
      } catch { /* ignore */ }
    })();
  }, []);

  // Fetch compute cost today + monthly
  useEffect(() => {
    (async () => {
      try {
        const todayStr = new Date().toISOString().split('T')[0];
        const monthStart = todayStr.slice(0, 8) + '01';
        const rows = await apiCall<GcpBillingRow[]>(`/api/gcp-billing?since=${monthStart}T00:00:00Z`);
        const all = rows ?? [];
        const todayCost = all
          .filter(r => r.recorded_at?.startsWith(todayStr))
          .reduce((sum, r) => sum + Number(r.cost_usd), 0);
        const monthlyCost = all.reduce((sum, r) => sum + Number(r.cost_usd), 0);
        setComputeToday(todayCost);
        setComputeMonthly(monthlyCost);
      } catch { /* ignore */ }
    })();
  }, []);

  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const pendingDecisions = decisions.filter((d) => d.status === 'pending');

  // Only show incidents from the last 48 hours and deduplicate by title
  const recentCutoff = Date.now() - 48 * 60 * 60 * 1000;
  const recentIncidents = incidents.filter(i => new Date(i.created_at).getTime() > recentCutoff);
  const seenTitles = new Set<string>();
  const dedupedIncidents = recentIncidents.filter(i => {
    const key = i.title.toLowerCase().trim();
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });

  const highPriorityItems = [
    ...dedupedIncidents.map(i => ({ type: 'incident' as const, id: i.id, title: i.title, severity: i.severity, time: i.created_at })),
    ...pendingDecisions.filter(d => d.tier === 'red' || d.tier === 'yellow').map(d => ({
      type: 'decision' as const, id: d.id, title: d.title, severity: d.tier === 'red' ? 'critical' : 'high', time: d.created_at,
    })),
  ].sort((a, b) => (PRIORITY_ORDER[a.severity] ?? 3) - (PRIORITY_ORDER[b.severity] ?? 3));

  // Org Intelligence counts
  const totalNodes = kgNodes.length;
  const patternCount = kgNodes.filter(n => n.node_type === 'pattern').length;
  const contradictionCount = kgNodes.filter(n => n.node_type === 'hypothesis').length;

  // Agent org stats
  const totalRuns = agentPerf.reduce((s, a) => s + a.total_runs, 0);
  const avgQuality = agentPerf.length > 0
    ? agentPerf.filter(a => a.avg_quality_score != null).reduce((s, a) => s + (a.avg_quality_score ?? 0), 0) /
      Math.max(agentPerf.filter(a => a.avg_quality_score != null).length, 1)
    : 0;
  const totalShipped = agentPerf.reduce((s, a) => s + a.tasks_completed, 0);
  const topPerformers = [...agentPerf]
    .filter(a => a.avg_quality_score != null)
    .sort((a, b) => (b.avg_quality_score ?? 0) - (a.avg_quality_score ?? 0))
    .slice(0, 3);
  const needsAttention = [...agentPerf]
    .filter(a => a.failed_runs > 0 || (a.avg_quality_score != null && a.avg_quality_score < 50))
    .sort((a, b) => b.failed_runs - a.failed_runs)
    .slice(0, 3);

  const loading = pulseLoading || decisionsLoading || incidentsLoading || directivesLoading || reflectionsLoading;
  const pulseHighlights = normalizeHighlights(pulse?.highlights);

  return (
    <div className="dashboard-home">
      <div className="dashboard-home-grid">
        <div className="dashboard-home-main space-y-5">
          {/* ── Welcome Banner ─────────────── */}
          <div className="banner-wrapper">
            <div className="banner-inner rounded-[24px] p-7">
              <h1 className="font-agency text-[1.75rem] font-bold lowercase text-white md:text-[2.25rem] leading-tight">
                {greeting}, {firstName}
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] lowercase text-white/60">
                Welcome back to Glyphor AI. Here&apos;s what&apos;s happening.
              </p>
              <p className="mt-4 text-[13px] text-white/35 font-medium">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                {' · '}
                {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </p>
            </div>
          </div>

          {/* ── Agent Briefing + Needs You (side-by-side) ── */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* ── Agent Briefing ─────────────── */}
          <Card accent="0,224,255">
            <SectionHeader
              title="Agent Briefing"
              action={
                pulse ? (
                  <span className="text-[11px] text-txt-faint capitalize">
                    Mood: {pulse.company_mood} · Updated {timeAgo(pulse.updated_at)}
                  </span>
                ) : null
              }
            />
            {pulseLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : pulse ? (
              <div className="space-y-3">
                {pulseHighlights.length > 0 ? (
                  <>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-txt-muted">Highlights</p>
                    <ul className="space-y-1.5">
                      {pulseHighlights.slice(0, 4).map((h, i) => (
                        <li key={i} className="flex items-start gap-2 text-[13px] text-txt-secondary">
                          <MdCheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#34D399]" />
                          {h}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-[13px] text-txt-muted">No highlights yet. Sarah will prepare your next briefing soon.</p>
                )}
                {dedupedIncidents.length > 0 && (
                  <>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-prism-elevated mt-2">Watch Items</p>
                    <ul className="space-y-1.5">
                      {dedupedIncidents.slice(0, 3).map(inc => (
                        <li key={inc.id} className="flex items-start gap-2 text-[13px] text-txt-secondary">
                          <MdWarning className="mt-0.5 h-4 w-4 shrink-0 text-prism-elevated" />
                          <span className="line-clamp-1">{inc.title}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ) : (
              <p className="py-4 text-sm text-txt-faint text-center">No briefing data available</p>
            )}
          </Card>

          {/* ── Needs Your Attention ───────── */}
          {highPriorityItems.length > 0 && (
            <Card accent="239,68,68">
              <SectionHeader
                title="Needs You"
                action={
                  <Link to="/approvals" className="text-[11px] text-cyan hover:underline flex items-center gap-0.5">
                    View all <MdArrowForward className="h-3 w-3" />
                  </Link>
                }
              />
              <div className="space-y-2">
                {highPriorityItems.slice(0, 5).map(item => (
                  <InnerCard key={item.id} accent="239,68,68" className="flex items-center gap-3">
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      item.type === 'incident' ? 'bg-[rgba(239,68,68,0.15)] text-[#EF4444]' : 'bg-[rgba(251,191,36,0.15)] text-[#FBBF24]'
                    }`}>
                      {item.type === 'incident' ? <MdWarning className="h-3.5 w-3.5" /> : <MdFlag className="h-3.5 w-3.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-txt-secondary line-clamp-1">{item.title}</p>
                    </div>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${PRIORITY_COLORS[item.severity] ?? 'text-txt-faint'}`}>
                      {item.severity}
                    </span>
                    <span className="text-[10px] text-txt-faint">{timeAgo(item.time)}</span>
                  </InnerCard>
                ))}
              </div>
            </Card>
          )}
          </div>

          {/* ── Financial Metrics Row ─────── */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FinanceCard
              icon={<MdAttachMoney className="h-5 w-5" />}
              label="MRR"
              value={pulse?.mrr != null ? fmtUsd(Number(pulse.mrr)) : '—'}
              detail={
                pulse?.mrr_change_pct != null ? (
                  <span className={`flex items-center gap-0.5 text-[11px] font-medium ${
                    pulse.mrr_change_pct >= 0 ? 'text-[#34D399]' : 'text-[#EF4444]'
                  }`}>
                    {pulse.mrr_change_pct >= 0 ? <MdTrendingUp className="h-3 w-3" /> : <MdTrendingDown className="h-3 w-3" />}
                    {pulse.mrr_change_pct >= 0 ? '+' : ''}{Number(pulse.mrr_change_pct).toFixed(1)}%
                  </span>
                ) : null
              }
              accent="0,224,255"
            />
            <FinanceCard
              icon={<MdAccountBalance className="h-5 w-5" />}
              label="Cash"
              value={cashBalance != null ? fmtUsd(cashBalance) : '—'}
              accent="52,211,153"
            />
            <FinanceCard
              icon={<MdCloud className="h-5 w-5" />}
              label="Compute Today"
              value={computeToday != null ? fmtUsd(computeToday) : '—'}
              detail={computeMonthly != null ? (
                <span className="text-[11px] text-txt-faint">{fmtUsd(computeMonthly)} this month</span>
              ) : null}
              accent="168,85,247"
            />
          </div>

          {/* ── Active Directives ─────────── */}
          <Card accent="130,140,248">
            <SectionHeader
              title="Directives"
              action={
                <Link to="/directives" className="text-[11px] text-cyan hover:underline flex items-center gap-0.5">
                  All directives <MdArrowForward className="h-3 w-3" />
                </Link>
              }
            />
            {directivesLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
              </div>
            ) : directives.length === 0 ? (
              <p className="py-6 text-center text-sm text-txt-faint">No active directives</p>
            ) : (
              <div className="space-y-2.5">
                {directives
                  .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3))
                  .slice(0, 5)
                  .map(d => {
                    const total = d.assignments.length;
                    const completed = d.assignments.filter(a => a.status === 'completed').length;
                    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                    return (
                      <Link key={d.id} to="/directives" className="block">
                        <InnerCard accent="130,140,248" className="space-y-2">
                          <div className="flex items-center gap-2">
                            <MdFlag className={`h-3.5 w-3.5 ${PRIORITY_COLORS[d.priority] ?? 'text-txt-faint'}`} />
                            <span className="text-[13px] font-medium text-txt-secondary line-clamp-1 flex-1">{d.title}</span>
                            <span className="text-[11px] text-txt-faint">{total > 0 ? `${completed}/${total}` : '—'}</span>
                          </div>
                          {total > 0 && (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 rounded-full bg-border overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-[#34D399]' : 'bg-cyan'}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-txt-faint w-8 text-right">{pct}%</span>
                            </div>
                          )}
                        </InnerCard>
                      </Link>
                    );
                  })}
              </div>
            )}
          </Card>

          {/* ── Deliverables + Org Intelligence ── */}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {/* Recent Deliverables */}
            <Card accent="52,211,153">
              <SectionHeader title="Recent Deliverables" />
              {reflectionsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
                </div>
              ) : reflections.length === 0 ? (
                <p className="py-6 text-center text-sm text-txt-faint">No recent deliverables</p>
              ) : (
                <div className="space-y-2">
                  {reflections.map(r => (
                    <InnerCard key={r.id} accent="52,211,153" className="flex items-start gap-3">
                      <AgentAvatar role={r.agent_role} size={24} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-txt-secondary line-clamp-1">{r.summary}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[11px] text-txt-faint">{DISPLAY_NAME_MAP[r.agent_role] ?? r.agent_role}</span>
                          <span className="text-[10px] text-txt-faint">{timeAgo(r.created_at)}</span>
                        </div>
                      </div>
                      {r.quality_score != null && (
                        <span className={`text-[12px] font-bold font-mono ${
                          r.quality_score >= 80 ? 'text-[#34D399]' : r.quality_score >= 60 ? 'text-prism-elevated' : 'text-txt-faint'
                        }`}>
                          Q{r.quality_score}
                        </span>
                      )}
                    </InnerCard>
                  ))}
                </div>
              )}
            </Card>

            {/* Organizational Intelligence */}
            <Card accent="168,85,247" className="self-start">
              <SectionHeader
                title="Organizational Intelligence"
                action={
                  <Link to="/knowledge" className="text-[11px] text-cyan hover:underline flex items-center gap-0.5">
                    Explore <MdArrowForward className="h-3 w-3" />
                  </Link>
                }
              />
              <div className="grid grid-cols-3 gap-4 py-3">
                <div className="text-center">
                  <p className="text-2xl font-bold font-mono text-txt-primary">{totalNodes.toLocaleString()}</p>
                  <p className="text-[10px] text-txt-faint uppercase tracking-wider mt-1">Knowledge Nodes</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold font-mono text-txt-primary">{patternCount}</p>
                  <p className="text-[10px] text-txt-faint uppercase tracking-wider mt-1">Patterns Found</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold font-mono text-txt-primary">{contradictionCount}</p>
                  <p className="text-[10px] text-txt-faint uppercase tracking-wider mt-1">Hypotheses</p>
                </div>
              </div>
              {kgNodes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {Object.entries(
                    kgNodes.reduce<Record<string, number>>((acc, n) => {
                      acc[n.node_type] = (acc[n.node_type] ?? 0) + 1;
                      return acc;
                    }, {})
                  )
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([type, count]) => (
                      <span key={type} className="rounded-full border border-border px-2.5 py-0.5 text-[10px] text-txt-muted">
                        {type} <span className="font-mono text-txt-faint">{count}</span>
                      </span>
                    ))}
                </div>
              )}
            </Card>
          </div>


        </div>
      </div>
    </div>
  );
}

/* ── Finance Card ──────────────────────────── */
function FinanceCard({
  icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: React.ReactNode;
  accent: string;
}) {
  return (
    <Card accent={accent} className="py-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `rgba(${accent}, 0.15)`, color: `rgb(${accent})` }}>
          {icon}
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-txt-muted">{label}</span>
      </div>
      <p className="text-2xl font-bold font-mono text-txt-primary">{value}</p>
      {detail && <div className="mt-1">{detail}</div>}
    </Card>
  );
}

/* ── Org Stat ──────────────────────────────── */
function OrgStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-xl font-bold font-mono text-txt-primary">{value}</p>
      <p className="text-[10px] text-txt-faint uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}


