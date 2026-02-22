import { useState } from 'react';
import { useAgents } from '../lib/hooks';
import { DISPLAY_NAME_MAP, AGENT_META, type Agent } from '../lib/types';
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

/* ─── Org hierarchy ─────────────────────── */
const FOUNDERS = [
  { name: 'Kristina Denney', title: 'CEO & Co-Founder', initials: 'KD', color: '#E040FB', photo: '/kristina_headshot.jpg' },
  { name: 'Andrew Denney', title: 'COO & Co-Founder', initials: 'AD', color: '#00E0FF', photo: '/andrew_headshot.jpg' },
];

const DEPARTMENTS = [
  { label: 'Engineering', roles: ['cto'] },
  { label: 'Product', roles: ['cpo'] },
  { label: 'Finance', roles: ['cfo'] },
  { label: 'Marketing', roles: ['cmo'] },
  { label: 'Customer Success', roles: ['vp-customer-success'] },
  { label: 'Sales', roles: ['vp-sales'] },
];

const TITLE_MAP: Record<string, string> = {
  'chief-of-staff': 'Chief of Staff',
  cto: 'Chief Technology Officer',
  cpo: 'Chief Product Officer',
  cfo: 'Chief Financial Officer',
  cmo: 'Chief Marketing Officer',
  'vp-customer-success': 'VP Customer Success',
  'vp-sales': 'VP Sales',
};

type ViewMode = 'org-chart' | 'grid';

