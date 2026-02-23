import { MdCheckCircle } from 'react-icons/md';
import { useAgents, useDecisions, useActivity, useProducts } from '../lib/hooks';
import { DISPLAY_NAME_MAP, AGENT_META, TIER_TO_IMPACT } from '../lib/types';
import {
  Card,
  SectionHeader,
  AgentAvatar,
  StatusDot,
  ImpactBadge,
  Sparkline,
  Skeleton,
  timeAgo,
} from '../components/ui';
import { SystemHealth } from '../components/SystemHealth';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const { data: agents, loading: agentsLoading } = useAgents();
  const { data: decisions, loading: decisionsLoading } = useDecisions();
  const { data: activity, loading: activityLoading } = useActivity(15);
  const { data: products } = useProducts();

  const activeAgents = agents.filter((a) => a.status === 'active').length;
  const pendingDecisions = decisions.filter((d) => d.status === 'pending').length;
  const avgScore = agents.length
    ? Math.round(agents.reduce((s, a) => s + (a.performance_score != null ? Number(a.performance_score) * 100 : 0), 0) / agents.length)
    : 0;

  return (
    <div className="space-y-8">
      {/* ── Header ──────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-txt-primary">Command Center</h1>
        <p className="mt-1 text-sm text-txt-muted">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* ── Metric Cards ────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="Active Agents" value={`${activeAgents}/${agents.length}`} sub="online now" color="#00E0FF" sparkData={[3,5,4,7,6,7,7]} loading={agentsLoading} />
        <MetricCard label="Pending Decisions" value={String(pendingDecisions)} sub="awaiting review" color="#0097FF" sparkData={[2,3,1,4,2,3,pendingDecisions]} loading={decisionsLoading} />
        <MetricCard label="Avg Agent Score" value={`${avgScore}/100`} sub="across all agents" color="#623CEA" sparkData={[70,72,68,75,80,78,avgScore]} loading={agentsLoading} />
        <MetricCard label="Products" value={String(products.length)} sub={products.map(p=>p.name).join(', ') || '—'} color="#4B9FE1" sparkData={[1,1,1,2,2,2,products.length]} loading={false} />
      </div>

      {/* ── System Health (from Atlas) ─────── */}
      <SystemHealth />

      <div className="grid grid-cols-3 gap-6">
        {/* ── Agent Constellation ─────────── */}
        <Card className="col-span-2">
          <SectionHeader
            title="Agent Constellation"
            action={
              <Link to="/workforce" className="text-xs text-txt-muted hover:text-txt-primary hover:underline dark:text-cyan dark:hover:text-cyan">
                View all →
              </Link>
            }
          />
          {agentsLoading ? (
            <div className="grid grid-cols-4 gap-3">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {agents.map((agent) => (
                <Link
                  key={agent.id}
                  to={`/chat/${agent.role}`}
                  className="glass-card group flex flex-col items-center gap-3 rounded-xl border border-border bg-raised dark:bg-transparent p-6 transition-all hover:border-border-hover hover:shadow-lg"
                >
                  <AgentAvatar role={agent.role} size={72} glow={agent.status === 'active'} />
                  <div className="text-center">
                    <p className="text-[13px] font-semibold text-txt-secondary group-hover:text-txt-primary transition-colors">
                      {DISPLAY_NAME_MAP[agent.role] ?? agent.role}
                    </p>
                    <p className="text-[11px] text-txt-muted">{agent.role}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusDot status={agent.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* ── Activity Feed ──────────────── */}
        <Card>
          <SectionHeader title="Activity" />
          {activityLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <p className="py-8 text-center text-sm text-txt-faint">No recent activity</p>
          ) : (
            <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
              {activity.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-[var(--color-hover-bg)]"
                >
                  {entry.agent_id && (
                    <AgentAvatar role={entry.agent_id} size={24} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-txt-secondary line-clamp-2">
                      {entry.action}
                    </p>
                    {entry.detail && (
                      <p className="mt-0.5 text-[11px] text-txt-faint line-clamp-1">
                        {entry.detail}
                      </p>
                    )}
                  </div>
                  <span className="flex-shrink-0 text-[10px] text-txt-faint">
                    {timeAgo(entry.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Pending Decisions ─────────────── */}
      <Card>
        <SectionHeader
          title="Decision Queue"
          action={
            <Link to="/approvals" className="text-xs text-txt-muted hover:text-txt-primary hover:underline dark:text-cyan dark:hover:text-cyan">
              View all →
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
            No pending decisions — all clear <MdCheckCircle className="inline h-4 w-4 text-tier-green" />
          </p>
        ) : (
          <div className="space-y-2">
            {decisions
              .filter((d) => d.status === 'pending')
              .slice(0, 5)
              .map((d) => (
                <div
                  key={d.id}
                  className="glass-raised flex items-center gap-4 rounded-lg border border-border bg-raised dark:bg-transparent px-4 py-3"
                >
                  <AgentAvatar role={d.proposed_by} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-txt-secondary">{d.title}</p>
                    <p className="text-[11px] text-txt-muted line-clamp-1">{d.summary}</p>
                  </div>
                  <ImpactBadge impact={TIER_TO_IMPACT[d.tier] ?? d.tier} />
                  <span className="text-[10px] text-txt-faint">{timeAgo(d.created_at)}</span>
                </div>
              ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── Metric Card Component ─────────────────── */
function MetricCard({
  label,
  value,
  sub,
  color,
  sparkData,
  loading,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  sparkData: number[];
  loading: boolean;
}) {
  if (loading) return <Skeleton className="h-28" />;

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">{label}</p>
        <Sparkline data={sparkData} color={color} width={60} height={20} />
      </div>
      <p className="font-mono text-2xl font-semibold text-txt-primary">{value}</p>
      <p className="text-[11px] text-txt-faint">{sub}</p>
    </Card>
  );
}
