import { MdCheckCircle, MdSearch, MdDescription, MdQueue, MdChat, MdArrowForward, MdWarning } from 'react-icons/md';
import { useAgents, useDecisions, useOpenIncidents, useProducts } from '../lib/hooks';
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
import { SCHEDULER_URL } from '../lib/firebase';
import { apiCall } from '../lib/firebase';
import { useAuth } from '../lib/auth';

interface AnalysisSummary {
  total: number;
  completed: number;
  active: number;
}

interface RunningAgent {
  id: string;
  agent_id: string;
  task: string | null;
  started_at: string;
}

export default function Dashboard() {
  const { data: agents, loading: agentsLoading } = useAgents();
  const { data: decisions, loading: decisionsLoading } = useDecisions();
  const { data: incidents, loading: incidentsLoading } = useOpenIncidents();
  const { data: products } = useProducts();
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisSummary>({ total: 0, completed: 0, active: 0 });
  const [runningAgents, setRunningAgents] = useState<RunningAgent[]>([]);

  const activeAgents = agents.filter((a) => a.status === 'active').length;
  const pendingDecisions = decisions.filter((d) => d.status === 'pending').length;

  // Fetch analysis counts (from Strategy Lab v2)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${SCHEDULER_URL}/strategy-lab`);
        if (res.ok) {
          const data = await res.json();
          const analyses = Array.isArray(data) ? data : [];
          setAnalysisSummary({
            total: analyses.length,
            completed: analyses.filter((a: { status: string }) => a.status === 'completed').length,
            active: analyses.filter((a: { status: string }) => !['completed', 'failed'].includes(a.status)).length,
          });
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // Fetch currently running agents
  useEffect(() => {
    const fetchRunning = async () => {
      try {
        const rows = await apiCall<RunningAgent[]>('/api/agent-runs?status=running');
        setRunningAgents(() => {
          const allRunning = rows ?? [];
          // Deduplicate by agent — keep the most recent run per agent
          const byAgent = new Map<string, RunningAgent>();
          for (const run of allRunning) {
            const existing = byAgent.get(run.agent_id);
            if (!existing || new Date(run.started_at) > new Date(existing.started_at)) {
              byAgent.set(run.agent_id, run);
            }
          }
          return Array.from(byAgent.values());
        });
      } catch {
        setRunningAgents([]);
      }
    };
    fetchRunning();
  }, []);

  const { user } = useAuth();
  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const productCount = products.length;

  return (
    <div className="dashboard-home">
      <div className="dashboard-home-grid">
        <div className="dashboard-home-main space-y-4">
          <Card accent="0,224,255" glow className="banner">
            <div className="flex items-center justify-between gap-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan/80">
                  Dark Glass Command Center
                </p>
                <h1 className="mt-3 text-2xl font-bold text-txt-primary md:text-[2rem]">
                  {greeting}, {firstName}
                </h1>
                <p className="mt-2 max-w-2xl text-sm text-txt-secondary">
                  Welcome back to Glyphor AI. Ready to discover new insights?
                </p>
                <p className="mt-3 text-[12px] text-txt-faint">
                  {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  {' · '}
                  {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard
              icon={<AgentIcon />}
              value={agentsLoading ? '…' : `${activeAgents}`}
              label="Active Agents"
              sub={`${agents.length} total`}
              loading={agentsLoading}
              iconBg="rgba(0, 224, 255, 0.1)"
              iconColor="#00E0FF"
              accent="0,224,255"
            />
            <StatCard
              icon={<AnalysisIcon />}
              value={String(analysisSummary.total)}
              label="Total Analyses"
              sub={`${analysisSummary.completed} completed`}
              loading={false}
              iconBg="rgba(0, 163, 255, 0.1)"
              iconColor="#00A3FF"
              accent="0,163,255"
            />
            <StatCard
              icon={<ReportIcon />}
              value={String(analysisSummary.completed)}
              label="Reports Generated"
              sub="strategic reports"
              loading={false}
              iconBg="rgba(17, 113, 237, 0.12)"
              iconColor="#1171ED"
              accent="17,113,237"
            />
            <StatCard
              icon={<QueueIcon />}
              value={String(analysisSummary.active)}
              label="Active Analyses"
              sub={pendingDecisions > 0 ? `${pendingDecisions} decisions pending` : 'all clear'}
              loading={false}
              iconBg="rgba(110, 119, 223, 0.12)"
              iconColor="#6E77DF"
              accent="110,119,223"
            />
          </div>

          {runningAgents.length > 0 && (
            <Link to="/activity" className="block">
              <Card accent="52,211,153" className="agent-bar" interactive>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34D399] opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#34D399]" />
                    </span>
                    <span className="text-[13px] font-semibold text-[#34D399]">
                      {runningAgents.length} agent{runningAgents.length > 1 ? 's' : ''} working
                    </span>
                  </div>
                  <div className="flex items-center gap-3 overflow-hidden">
                    {runningAgents.slice(0, 5).map((run) => (
                      <InnerCard key={run.id} accent="52,211,153" className="flex items-center gap-2 px-2.5 py-1.5">
                        <AgentAvatar role={run.agent_id} size={20} />
                        <span className="max-w-[120px] truncate text-[11px] text-txt-secondary">
                          {DISPLAY_NAME_MAP[run.agent_id] ?? run.agent_id}
                        </span>
                        <span className="max-w-[100px] truncate text-[10px] text-txt-faint">
                          {run.task ?? ''}
                        </span>
                      </InnerCard>
                    ))}
                    {runningAgents.length > 5 && (
                      <span className="text-[11px] text-txt-faint">+{runningAgents.length - 5} more</span>
                    )}
                  </div>
                  <span className="ml-auto flex items-center gap-1 text-[11px] text-txt-faint">View activity <MdArrowForward /></span>
                </div>
              </Card>
            </Link>
          )}

          <div>
            <SectionHeader title="Quick Actions" />
            <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <QuickActionCard
                to="/strategy"
                icon={<MdSearch className="h-6 w-6" />}
                iconBg="rgba(0, 224, 255, 0.1)"
                iconColor="#00E0FF"
                accent="0,224,255"
                title="Start New Research"
                description="Launch AI-powered analysis and intelligence gathering"
              />
              <QuickActionCard
                to="/strategy"
                icon={<MdDescription className="h-6 w-6" />}
                iconBg="rgba(0, 163, 255, 0.1)"
                iconColor="#00A3FF"
                accent="0,163,255"
                title="View Reports"
                description="Access your saved analysis reports and insights"
              />
              <QuickActionCard
                to="/chat"
                icon={<MdChat className="h-6 w-6" />}
                iconBg="rgba(52, 211, 153, 0.12)"
                iconColor="#34D399"
                accent="52,211,153"
                title="Chat with Agents"
                description="Talk to your AI executive team directly"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <MetricCard
              label="Pending Decisions"
              value={String(pendingDecisions)}
              hint="Awaiting founder review"
              accent="17,113,237"
            />
            <MetricCard
              label="Open Incidents"
              value={String(incidents.length)}
              hint={incidentsLoading ? 'Checking now' : (incidents[0]?.severity ?? 'stable')}
              accent="239,68,68"
            />
            <MetricCard
              label="Products Online"
              value={String(productCount)}
              hint="Tracked in cockpit"
              accent="0,163,255"
            />
            <MetricCard
              label="Agents Running"
              value={String(runningAgents.length)}
              hint="Live workload"
              accent="52,211,153"
            />
          </div>

          <Card accent="0,163,255">
            <SectionHeader
              title="AI Workforce"
              action={
                <Link to="/workforce" className="text-xs text-prism-tertiary hover:text-prism-primary hover:underline">
                  <span className="flex items-center gap-1">Meet the team <MdArrowForward /></span>
                </Link>
              }
            />
            {agentsLoading ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {agents.slice(0, 12).map((agent) => (
                  <Link
                    key={agent.id}
                    to={`/chat/${agent.role}`}
                    className="group block"
                  >
                    <InnerCard accent="0,163,255" className="flex flex-col items-center gap-2 px-3 py-3 transition-transform duration-200 group-hover:-translate-y-0.5">
                      <AgentAvatar role={agent.role} size={40} glow={agent.status === 'active'} avatarUrl={agent.avatar_url} />
                      <p className="text-center text-[11px] font-medium leading-tight text-txt-muted transition-colors group-hover:text-txt-primary">
                        {DISPLAY_NAME_MAP[agent.role] ?? agent.display_name ?? agent.role}
                      </p>
                    </InnerCard>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="dashboard-home-side space-y-4">
          <Card accent="239,68,68">
            <SectionHeader
              title="Open Incidents"
              action={
                <Link to="/operations" className="text-xs text-prism-tertiary hover:text-prism-primary hover:underline">
                  View all
                </Link>
              }
            />
            {incidentsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : incidents.length === 0 ? (
              <p className="py-8 text-center text-sm text-txt-faint">
                All clear <MdCheckCircle className="inline h-4 w-4 text-tier-green" />
              </p>
            ) : (
              <div className="space-y-2">
                {incidents.map((incident) => (
                  <InnerCard
                    key={incident.id}
                    accent="239,68,68"
                    className="flex items-start gap-3"
                  >
                    <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(239,68,68,0.12)] text-[#EF4444]">
                      <MdWarning className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#EF4444]">
                          {incident.severity}
                        </span>
                        <span className="text-[10px] text-txt-faint">{timeAgo(incident.created_at)}</span>
                      </div>
                      <p className="mt-1 text-[13px] font-medium text-txt-primary line-clamp-1">{incident.title}</p>
                      {incident.description && (
                        <p className="mt-1 text-[11px] text-txt-muted line-clamp-2">{incident.description}</p>
                      )}
                    </div>
                  </InnerCard>
                ))}
              </div>
            )}
          </Card>

          <Card accent="17,113,237" className="queue">
          <SectionHeader
            title="Decision Queue"
            action={
              <Link to="/approvals" className="text-xs text-prism-tertiary hover:text-prism-primary hover:underline">
                View all
              </Link>
            }
          />
          {decisionsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : decisions.filter((d) => d.status === 'pending').length === 0 ? (
            <p className="py-8 text-center text-sm text-txt-faint">
              All clear <MdCheckCircle className="inline h-4 w-4 text-tier-green" />
            </p>
          ) : (
            <div className="space-y-2">
              {decisions
                .filter((d) => d.status === 'pending')
                .slice(0, 5)
                .map((d) => (
                  <InnerCard
                    key={d.id}
                    accent="17,113,237"
                    className="flex items-start gap-3"
                  >
                    <AgentAvatar role={d.proposed_by} size={24} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-txt-secondary line-clamp-1">{d.title}</p>
                      <p className="text-[11px] text-txt-faint line-clamp-1">{d.summary}</p>
                    </div>
                    <ImpactBadge impact={TIER_TO_IMPACT[d.tier] ?? d.tier} />
                  </InnerCard>
                ))}
            </div>
          )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent: string;
}) {
  return (
    <Card accent={accent} className="min-h-[124px]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-txt-faint">{label}</p>
      <p className="mt-4 font-mono text-3xl font-bold tracking-tight text-txt-primary">{value}</p>
      <p className="mt-2 text-[12px] text-txt-muted">{hint}</p>
    </Card>
  );
}

/* ── Stat Card ─────────────────────────────── */
function StatCard({
  icon,
  value,
  label,
  sub,
  loading,
  iconBg,
  iconColor,
  accent,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  sub: string;
  loading: boolean;
  iconBg: string;
  iconColor: string;
  accent: string;
}) {
  if (loading) return <Skeleton className="h-28" />;

  return (
    <Card accent={accent} className="stat-card stat-card-accent flex flex-col gap-3" glow={accent === '0,224,255'}>
      <div className="flex items-center justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: iconBg, color: iconColor }}>
          {icon}
        </div>
      </div>
      <div>
        <p className="font-mono text-3xl font-bold tracking-tight text-txt-primary">{value}</p>
        <p className="text-[12px] font-semibold text-txt-muted mt-0.5">{label}</p>
        <p className="text-[11px] text-txt-faint mt-0.5">{sub}</p>
      </div>
    </Card>
  );
}

/* ── Quick Action Card ─────────────────────── */
function QuickActionCard({
  to,
  icon,
  iconBg,
  iconColor,
  accent,
  title,
  description,
}: {
  to: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  accent: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="quick-action block"
    >
      <Card accent={accent} interactive className="flex h-full flex-col gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110" style={{ background: iconBg, color: iconColor }}>
          {icon}
        </div>
        <div>
          <p className="text-[14px] font-bold text-txt-primary group-hover:text-cyan transition-colors">{title}</p>
          <p className="mt-1 text-[12px] text-txt-muted leading-relaxed">{description}</p>
        </div>
      </Card>
    </Link>
  );
}

/* ── Inline SVG Icons for stat cards ───────── */

function AgentIcon() {
  return (
    <svg className="h-5 w-5 text-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.118a7.5 7.5 0 0115 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.5-1.632z" />
    </svg>
  );
}

function AnalysisIcon() {
  return (
    <svg className="h-5 w-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
    </svg>
  );
}

function ReportIcon() {
  return (
    <svg className="h-5 w-5 text-prism-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg className="h-5 w-5 text-prism-elevated" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
    </svg>
  );
}
