import { useAgents, useDecisions, useActivity, useProducts } from '../lib/hooks';
import { CODENAME_MAP, AGENT_META } from '../lib/types';
import {
  Card,
  SectionHeader,
  AgentAvatar,
  TierBadge,
  StatusDot,
  ImpactBadge,
  Sparkline,
  Skeleton,
  timeAgo,
} from '../components/ui';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const { data: agents, loading: agentsLoading } = useAgents();
  const { data: decisions, loading: decisionsLoading } = useDecisions();
  const { data: activity, loading: activityLoading } = useActivity(15);
  const { data: products } = useProducts();

  const activeAgents = agents.filter((a) => a.status === 'active').length;
  const pendingDecisions = decisions.filter((d) => d.status === 'pending').length;
  const avgScore = agents.length
    ? Math.round(agents.reduce((s, a) => s + a.score, 0) / agents.length)
    : 0;

  return (
    <div className="space-y-8">
      {/* ── Header ──────────────────────────── */}
      <div>
        <h1 className="font-serif text-2xl text-slate-50">Command Center</h1>
        <p className="mt-1 text-sm text-slate-500">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* ── Metric Cards ────────────────────── */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="Active Agents" value={`${activeAgents}/${agents.length}`} sub="online now" color="#8b5cf6" sparkData={[3,5,4,7,6,7,7]} loading={agentsLoading} />
        <MetricCard label="Pending Decisions" value={String(pendingDecisions)} sub="awaiting review" color="#f59e0b" sparkData={[2,3,1,4,2,3,pendingDecisions]} loading={decisionsLoading} />
        <MetricCard label="Avg Agent Score" value={`${avgScore}/100`} sub="across all agents" color="#22c55e" sparkData={[70,72,68,75,80,78,avgScore]} loading={agentsLoading} />
        <MetricCard label="Products" value={String(products.length)} sub={products.map(p=>p.name).join(', ') || '—'} color="#06b6d4" sparkData={[1,1,1,2,2,2,products.length]} loading={false} />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* ── Agent Constellation ─────────── */}
        <Card className="col-span-2">
          <SectionHeader
            title="Agent Constellation"
            action={
              <Link to="/workforce" className="text-xs text-violet hover:underline">
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
                  className="group flex flex-col items-center gap-2 rounded-xl border border-border bg-raised p-4 transition-all hover:border-border-hover hover:shadow-lg"
                >
                  <AgentAvatar role={agent.role} size={40} glow={agent.status === 'active'} />
                  <div className="text-center">
                    <p className="text-[13px] font-semibold text-slate-200 group-hover:text-violet transition-colors">
                      {CODENAME_MAP[agent.role] ?? agent.codename}
                    </p>
                    <p className="text-[11px] text-slate-500">{agent.role}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusDot status={agent.status} />
                    <TierBadge tier={agent.tier} />
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
            <p className="py-8 text-center text-sm text-slate-600">No recent activity</p>
          ) : (
            <div className="space-y-1 max-h-[420px] overflow-y-auto pr-1">
              {activity.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-white/[.02]"
                >
                  {entry.agent_id && (
                    <AgentAvatar role={entry.agent_id} size={24} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-slate-300 line-clamp-2">
                      {entry.action}
                    </p>
                    {entry.detail && (
                      <p className="mt-0.5 text-[11px] text-slate-600 line-clamp-1">
                        {entry.detail}
                      </p>
                    )}
                  </div>
                  <span className="flex-shrink-0 text-[10px] text-slate-600">
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
            <Link to="/approvals" className="text-xs text-violet hover:underline">
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
          <p className="py-8 text-center text-sm text-slate-600">
            No pending decisions — all clear ✓
          </p>
        ) : (
          <div className="space-y-2">
            {decisions
              .filter((d) => d.status === 'pending')
              .slice(0, 5)
              .map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-4 rounded-lg border border-border bg-raised px-4 py-3"
                >
                  <AgentAvatar role={d.agent_id} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-slate-200">{d.title}</p>
                    <p className="text-[11px] text-slate-500 line-clamp-1">{d.description}</p>
                  </div>
                  <ImpactBadge impact={d.impact} />
                  <span className="text-[10px] text-slate-600">{timeAgo(d.created_at)}</span>
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
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
        <Sparkline data={sparkData} color={color} width={60} height={20} />
      </div>
      <p className="font-mono text-2xl font-semibold text-slate-100">{value}</p>
      <p className="text-[11px] text-slate-600">{sub}</p>
    </Card>
  );
}
