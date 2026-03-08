import { MdCheckCircle, MdSearch, MdDescription, MdQueue, MdChat, MdGroup, MdArrowForward } from 'react-icons/md';
import { useAgents, useDecisions, useProducts } from '../lib/hooks';
import FounderBriefing from '../components/FounderBriefing';
import { DISPLAY_NAME_MAP, TIER_TO_IMPACT } from '../lib/types';
import {
  Card,
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

  return (
    <div className="space-y-8">
      {/* ── Welcome Banner ─────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-prism-border bg-prism-card p-6 flex items-center justify-between shadow-prism">
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -right-8 -top-8 h-48 w-48 rounded-full bg-prism-fill-1/20 blur-3xl" />
        <div className="pointer-events-none absolute right-1/3 -bottom-6 h-32 w-32 rounded-full bg-prism-fill-5/20 blur-3xl" />
        <div className="pointer-events-none absolute left-1/2 top-0 h-px w-1/2 bg-gradient-to-r from-transparent via-cyan/20 to-transparent" />
        <div className="relative z-10">
          <h1 className="text-2xl font-bold text-txt-primary">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-txt-muted">
            Welcome back to Glyphor AI. Ready to discover new insights?
          </p>
          <p className="mt-2 text-[12px] text-txt-faint">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            {' · '}
            {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
      </div>

      {/* ── Stats Row ──────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          icon={<AgentIcon />}
          value={agentsLoading ? '…' : `${activeAgents}`}
          label="Active Agents"
          sub={`${agents.length} total`}
          loading={agentsLoading}
          lightGradient="bg-prism-card border-prism-border"
          iconBg="bg-prism-tint-1"
          accentClass="border-t-2 border-prism-fill-1"
        />
        <StatCard
          icon={<AnalysisIcon />}
          value={String(analysisSummary.total)}
          label="Total Analyses"
          sub={`${analysisSummary.completed} completed`}
          loading={false}
          lightGradient="bg-prism-card border-prism-border"
          iconBg="bg-prism-tint-5"
          accentClass="border-t-2 border-prism-fill-5"
        />
        <StatCard
          icon={<ReportIcon />}
          value={String(analysisSummary.completed)}
          label="Reports Generated"
          sub="strategic reports"
          loading={false}
          lightGradient="bg-prism-card border-prism-border"
          iconBg="bg-prism-tint-2"
          accentClass="border-t-2 border-prism-fill-2"
        />
        <StatCard
          icon={<QueueIcon />}
          value={String(analysisSummary.active)}
          label="Active Analyses"
          sub={pendingDecisions > 0 ? `${pendingDecisions} decisions pending` : 'all clear'}
          loading={false}
          lightGradient="bg-prism-card border-prism-border"
          iconBg="bg-prism-elevated/15"
          accentClass="border-t-2 border-prism-elevated"
        />
      </div>

      {/* ── Running Now Banner ─────────────── */}
      {runningAgents.length > 0 && (
        <Link to="/activity" className="block">
          <div className="flex items-center gap-4 rounded-xl border border-cyan/20 bg-gradient-to-r from-cyan/5 to-transparent px-5 py-3 transition-all hover:border-cyan/30 hover:shadow-md">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan" />
              </span>
              <span className="text-[13px] font-semibold text-cyan">
                {runningAgents.length} agent{runningAgents.length > 1 ? 's' : ''} working
              </span>
            </div>
            <div className="flex items-center gap-3 overflow-hidden">
              {runningAgents.slice(0, 5).map((run) => (
                <div key={run.id} className="flex items-center gap-2 rounded-lg bg-surface/50 px-2.5 py-1">
                  <AgentAvatar role={run.agent_id} size={20} />
                  <span className="text-[11px] text-txt-secondary truncate max-w-[120px]">
                    {DISPLAY_NAME_MAP[run.agent_id] ?? run.agent_id}
                  </span>
                  <span className="text-[10px] text-txt-faint truncate max-w-[100px]">
                    {run.task ?? ''}
                  </span>
                </div>
              ))}
              {runningAgents.length > 5 && (
                <span className="text-[11px] text-txt-faint">+{runningAgents.length - 5} more</span>
              )}
            </div>
            <span className="ml-auto flex items-center gap-1 text-[11px] text-txt-faint">View activity <MdArrowForward /></span>
          </div>
        </Link>
      )}

      {/* ── Quick Actions ─────────────────── */}
      <div>
        <SectionHeader title="Quick Actions" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 mt-1">
          <QuickActionCard
            to="/strategy"
            icon={<MdSearch className="h-6 w-6" />}
            iconBg="bg-prism-fill-2/15"
            iconColor="text-prism-teal"
            title="Start New Research"
            description="Launch AI-powered analysis and intelligence gathering"
          />
          <QuickActionCard
            to="/strategy"
            icon={<MdDescription className="h-6 w-6" />}
            iconBg="bg-prism-elevated/15"
            iconColor="text-prism-elevated"
            title="View Reports"
            description="Access your saved analysis reports and insights"
          />
          <QuickActionCard
            to="/chat"
            icon={<MdChat className="h-6 w-6" />}
            iconBg="bg-cyan/15"
            iconColor="text-cyan"
            title="Chat with Agents"
            description="Talk to your AI executive team directly"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* ── Founder Briefing ──────────── */}
        <FounderBriefing />

        {/* ── Decision Queue ─────────────── */}
        <Card>
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
                  <div
                    key={d.id}
                    className="flex items-start gap-3 rounded-lg border border-border bg-raised px-3 py-2.5"
                  >
                    <AgentAvatar role={d.proposed_by} size={24} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-txt-secondary line-clamp-1">{d.title}</p>
                      <p className="text-[11px] text-txt-faint line-clamp-1">{d.summary}</p>
                    </div>
                    <ImpactBadge impact={TIER_TO_IMPACT[d.tier] ?? d.tier} />
                  </div>
                ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── AI Workforce Preview ───────────── */}
      <Card>
        <SectionHeader
          title="AI Workforce"
          action={
            <Link to="/workforce" className="text-xs text-prism-tertiary hover:text-prism-primary hover:underline">
              <span className="flex items-center gap-1">Meet the team <MdArrowForward /></span>
            </Link>
          }
        />
        {agentsLoading ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {agents.slice(0, 12).map((agent) => (
              <Link
                key={agent.id}
                to={`/chat/${agent.role}`}
                className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-raised p-3 transition-all hover:border-border-hover hover:shadow-md"
              >
                <AgentAvatar role={agent.role} size={40} glow={agent.status === 'active'} avatarUrl={agent.avatar_url} />
                <p className="text-[11px] font-medium text-txt-muted group-hover:text-txt-primary text-center leading-tight transition-colors">
                  {DISPLAY_NAME_MAP[agent.role] ?? agent.display_name ?? agent.role}
                </p>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── Stat Card ─────────────────────────────── */
function StatCard({
  icon,
  value,
  label,
  sub,
  loading,
  iconBg = '',
  accentClass = '',
  lightGradient = '',
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  sub: string;
  loading: boolean;
  iconBg?: string;
  accentClass?: string;
  lightGradient?: string;
}) {
  if (loading) return <Skeleton className="h-28" />;

  return (
    <div className={`glass-card rounded-xl border p-5 flex flex-col gap-3 transition-all duration-200 ${lightGradient} ${accentClass}`}>
      <div className="flex items-center justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconBg}`}>
          {icon}
        </div>
      </div>
      <div>
        <p className="font-mono text-3xl font-bold tracking-tight text-txt-primary">{value}</p>
        <p className="text-[12px] font-semibold text-txt-muted mt-0.5">{label}</p>
        <p className="text-[11px] text-txt-faint mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

/* ── Quick Action Card ─────────────────────── */
function QuickActionCard({
  to,
  icon,
  iconBg,
  iconColor,
  title,
  description,
}: {
  to: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="group glass-card flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:border-border-hover"
    >
      <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${iconBg} ${iconColor} transition-transform duration-200 group-hover:scale-110`}>
        {icon}
      </div>
      <div>
        <p className="text-[14px] font-bold text-txt-primary group-hover:text-cyan transition-colors">{title}</p>
        <p className="mt-1 text-[12px] text-txt-muted leading-relaxed">{description}</p>
      </div>
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
