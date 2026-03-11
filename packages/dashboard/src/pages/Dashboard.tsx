import { MdCheckCircle, MdSearch, MdDescription, MdChat, MdArrowForward, MdWarning } from 'react-icons/md';
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
        <div className="dashboard-home-main space-y-4">
          <Card accent="0,224,255" glow className="banner">
            <div className="flex items-center justify-between gap-6">
              <div>
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
                iconBg="rgba(0, 224, 255, 0.15)"
                iconColor="#00E0FF"
                accent="0,224,255"
                title="Start New Research"
                description="Launch AI-powered analysis and intelligence gathering"
              />
              <QuickActionCard
                to="/strategy"
                icon={<MdDescription className="h-6 w-6" />}
                iconBg="rgba(0, 163, 255, 0.15)"
                iconColor="#00A3FF"
                accent="0,163,255"
                title="View Reports"
                description="Access your saved analysis reports and insights"
              />
              <QuickActionCard
                to="/chat"
                icon={<MdChat className="h-6 w-6" />}
                iconBg="rgba(52, 211, 153, 0.15)"
                iconColor="#34D399"
                accent="52,211,153"
                title="Chat with Agents"
                description="Talk to your AI executive team directly"
              />
            </div>
          </div>

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
                    <InnerCard className="flex flex-col items-center gap-2 px-3 py-3 transition-transform duration-200 group-hover:-translate-y-0.5">
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
    <Card accent={accent} className="stat-card relative min-h-[124px] overflow-hidden">
      <div className="stat-card-shine" aria-hidden="true" />
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-txt-faint">{label}</p>
      <p className="mt-4 font-mono text-3xl font-bold tracking-tight text-txt-primary">{value}</p>
      <p className="mt-2 text-[12px] text-txt-muted">{hint}</p>
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
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg transition-transform duration-200 group-hover:scale-110" style={{ background: iconBg, color: iconColor, boxShadow: `0 4px 16px ${iconBg}` }}>
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


