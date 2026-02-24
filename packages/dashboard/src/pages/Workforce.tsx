import { useState } from 'react';
import { useAgents } from '../lib/hooks';
import { DISPLAY_NAME_MAP, AGENT_META, SUB_TEAM, type Agent, type SubTeamMember } from '../lib/types';
import {
  Card,
  SectionHeader,
  AgentAvatar,
  StatusDot,
  Skeleton,
  timeAgo,
} from '../components/ui';
import { MdArrowForward } from 'react-icons/md';
import { Link } from 'react-router-dom';

/* ─── Org hierarchy ─────────────────────── */
const FOUNDERS = [
  { name: 'Kristina Denney', title: 'CEO & Co-Founder', initials: 'KD', color: '#DB2777', photo: '/kristina_headshot.jpg' },
  { name: 'Andrew Denney', title: 'COO & Co-Founder', initials: 'AD', color: '#2563EB', photo: '/andrew_headshot.jpg' },
];

const DEPARTMENTS = [
  { label: 'Engineering', role: 'cto' },
  { label: 'Product', role: 'cpo' },
  { label: 'Finance', role: 'cfo' },
  { label: 'Marketing', role: 'cmo' },
  { label: 'Customer Success', role: 'vp-customer-success' },
  { label: 'Sales', role: 'vp-sales' },
  { label: 'Design & Frontend', role: 'vp-design' },
];

const TITLE_MAP: Record<string, string> = {
  'chief-of-staff': 'Chief of Staff',
  cto: 'Chief Technology Officer',
  cpo: 'Chief Product Officer',
  cfo: 'Chief Financial Officer',
  cmo: 'Chief Marketing Officer',
  'vp-customer-success': 'VP Customer Success',
  'vp-sales': 'VP Sales',
  'vp-design': 'VP Design & Frontend',
  ops: 'Operations Agent',
};

const EXEC_COUNT = Object.keys(TITLE_MAP).length;
const TOTAL_HEADCOUNT = FOUNDERS.length + EXEC_COUNT + SUB_TEAM.length; // founders + execs + ICs

type ViewMode = 'org-chart' | 'grid';

