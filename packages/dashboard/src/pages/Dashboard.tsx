import {
  MdArrowForward,
  MdAttachMoney,
  MdChat,
  MdCheckCircle,
  MdCloud,
  MdFlag,
  MdOutlineAutoGraph,
  MdOutlineSettings,
  MdSpeed,
  MdWarning,
} from 'react-icons/md';
import { Link } from 'react-router-dom';
import { type HTMLAttributes, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useActiveDirectives, useCompanyPulse, useDecisions, useOpenIncidents } from '../lib/hooks';
import { DISPLAY_NAME_MAP } from '../lib/types';
import { SectionHeader, Skeleton, timeAgo } from '../components/ui';
import { GlowingStarsBackgroundCard } from '../components/ui/glowing-stars';
import { apiCall } from '../lib/firebase';
import { useAuth } from '../lib/auth';

interface FinancialRow {
  metric: string;
  value: number;
  date: string;
}

interface GcpBillingRow {
  cost_usd: number;
  recorded_at: string;
}

interface AgentRunRow {
  id: string;
  status: string;
  started_at: string;
}

interface ActivityRow {
  id: string;
  agent_role?: string | null;
  agent_id?: string | null;
  action: string;
  summary?: string | null;
  detail?: string | null;
  created_at: string;
}

interface DeliverableRow {
  id: string;
  title: string;
  content: string | null;
  storage_url: string | null;
  producing_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface ActionCenterItem {
  id: string;
  kind: 'incident' | 'decision' | 'briefing' | 'directive';
  priority: 'critical' | 'high' | 'medium';
  title: string;
  context: string;
  recommendation: string;
  timestamp?: string;
  reviewTo: string;
  approveDecisionId?: string;
}

const PRIORITY_ORDER: Record<ActionCenterItem['priority'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

const PRIORITY_BADGE: Record<ActionCenterItem['priority'], string> = {
  critical: 'bg-prism-critical/15 text-prism-critical border-prism-critical/30',
  high: 'bg-prism-elevated/15 text-prism-elevated border-prism-elevated/30',
  medium: 'bg-cyan/15 text-cyan border-cyan/30',
};

const QUICK_ACTIONS = [
  { label: 'Chat with Ora', description: 'Ask anything about Glyphor', to: '/ora', icon: MdChat },
  { label: 'Create Directive', description: 'Tell agents what to work on', to: '/directives', icon: MdFlag },
  { label: 'View Financials', description: 'Cost breakdown and runway', to: '/financials', icon: MdAttachMoney },
  { label: 'Check Workforce', description: 'Agent health and performance', to: '/workforce', icon: MdOutlineAutoGraph },
  { label: 'Run Settings', description: 'Adjust schedules and models', to: '/settings', icon: MdOutlineSettings },
] as const;

const SUGGESTED_DIRECTIVES = [
  {
    title: 'Prepare a competitive pricing analysis for Slack-first GTM',
    description: 'Would activate Sophia, Lena, and Daniel across research and positioning.',
    cost: '~$2-5 in compute',
  },
  {
    title: 'Draft the first version of our customer-facing landing page',
    description: 'Would activate Maya, Mia, and Ethan across marketing, design, and frontend.',
    cost: '~$3-8 in compute',
  },
  {
    title: 'Audit our SOC 2 readiness and produce a gap report',
    description: 'Would activate Victoria and Morgan for a founder-visible compliance readout.',
    cost: '~$1-3 in compute',
  },
] as const;

function fmtUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
}

function fmtMonths(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(value >= 10 ? 0 : 1)} mo`;
}

function parseText(value: string | null | undefined): string {
  if (!value) return '';
  if (!value.startsWith('{')) return value;
  try {
    const parsed = JSON.parse(value) as { summary?: string; message?: string };
    return (parsed.summary || parsed.message || value).trim();
  } catch {
    return value;
  }
}

function previewText(value: string | null | undefined, fallback: string): string {
  const text = parseText(value).replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function statusTone(status: string | null | undefined): string {
  if (status === 'green') return 'text-[#34D399]';
  if (status === 'red') return 'text-prism-critical';
  return 'text-prism-elevated';
}

function HomeCard({ children, className = '', ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`sidebar-glass dashboard-home-primary glass-card-layout glass-panel panel-primary rounded-2xl border p-5 ${className}`} {...rest}>
      <div className="dashboard-home-surface-content">{children}</div>
    </div>
  );
}

function HomeInnerCard({ children, className = '', ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`sidebar-glass dashboard-home-nested glass-inner-layout glass-panel panel-nested rounded-xl border px-4 py-3 ${className}`} {...rest}>
      <div className="dashboard-home-surface-content">{children}</div>
    </div>
  );
}

function extractDeliverableScore(deliverable: DeliverableRow): number | null {
  const metadata = deliverable.metadata ?? {};
  const direct = metadata.quality_score ?? metadata.score ?? null;
  if (typeof direct === 'number') return direct;
  if (typeof direct === 'string') {
    const parsed = Number(direct);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function buildIncidentContext(title: string, description: string | null): { context: string; recommendation: string } {
  const lower = `${title} ${description ?? ''}`.toLowerCase();
  if (lower.includes('latency') || lower.includes('slow') || lower.includes('cold start')) {
    return {
      context: 'Atlas detected elevated response times on a production path.',
      recommendation: 'Check recent deploys, instance scaling, and whether min-instances should stay above zero.',
    };
  }
  if (lower.includes('serialization') || lower.includes('json') || lower.includes('parse')) {
    return {
      context: 'Tool payloads are likely failing at the framework boundary before execution starts.',
      recommendation: 'Review the latest agent-runtime serialization path and the most recent failed runs before shipping another change.',
    };
  }
  return {
    context: previewText(description, 'An operational alert needs founder-visible triage context.'),
    recommendation: 'Open Operations, confirm impact, and decide whether this needs reassignment, mitigation, or dismissal.',
  };
}

function buildOraActionPrompt(item: ActionCenterItem): string {
  return [
    'Action Center escalation needs a decision.',
    `Type: ${item.kind}`,
    `Priority: ${item.priority}`,
    `Title: ${item.title}`,
    `Context: ${item.context}`,
    `Recommended next step: ${item.recommendation}`,
    '',
    'Please help me with:',
    '1) Impact and urgency assessment',
    '2) Immediate next action I should take',
    '3) A short founder-ready response I can use right now',
  ].join('\n');
}

export default function Dashboard() {
  const { user } = useAuth();
  const { data: pulse, loading: pulseLoading } = useCompanyPulse();
  const { data: decisions, loading: decisionsLoading, updateDecision } = useDecisions();
  const { data: incidents, loading: incidentsLoading } = useOpenIncidents();
  const { data: directives, loading: directivesLoading } = useActiveDirectives();

  const [financialRows, setFinancialRows] = useState<FinancialRow[]>([]);
  const [billingRows, setBillingRows] = useState<GcpBillingRow[]>([]);
  const [runsToday, setRunsToday] = useState<AgentRunRow[]>([]);
  const [activityRows, setActivityRows] = useState<ActivityRow[]>([]);
  const [deliverables, setDeliverables] = useState<DeliverableRow[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setMetricsLoading(true);
      const today = new Date();
      const todayIso = today.toISOString().split('T')[0];
      const monthStart = `${todayIso.slice(0, 8)}01`;
      const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [financialsRes, billingRes, runsRes, activityRes, deliverablesRes] = await Promise.all([
        apiCall<FinancialRow[]>('/api/financials?order=date.desc&limit=120').catch(() => []),
        apiCall<GcpBillingRow[]>(`/api/gcp-billing?since=${thirtyDaysAgo}`).catch(() => []),
        apiCall<AgentRunRow[]>(`/api/agent-runs?since=${todayIso}T00:00:00Z&status=completed&limit=250`).catch(() => []),
        apiCall<ActivityRow[]>('/api/activity?limit=8').catch(() => []),
        apiCall<DeliverableRow[]>(`/api/deliverables?since=${sevenDaysAgo}&order=created_at.desc&limit=10`).catch(() => []),
      ]);

      if (!active) return;
      setFinancialRows(financialsRes ?? []);
      setBillingRows(billingRes ?? []);
      setRunsToday(runsRes ?? []);
      setActivityRows(activityRes ?? []);
      setDeliverables(deliverablesRes ?? []);
      setMetricsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'good morning';
    if (hour < 17) return 'good afternoon';
    return 'good evening';
  })();
  const pendingDecisions = decisions.filter((decision) => decision.status === 'pending');
  const highPriorityDecisions = pendingDecisions.filter((decision) => decision.tier === 'red' || decision.tier === 'yellow');
  const cashSeries = financialRows.filter((row) => row.metric === 'cash_balance' || row.metric === 'bank_balance');
  const cashBalance = cashSeries[0]?.value ?? null;
  const priorCash = cashSeries.find((row) => row.date !== cashSeries[0]?.date)?.value ?? null;
  const cashChangeToday = cashBalance != null && priorCash != null ? cashBalance - priorCash : null;

  const todayIso = new Date().toISOString().split('T')[0];
  const monthPrefix = todayIso.slice(0, 7);
  const computeToday = billingRows
    .filter((row) => row.recorded_at?.startsWith(todayIso))
    .reduce((sum, row) => sum + Number(row.cost_usd), 0);
  const computeMtd = billingRows
    .filter((row) => row.recorded_at?.startsWith(monthPrefix))
    .reduce((sum, row) => sum + Number(row.cost_usd), 0);
  const rollingThirtyDayBurn = billingRows.reduce((sum, row) => sum + Number(row.cost_usd), 0);
  const runwayMonths = cashBalance != null && rollingThirtyDayBurn > 0
    ? cashBalance / rollingThirtyDayBurn
    : null;

  const activeAssignments = directives.reduce(
    (sum, directive) => sum + directive.assignments.filter((assignment) => assignment.status !== 'completed').length,
    0,
  );

  const briefingAgeMs = pulse?.updated_at ? Date.now() - new Date(pulse.updated_at).getTime() : null;
  const briefingStale = briefingAgeMs != null && briefingAgeMs > 18 * 60 * 60 * 1000;

  const actionItems = useMemo<ActionCenterItem[]>(() => {
    const incidentItems: ActionCenterItem[] = incidents.slice(0, 3).map((incident) => {
      const detail = buildIncidentContext(incident.title, incident.description);
      return {
        id: `incident-${incident.id}`,
        kind: 'incident',
        priority: incident.severity === 'critical' ? 'critical' : 'high',
        title: incident.title,
        context: detail.context,
        recommendation: detail.recommendation,
        timestamp: incident.created_at,
        reviewTo: `/operations?tab=overview&focus=incident&id=${encodeURIComponent(incident.id)}`,
      };
    });

    const decisionItems: ActionCenterItem[] = highPriorityDecisions.slice(0, 3).map((decision) => ({
      id: `decision-${decision.id}`,
      kind: 'decision',
      priority: decision.tier === 'red' ? 'critical' : 'high',
      title: decision.title,
      context: previewText(decision.summary, 'A founder decision is waiting without enough context.'),
      recommendation: previewText(decision.reasoning, 'Review the attached recommendation, then approve, reject, or redirect it.'),
      timestamp: decision.created_at,
      reviewTo: `/approvals?decision=${encodeURIComponent(decision.id)}`,
      approveDecisionId: decision.id,
    }));

    const directiveItems: ActionCenterItem[] = directives.length === 0
      ? [{
          id: 'directive-gap',
          kind: 'directive',
          priority: 'medium',
          title: 'No active directives',
          context: 'Your agents do not have founder-defined work to execute right now.',
          recommendation: 'Create one or two directives for this week so Sarah can decompose them into assignments and deliverables.',
          reviewTo: '/directives',
        }]
      : [];

    const briefingItems: ActionCenterItem[] = briefingStale
      ? [{
          id: 'briefing-stale',
          kind: 'briefing',
          priority: 'high',
          title: 'Agent briefing is stale',
          context: `The latest company vitals were updated ${pulse?.updated_at ? timeAgo(pulse.updated_at) : 'a while ago'}, which means your briefing surface is drifting out of date.`,
          recommendation: "Confirm Sarah\u2019s scheduled briefing run is landing, then check channel delivery and company vitals writes.",
          reviewTo: '/operations?tab=overview&focus=briefing',
        }]
      : [];

    return [...briefingItems, ...incidentItems, ...decisionItems, ...directiveItems]
      .sort((left, right) => {
        const priorityDelta = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
        if (priorityDelta !== 0) return priorityDelta;
        if (!left.timestamp || !right.timestamp) return 0;
        return new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
      })
      .slice(0, 4);
  }, [briefingStale, directives.length, highPriorityDecisions, incidents, pulse?.updated_at]);

  const loading = pulseLoading || decisionsLoading || incidentsLoading || directivesLoading || metricsLoading;

  return (
    <div className="dashboard-home space-y-5">
      <GlowingStarsBackgroundCard className="sticky top-0 z-20">
        <HomeCard className="border-white/10 py-4 bg-transparent">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan/80">glyphor command center</p>
              <h1 className="mt-1 font-agency text-[1.7rem] font-bold lowercase text-txt-primary md:text-[2rem]">
                {greeting}, {firstName.toLowerCase()}
              </h1>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricRibbon label="Cash" color="#00E0FF" value={fmtUsd(cashBalance)} detail={cashChangeToday == null ? 'Daily delta unavailable' : `${cashChangeToday >= 0 ? '↑' : '↓'} ${fmtUsd(Math.abs(cashChangeToday))} today · Runway ${fmtMonths(runwayMonths)}`} />
              <MetricRibbon label="MRR" color="#C084FC" value={fmtUsd(pulse?.mrr ?? null)} detail={pulse?.mrr != null ? 'Pre-revenue operating posture' : 'No revenue signal yet'} />
              <MetricRibbon label="Compute" color="#7DD3FC" value={fmtUsd(computeToday)} detail={`${fmtUsd(computeMtd)} MTD · ${fmtUsd(rollingThirtyDayBurn)} rolling 30d`} />
              <MetricRibbon label="System" color="#A855F7" value={pulse?.platform_status?.toUpperCase() ?? '—'} detail={`${pendingDecisions.length} pending decisions · ${runsToday.length} runs today`} toneClass={statusTone(pulse?.platform_status)} />
            </div>
          </div>
        </HomeCard>
      </GlowingStarsBackgroundCard>

      <HomeCard>
        <SectionHeader
          title="Action Center"
          action={<span className="text-[11px] text-txt-faint">{actionItems.length} open items</span>}
        />
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-24" />)}
          </div>
        ) : actionItems.length === 0 ? (
          <p className="py-8 text-sm text-txt-faint">No critical actions queued right now.</p>
        ) : (
          <div className="space-y-3">
            {actionItems.map((item, index) => (
              <HomeInnerCard key={item.id} className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${PRIORITY_BADGE[item.priority]}`}>
                    {item.priority}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-txt-faint">{index + 1}. {item.kind}</span>
                  {item.timestamp ? <span className="ml-auto text-[11px] text-txt-faint">{timeAgo(item.timestamp)}</span> : null}
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-txt-primary">{item.title}</h2>
                  <p className="mt-1 text-[13px] text-txt-secondary">{item.context}</p>
                  <p className="mt-2 text-[13px] text-txt-muted">Recommended: {item.recommendation}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Link to={item.reviewTo} className="group relative inline-flex items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-[#00E0FF] to-[#3730A3] p-[1.5px] text-xs font-medium text-white dark:text-white focus:outline-none">
                    <span className="relative rounded-[5px] bg-white dark:bg-gray-900 px-3 py-1.5 leading-4 text-txt-primary dark:text-white transition-all duration-75 ease-in group-hover:bg-transparent group-hover:text-white">
                      Review
                    </span>
                  </Link>
                  {item.approveDecisionId ? (
                    <>
                      <button
                        onClick={() => updateDecision(item.approveDecisionId!, 'approved', user?.email?.toLowerCase().includes('andrew') ? 'andrew' : 'kristina')}
                        className="group relative inline-flex items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-green-400 to-blue-600 p-[1.5px] text-xs font-medium text-white dark:text-white focus:outline-none"
                      >
                        <span className="relative rounded-[5px] bg-white dark:bg-gray-900 px-3 py-1.5 leading-4 text-txt-primary dark:text-white transition-all duration-75 ease-in group-hover:bg-transparent group-hover:text-white">
                          Approve
                        </span>
                      </button>
                      <button
                        onClick={() => updateDecision(item.approveDecisionId!, 'rejected', user?.email?.toLowerCase().includes('andrew') ? 'andrew' : 'kristina')}
                        className="group relative inline-flex items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-pink-500 to-orange-400 p-[1.5px] text-xs font-medium text-white dark:text-white focus:outline-none"
                      >
                        <span className="relative rounded-[5px] bg-white dark:bg-gray-900 px-3 py-1.5 leading-4 text-txt-primary dark:text-white transition-all duration-75 ease-in group-hover:bg-transparent group-hover:text-white">
                          Reject
                        </span>
                      </button>
                    </>
                  ) : (
                    (item.kind === 'incident' || item.kind === 'briefing') ? (
                      <Link
                        to="/ora"
                        state={{
                          origin: 'action-center',
                          actionItemId: item.id,
                          prefillPrompt: buildOraActionPrompt(item),
                        }}
                        className="group relative inline-flex items-center justify-center overflow-hidden rounded-md bg-gradient-to-br from-[#C084FC] to-[#00E0FF] p-[1.5px] text-xs font-medium text-white dark:text-white focus:outline-none"
                      >
                        <span className="relative rounded-[5px] bg-white dark:bg-gray-900 px-3 py-1.5 leading-4 text-txt-primary dark:text-white transition-all duration-75 ease-in group-hover:bg-transparent group-hover:text-white">
                          Discuss with Ora
                        </span>
                      </Link>
                    ) : null
                  )}
                </div>
              </HomeInnerCard>
            ))}
          </div>
        )}
      </HomeCard>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.3fr_0.9fr]">
        <HomeCard>
          <SectionHeader title="Company Vitals" action={<Link to="/operations" className="text-[11px] text-cyan hover:underline">View all activity</Link>} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <PulseStat label="Runs completed" value={String(runsToday.length)} />
            <PulseStat label="Assignments active" value={String(activeAssignments)} />
            <PulseStat label="Decisions pending" value={String(pendingDecisions.length)} />
          </div>
          <div className="mt-5 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-txt-muted">Recent Agent Work</p>
            {activityRows.length === 0 ? (
              <p className="text-sm text-txt-faint">No recent founder-visible activity logged.</p>
            ) : (
              activityRows.slice(0, 4).map((entry) => {
                const role = entry.agent_role ?? entry.agent_id ?? 'system';
                const name = DISPLAY_NAME_MAP[role] ?? role;
                const summary = previewText(entry.summary ?? entry.detail, entry.action);
                return (
                  <HomeInnerCard key={entry.id} className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-cyan/10 text-cyan">
                      <MdCheckCircle className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-txt-secondary">{name}</p>
                      <p className="mt-1 text-[12px] text-txt-muted">{summary}</p>
                    </div>
                    <span className="text-[10px] text-txt-faint">{timeAgo(entry.created_at)}</span>
                  </HomeInnerCard>
                );
              })
            )}
          </div>
        </HomeCard>

        <HomeCard>
          <SectionHeader title="Quick Actions" />
          <div className="space-y-2.5">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <Link key={action.label} to={action.to} className="flex items-center gap-3 rounded-xl border border-border/80 px-4 py-3 transition-colors hover:border-cyan/30 hover:bg-raised/60">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan/10 text-cyan">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-txt-primary">{action.label}</p>
                    <p className="text-[12px] text-txt-muted">{action.description}</p>
                  </div>
                  <MdArrowForward className="h-4 w-4 text-txt-faint" />
                </Link>
              );
            })}
          </div>
        </HomeCard>
      </div>

      <HomeCard>
        <SectionHeader title="Intelligence Feed" action={<span className="text-[11px] text-txt-faint">Last 7 days</span>} />
        {metricsLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-20" />)}
          </div>
        ) : deliverables.length === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-txt-faint">No deliverables were published in the last 7 days.</p>
            <p className="text-[13px] text-txt-muted">Your agents need active directives to produce founder-visible work. These are the highest-leverage prompts to start with:</p>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
              {SUGGESTED_DIRECTIVES.map((directive) => (
                <HomeInnerCard key={directive.title} className="space-y-3">
                  <div className="flex items-start gap-2">
                    <MdSpeed className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                    <div>
                      <p className="text-[13px] font-semibold text-txt-primary">{directive.title}</p>
                      <p className="mt-1 text-[12px] text-txt-muted">{directive.description}</p>
                    </div>
                  </div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-txt-faint">Estimated cost: {directive.cost}</p>
                  <Link to="/directives" className="inline-flex rounded-lg border border-cyan/30 bg-cyan/10 px-3 py-1.5 text-[12px] font-medium text-cyan transition-colors hover:bg-cyan/20">
                    Create This Directive
                  </Link>
                </HomeInnerCard>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {deliverables.map((deliverable) => {
              const score = extractDeliverableScore(deliverable);
              const producer = deliverable.producing_agent ? (DISPLAY_NAME_MAP[deliverable.producing_agent] ?? deliverable.producing_agent) : 'Unknown agent';
              const summary = previewText(deliverable.content, 'Open the linked artifact for the full output.');
              return (
                <HomeInnerCard key={deliverable.id} className="space-y-2.5">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-txt-primary">{deliverable.title}</p>
                      <p className="mt-1 text-[12px] text-txt-faint">{producer} · {timeAgo(deliverable.created_at)}</p>
                    </div>
                    {score != null ? (
                      <span className="rounded-full border border-[#34D399]/25 bg-[#34D399]/10 px-2.5 py-1 text-[11px] font-semibold text-[#34D399]">
                        Score {score}/100
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[13px] text-txt-secondary">{summary}</p>
                  {deliverable.storage_url ? (
                    <a href={deliverable.storage_url} target="_blank" rel="noreferrer" className="inline-flex rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-txt-muted transition-colors hover:border-cyan/30 hover:text-cyan">
                      Open Deliverable
                    </a>
                  ) : (
                    <Link to="/directives" className="inline-flex rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-txt-muted transition-colors hover:border-cyan/30 hover:text-cyan">
                      View Directive Context
                    </Link>
                  )}
                </HomeInnerCard>
              );
            })}
          </div>
        )}
      </HomeCard>
    </div>
  );
}

function MetricRibbon({ label, value, detail, toneClass = 'text-white', color }: { label: string; value: string; detail: string; toneClass?: string; color?: string }) {
  return (
    <div
      className="rounded-xl border border-white/10 bg-black/30 backdrop-blur-sm px-3 py-2.5"
      style={color ? { borderTopColor: color, borderTopWidth: '2px' } : undefined}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={color ? { color } : undefined}>{label}</p>
      <p className={`mt-1 text-[1.05rem] font-semibold ${toneClass}`}>{value}</p>
      <p className="mt-1 text-[11px] text-white/45">{detail}</p>
    </div>
  );
}

function PulseStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/80 bg-raised/40 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-txt-faint">{label}</p>
      <p className="mt-2 text-[1.6rem] font-semibold text-txt-primary">{value}</p>
    </div>
  );
}



