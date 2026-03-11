import { MdCheckCircle, MdSearch, MdDescription, MdChat, MdArrowForward, MdWarning, MdGavel, MdReportProblem, MdWidgets, MdSmartToy } from 'react-icons/md';
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
import { apiCall } from '../lib/firebase';
import { useAuth } from '../lib/auth';

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
  const [runningAgents, setRunningAgents] = useState<RunningAgent[]>([]);

  const pendingDecisions = decisions.filter((d) => d.status === 'pending').length;

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
        <div className="dashboard-home-main space-y-5">
          <div className="banner-wrapper">
            <div className="banner-inner rounded-[24px] p-7">
              <h1 className="text-[1.75rem] font-bold text-white md:text-[2.25rem] leading-tight">
                {greeting}, {firstName}
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] text-white/60">
                Welcome back to Glyphor AI. Ready to discover new insights?
              </p>
              <p className="mt-4 text-[13px] text-white/35 font-medium">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                {' · '}
                {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <MetricCard
              label="Pending Decisions"
              value={String(pendingDecisions)}
              hint="Awaiting founder review"
              gradient="stat-gradient-blue"
              icon={<MdGavel className="h-5 w-5" />}
            />
            <MetricCard
              label="Open Incidents"
              value={String(incidents.length)}
              hint={incidentsLoading ? 'Checking now' : (incidents[0]?.severity ?? 'stable')}
              gradient="stat-gradient-amber"
              icon={<MdReportProblem className="h-5 w-5" />}
            />
            <MetricCard
              label="Products Online"
              value={String(productCount)}
              hint="Tracked in cockpit"
              gradient="stat-gradient-teal"
              icon={<MdWidgets className="h-5 w-5" />}
            />
            <MetricCard
              label="Agents Running"
              value={String(runningAgents.length)}
              hint="Live workload"
              gradient="stat-gradient-green"
              icon={<MdSmartToy className="h-5 w-5" />}
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
            <h2 className="text-lg font-bold text-txt-primary mb-3">Quick Actions</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <QuickActionCard
                to="/strategy"
                icon={<MdSearch className="h-7 w-7" />}
                iconBg="rgba(0, 224, 255, 0.2)"
                iconColor="#00E0FF"
                accent="0,224,255"
                title="Start New Research"
                description="Launch AI-powered analysis and intelligence gathering"
              />
              <QuickActionCard
                to="/strategy"
                icon={<MdDescription className="h-7 w-7" />}
                iconBg="rgba(0, 163, 255, 0.2)"
                iconColor="#00A3FF"
                accent="0,163,255"
                title="View Reports"
                description="Access your saved analysis reports and insights"
              />
              <QuickActionCard
                to="/chat"
                icon={<MdChat className="h-7 w-7" />}
                iconBg="rgba(52, 211, 153, 0.2)"
                iconColor="#34D399"
                accent="52,211,153"
                title="Chat with Agents"
                description="Talk to your AI executive team directly"
              />
            </div>
          </div>

          <div className="workforce-section rounded-[24px] border border-white/[0.06] p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-txt-primary">AI Workforce</h2>
              <Link to="/workforce" className="text-[13px] text-txt-faint hover:text-txt-secondary transition-colors">
                <span className="flex items-center gap-1">Meet the team <MdArrowForward /></span>
              </Link>
            </div>
            {agentsLoading ? (
              <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-24" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6">
                {agents.slice(0, 12).map((agent) => (
                  <Link
                    key={agent.id}
                    to={`/chat/${agent.role}`}
                    className="group block"
                  >
                    <div className="workforce-avatar-card flex flex-col items-center gap-2.5 rounded-[18px] px-3 py-4 transition-all duration-200 group-hover:-translate-y-1">
                      <AgentAvatar role={agent.role} size={48} glow={agent.status === 'active'} avatarUrl={agent.avatar_url} />
                      <p className="text-center text-[11px] font-medium leading-tight text-white/50 transition-colors group-hover:text-white/80">
                        {DISPLAY_NAME_MAP[agent.role] ?? agent.display_name ?? agent.role}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="dashboard-home-side space-y-5">
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
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(239,68,68,0.15)] text-[#EF4444]">
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
  gradient,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  gradient: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={`stat-card-gradient ${gradient} relative min-h-[150px] overflow-hidden rounded-[24px] p-5`}>
      <div className="stat-card-gradient-shine" aria-hidden="true" />
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/70">{label}</p>
        <div className="stat-card-icon-badge">
          {icon}
        </div>
      </div>
      <p className="mt-5 font-mono text-[2.25rem] font-extrabold tracking-tight text-white drop-shadow-sm">{value}</p>
      <p className="mt-1.5 text-[12px] font-medium text-white/50">{hint}</p>
    </div>
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
      <Card accent={accent} interactive className="quick-action-card flex h-full flex-col gap-5">
        <div className="quick-action-icon flex h-[52px] w-[52px] items-center justify-center rounded-[16px]" style={{ background: iconColor, color: '#000', boxShadow: `0 8px 24px ${iconColor}44` }}>
          {icon}
        </div>
        <div>
          <p className="text-[15px] font-bold text-txt-primary">{title}</p>
          <p className="mt-1.5 text-[13px] text-txt-muted leading-relaxed">{description}</p>
        </div>
      </Card>
    </Link>
  );
}