export default function Workforce() {
  const { data: agents, loading } = useAgents();
  const [view, setView] = useState<ViewMode>('org-chart');

  const agentMap = new Map(agents.map((a) => [a.role, a]));
  const cos = agentMap.get('chief-of-staff');
  const activeCount = agents.filter((a) => a.status === 'active').length;
  const scored = agents.filter((a) => a.performance_score != null);
  const avgScore = scored.length ? Math.round(scored.reduce((s, a) => s + Number(a.performance_score) * 100, 0) / scored.length) : 0;

  return (
    <div className="space-y-8">
      {/* ── Header ─────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-txt-primary">Workforce</h1>
          <p className="mt-1 text-sm text-txt-muted">
            {TOTAL_HEADCOUNT} employees · {FOUNDERS.length} founders · {EXEC_COUNT} AI executives · {SUB_TEAM.length} team members
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/agents/new"
            className="rounded-lg border border-border bg-surface px-4 py-1.5 text-xs font-semibold text-txt-primary transition-all hover:border-border-hover hover:shadow-md"
          >
            + New Agent
          </Link>
          <div className="flex gap-1 rounded-lg border border-border bg-surface p-0.5">
          <button
            onClick={() => setView('org-chart')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              view === 'org-chart' ? 'bg-raised text-txt-primary' : 'text-txt-muted hover:text-txt-secondary'
            }`}
          >
            Org Chart
          </button>
          <button
            onClick={() => setView('grid')}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              view === 'grid' ? 'bg-raised text-txt-primary' : 'text-txt-muted hover:text-txt-secondary'
            }`}
          >
            Grid
          </button>
        </div>
        </div>
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
            <div className="relative h-10 w-full max-w-5xl">
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

          {/* Department columns with heads + sub-teams */}
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4 xl:grid-cols-7">
            {DEPARTMENTS.map((dept) => {
              const agent = agentMap.get(dept.role);
              const members = SUB_TEAM.filter((m) => m.reportsTo === dept.role);
              return (
                <div key={dept.label} className="flex flex-col items-center gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-widest text-txt-faint">
                    {dept.label}
                  </span>
                  {agent ? <AgentNode agent={agent} compact /> : <Skeleton className="h-20 w-full" />}
                  {/* Sub-team connector */}
                  {members.length > 0 && (
                    <div className="h-4 w-px bg-border" />
                  )}
                  {/* Sub-team members */}
                  <div className="flex w-full flex-col gap-1.5">
                    {members.map((m) => (
                      <SubTeamNode key={m.name} member={m} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ── Grid View ───────────────────── */
        <div>
          <SectionHeader title="Founders" />

          {/* Founders */}
          <div className="mb-6 grid grid-cols-2 gap-4">
            {FOUNDERS.map((f) => (
              <Card key={f.name} className="relative overflow-hidden">
                <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl" style={{ background: f.color }} />
                <div className="flex items-center gap-4 pl-3">
                  <img
                    src={f.photo}
                    alt={f.name}
                    className="rounded-full object-cover"
                    style={{ width: 60, height: 60, border: `1.5px solid ${f.color}40` }}
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

          <SectionHeader title="AI Executives" />

          {/* Agent grid */}
          <div className="mb-6 grid grid-cols-2 gap-4">
            {agents
              .sort((a, b) => {
                const order = ['chief-of-staff', 'cto', 'cpo', 'cfo', 'cmo', 'vp-customer-success', 'vp-sales', 'vp-design'];
                return order.indexOf(a.role) - order.indexOf(b.role);
              })
              .map((agent) => {
                const meta = AGENT_META[agent.role];
                return (
                  <Card key={agent.id} className="group relative overflow-hidden">
                    <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl" style={{ background: meta?.color ?? '#64748b' }} />
                    <div className="flex items-start gap-4 pl-3">
                      <AgentAvatar role={agent.role} size={60} glow={agent.status === 'active'} />
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
                          <span className="font-mono text-sm text-txt-secondary">
                            {agent.performance_score != null ? `${Math.round(Number(agent.performance_score) * 100)}/100` : '—'}
                          </span>
                          <span className="text-[10px] text-txt-faint">Last run: {timeAgo(agent.last_run_at)}</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Link
                          to={`/chat/${agent.role}`}
                          className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-txt-muted transition-colors hover:border-border-hover hover:text-txt-primary"
                        >
                          <span className="flex items-center gap-1">Chat <MdArrowForward /></span>
                        </Link>
                        <Link
                          to={`/agents/${agent.role}`}
                          className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-txt-muted transition-colors hover:border-border-hover hover:text-txt-primary"
                        >
                          Settings
                        </Link>
                      </div>
                    </div>
                  </Card>
                );
              })}
          </div>

          <SectionHeader title={`Team Members (${SUB_TEAM.length})`} />

          {/* Sub-team grid */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {SUB_TEAM.map((m) => (
              <Card key={m.name} className="relative overflow-hidden">
                <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl" style={{ background: m.color }} />
                <div className="flex items-center gap-3 pl-3">
                  <img
                    src={`/avatars/${m.avatar}.png`}
                    alt={m.name}
                    className="rounded-full object-cover"
                    style={{ width: 48, height: 48, border: `1.5px solid ${m.color}40` }}
                  />
                  <div>
                    <h3 className="text-[13px] font-semibold text-txt-primary">{m.name}</h3>
                    <p className="text-[11px] text-txt-muted">{m.title}</p>
                    <p className="mt-0.5 text-[10px] text-txt-faint">{m.department} · Reports to {DISPLAY_NAME_MAP[m.reportsTo]}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Founder Node (org chart) ────────────── */
function FounderNode({ name, title, initials, color, photo }: { name: string; title: string; initials: string; color: string; photo: string }) {
  return (
    <Card className="w-64 text-center p-5">
      <div className="flex flex-col items-center gap-3">
        <img
          src={photo}
          alt={name}
          className="rounded-full object-cover"
          style={{ width: 88, height: 88, border: `2px solid ${color}50` }}
        />
        <div>
          <h3 className="text-base font-semibold text-txt-primary">{name}</h3>
          <p className="text-xs text-txt-muted">{title}</p>
          <span
            className="mt-1 inline-block rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 border border-emerald-500/20">
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
    <Link to={`/agents/${agent.role}`} className="block transition-transform hover:scale-[1.02]">
      <Card className={`${compact ? 'p-4' : 'p-5'} text-center`}>
        <div className="flex flex-col items-center gap-2">
          <AgentAvatar role={agent.role} size={compact ? 64 : 80} glow={agent.status === 'active'} />
          <div>
            <div className="flex items-center justify-center gap-1.5">
              <h3 className={`font-semibold text-txt-primary ${compact ? 'text-sm' : 'text-base'}`}>
                {DISPLAY_NAME_MAP[agent.role] ?? agent.role}
              </h3>
              <StatusDot status={agent.status} />
            </div>
            <p className={`text-txt-muted ${compact ? 'text-xs' : 'text-sm'}`}>
              {TITLE_MAP[agent.role] ?? agent.role}
            </p>
            <div className={`mt-2 flex items-center justify-center gap-2 ${compact ? 'text-xs' : 'text-sm'}`}>
              <span className="font-mono text-txt-faint">
                {agent.performance_score != null ? `${Math.round(Number(agent.performance_score) * 100)}/100` : '—'}
              </span>
            </div>
            {!compact && (
              <p className="mt-1 text-xs text-txt-faint">Last run: {timeAgo(agent.last_run_at)}</p>
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

/* ─── Sub-Team Node (org chart) ───────────── */
function SubTeamNode({ member }: { member: SubTeamMember }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-3">
        <img
          src={`/avatars/${member.avatar}.png`}
          alt={member.name}
          className="shrink-0 rounded-full object-cover"
          style={{ width: 48, height: 48, border: `1.5px solid ${member.color}40` }}
        />
        <div className="min-w-0 text-left">
          <p className="truncate text-sm font-semibold text-txt-primary">{member.name}</p>
          <p className="truncate text-xs text-txt-muted">{member.title}</p>
        </div>
      </div>
    </Card>
  );
}
