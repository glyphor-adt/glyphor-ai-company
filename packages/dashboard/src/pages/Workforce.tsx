import { useAgents } from '../lib/hooks';
import { CODENAME_MAP, AGENT_META } from '../lib/types';
import {
  Card,
  SectionHeader,
  AgentAvatar,
  TierBadge,
  StatusDot,
  Skeleton,
  timeAgo,
} from '../components/ui';
import { Link } from 'react-router-dom';

const DEPT_ORDER = ['chief-of-staff', 'cto', 'cpo', 'cfo', 'cmo', 'vp-cs', 'vp-sales'];

export default function Workforce() {
  const { data: agents, loading } = useAgents();

  // Sort by role order
  const sorted = [...agents].sort(
    (a, b) => DEPT_ORDER.indexOf(a.role) - DEPT_ORDER.indexOf(b.role),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl text-slate-50">Workforce</h1>
        <p className="mt-1 text-sm text-slate-500">
          {agents.length} agents · {agents.filter((a) => a.status === 'active').length} active
        </p>
      </div>

      {/* ── Stats Row ─────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Active"
          value={agents.filter((a) => a.status === 'active').length}
          total={agents.length}
          color="bg-tier-green"
          loading={loading}
        />
        <StatCard
          label="Avg Score"
          value={agents.length ? Math.round(agents.reduce((s, a) => s + a.score, 0) / agents.length) : 0}
          total={100}
          color="bg-violet"
          loading={loading}
        />
        <StatCard
          label="Red Tier"
          value={agents.filter((a) => a.tier === 'red').length}
          total={agents.length}
          color="bg-tier-red"
          loading={loading}
        />
      </div>

      {/* ── Agent Grid ────────────────────── */}
      <div>
        <SectionHeader title="All Agents" />
        {loading ? (
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {sorted.map((agent) => {
              const meta = AGENT_META[agent.role];
              return (
                <Card key={agent.id} className="group relative overflow-hidden">
                  {/* Accent stripe */}
                  <div
                    className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
                    style={{ background: meta?.color ?? '#64748b' }}
                  />

                  <div className="flex items-start gap-4 pl-3">
                    <AgentAvatar role={agent.role} size={44} glow={agent.status === 'active'} />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[15px] font-semibold text-slate-100">
                          {CODENAME_MAP[agent.role] ?? agent.codename}
                        </h3>
                        <StatusDot status={agent.status} />
                      </div>
                      <p className="text-[12px] text-slate-500">{agent.role} · {agent.department}</p>
                      <p className="mt-0.5 text-[11px] text-slate-600">
                        Model: <span className="font-mono text-slate-500">{agent.model}</span>
                      </p>

                      <div className="mt-3 flex items-center gap-4">
                        <TierBadge tier={agent.tier} />
                        <span className="font-mono text-sm text-slate-300">{agent.score}/100</span>
                        <span className="text-[10px] text-slate-600">
                          Last run: {timeAgo(agent.last_run)}
                        </span>
                      </div>
                    </div>

                    <Link
                      to={`/chat/${agent.role}`}
                      className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-slate-400 transition-colors hover:border-violet hover:text-violet"
                    >
                      Chat →
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  total,
  color,
  loading,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  loading: boolean;
}) {
  if (loading) return <Skeleton className="h-20" />;
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <Card>
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-slate-100">
        {value}
        <span className="text-sm text-slate-600">/{total}</span>
      </p>
      <div className="mt-2 h-1.5 w-full rounded-full bg-white/5">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </Card>
  );
}