export default function Workforce() {
  const { data: agents, loading } = useAgents();
  const [view, setView] = useState<ViewMode>('org-chart');

  const agentMap = new Map(agents.map((a) => [a.role, a]));
  const cos = agentMap.get('chief-of-staff');
  const activeCount = agents.filter((a) => a.status === 'active').length;
  const scored = agents.filter((a) => typeof a.score === 'number' && !isNaN(a.score));
  const avgScore = scored.length ? Math.round(scored.reduce((s, a) => s + a.score, 0) / scored.length) : 0;

  return (
    <div className="space-y-8">
      {/* ── Header ─────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-txt-primary">Workforce</h1>
          <p className="mt-1 text-sm text-txt-muted">
            {FOUNDERS.length} founders · {agents.length} AI executives · {activeCount} active
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-surface p-0.5">
          <button
            onClick={() => setView('org-chart')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              view === 'org-chart' ? 'bg-cyan/15 text-cyan' : 'text-txt-muted hover:text-txt-secondary'
            }`}
          >
            Org Chart
          </button>
          <button
            onClick={() => setView('grid')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              view === 'grid' ? 'bg-cyan/15 text-cyan' : 'text-txt-muted hover:text-txt-secondary'
            }`}
          >
            Grid
          </button>
        </div>
      </div>

      {/* ── Stats Row ─────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Active" value={activeCount} total={agents.length} color="bg-tier-green" loading={loading} />
        <StatCard label="Avg Score" value={avgScore} total={100} color="bg-cyan" loading={loading} />
        <StatCard label="Red Tier" value={agents.filter((a) => a.tier === 'red').length} total={agents.length} color="bg-tier-red" loading={loading} />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : view === 'org-chart' ? (
        /* ── Org Chart View ──────────────── */
        <div className="space-y-0">
          {/* Founders row */}
          <div className="flex justify-center gap-8">
            {FOUNDERS.map((f) => (
              <FounderNode key={f.name} name={f.name} title={f.title} initials={f.initials} color={f.color} photo={f.photo} />
            ))}
          </div>

          {/* Connector: founders → CoS */}
          <div className="flex justify-center">
            <div className="relative h-10 w-[260px]">
              <div className="absolute left-1/4 top-0 h-4 w-px bg-border" />
              <div className="absolute right-1/4 top-0 h-4 w-px bg-border" />
              <div className="absolute left-1/4 top-4 h-px bg-border" style={{ width: '50%' }} />
              <div className="absolute left-1/2 top-4 h-6 w-px bg-border" />
            </div>
          </div>

          {/* Chief of Staff */}
          <div className="flex justify-center">
            {cos ? <AgentNode agent={cos} /> : <Skeleton className="h-24 w-72" />}
          </div>

          {/* Connector: CoS → departments */}
          <div className="flex justify-center">
            <div className="relative h-10 w-full max-w-4xl">
              <div className="absolute left-1/2 top-0 h-4 w-px bg-border" />
              <div className="absolute left-[8.3%] top-4 h-px bg-border" style={{ width: '83.4%' }} />
              {DEPARTMENTS.map((_, i) => (
                <div
                  key={i}
                  className="absolute top-4 h-6 w-px bg-border"
                  style={{ left: `${8.3 + i * (83.4 / 5)}%` }}
                />
              ))}
            </div>
          </div>

          {/* Department row */}
          <div className="grid grid-cols-3 gap-4 xl:grid-cols-6">
            {DEPARTMENTS.map((dept) => {
              const agent = agentMap.get(dept.roles[0]);
              return (
                <div key={dept.label} className="flex flex-col items-center gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-widest text-txt-faint">
                    {dept.label}
                  </span>
                  {agent ? <AgentNode agent={agent} compact /> : <Skeleton className="h-20 w-full" />}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ── Grid View ───────────────────── */
        <div>
          <SectionHeader title="All Employees" />

          {/* Founders */}
          <div className="mb-4 grid grid-cols-2 gap-4">
            {FOUNDERS.map((f) => (
              <Card key={f.name} className="relative overflow-hidden">
                <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl" style={{ background: f.color }} />
                <div className="flex items-center gap-4 pl-3">
                  <img
                    src={f.photo}
                    alt={f.name}
                    className="rounded-full object-cover"
                    style={{ width: 44, height: 44, border: `1.5px solid ${f.color}40` }}
                  />
                  <div>
                    <h3 className="text-[15px] font-semibold text-txt-primary">{f.name}</h3>
                    <p className="text-[12px] text-txt-muted">{f.title}</p>
                    <p className="mt-0.5 text-[11px] text-txt-faint">Human · Founder</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Agent grid */}
          <div className="grid grid-cols-2 gap-4">
            {agents
              .sort((a, b) => {
                const order = ['chief-of-staff', 'cto', 'cpo', 'cfo', 'cmo', 'vp-customer-success', 'vp-sales'];
                return order.indexOf(a.role) - order.indexOf(b.role);
              })
              .map((agent) => {
                const meta = AGENT_META[agent.role];
                return (
                  <Card key={agent.id} className="group relative overflow-hidden">
                    <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl" style={{ background: meta?.color ?? '#64748b' }} />
                    <div className="flex items-start gap-4 pl-3">
                      <AgentAvatar role={agent.role} size={44} glow={agent.status === 'active'} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-[15px] font-semibold text-txt-primary">{DISPLAY_NAME_MAP[agent.role] ?? agent.role}</h3>
                          <StatusDot status={agent.status} />
                        </div>
                        <p className="text-[12px] text-txt-muted">{TITLE_MAP[agent.role] ?? agent.role}</p>
                        <p className="mt-0.5 text-[11px] text-txt-faint">
                          AI Agent · <span className="font-mono text-txt-muted">{agent.model}</span>
                        </p>
                        <div className="mt-3 flex items-center gap-4">
                          <TierBadge tier={agent.tier} />
                          <span className="font-mono text-sm text-txt-secondary">{agent.score}/100</span>
                          <span className="text-[10px] text-txt-faint">Last run: {timeAgo(agent.last_run)}</span>
                        </div>
                      </div>
                      <Link
                        to={`/chat/${agent.role}`}
                        className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-txt-muted transition-colors hover:border-cyan hover:text-cyan"
                      >
                        Chat →
                      </Link>
                    </div>
                  </Card>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Founder Node (org chart) ────────────── */
function FounderNode({ name, title, initials, color, photo }: { name: string; title: string; initials: string; color: string; photo: string }) {
  return (
    <Card className="w-56 text-center">
      <div className="flex flex-col items-center gap-2">
        <img
          src={photo}
          alt={name}
          className="rounded-full object-cover"
          style={{ width: 48, height: 48, border: `2px solid ${color}50` }}
        />
        <div>
          <h3 className="text-sm font-semibold text-txt-primary">{name}</h3>
          <p className="text-[11px] text-txt-muted">{title}</p>
          <span className="mt-1 inline-block rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/20">
            Human
          </span>
        </div>
      </div>
    </Card>
  );
}

/* ─── Agent Node (org chart) ──────────────── */
function AgentNode({ agent, compact = false }: { agent: Agent; compact?: boolean }) {
  const meta = AGENT_META[agent.role];
  return (
    <Link to={`/chat/${agent.role}`} className="block transition-transform hover:scale-[1.02]">
      <Card className={`${compact ? 'p-3' : 'p-4'} text-center`}>
        <div className="flex flex-col items-center gap-2">
          <AgentAvatar role={agent.role} size={compact ? 36 : 44} glow={agent.status === 'active'} />
          <div>
            <div className="flex items-center justify-center gap-1.5">
              <h3 className={`font-semibold text-txt-primary ${compact ? 'text-xs' : 'text-sm'}`}>
                {DISPLAY_NAME_MAP[agent.role] ?? agent.role}
              </h3>
              <StatusDot status={agent.status} />
            </div>
            <p className={`text-txt-muted ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
              {TITLE_MAP[agent.role] ?? agent.role}
            </p>
            <div className={`mt-1.5 flex items-center justify-center gap-2 ${compact ? 'text-[10px]' : 'text-xs'}`}>
              <TierBadge tier={agent.tier} />
              <span className="font-mono text-txt-faint">{agent.score}/100</span>
            </div>
            {!compact && (
              <p className="mt-1 text-[10px] text-txt-faint">Last run: {timeAgo(agent.last_run)}</p>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

/* ─── Stats Card ──────────────────────────── */
function StatCard({ label, value, total, color, loading }: { label: string; value: number; total: number; color: string; loading: boolean }) {
  if (loading) return <Skeleton className="h-20" />;
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <Card>
      <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-txt-primary">
        {value}
        <span className="text-sm text-txt-faint">/{total}</span>
      </p>
      <div className="mt-2 h-1.5 w-full rounded-full bg-border">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </Card>
  );
}
