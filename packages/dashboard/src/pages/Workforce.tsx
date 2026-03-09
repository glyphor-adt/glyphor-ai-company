import { useState } from 'react';
import { useAgents } from '../lib/hooks';
import { DISPLAY_NAME_MAP, AGENT_META, type Agent } from '../lib/types';
import {
  Card,
  SectionHeader,
  AgentAvatar,
  StatusDot,
  Skeleton,
  timeAgo,
  PageTabs,
} from '../components/ui';
import { MdArrowForward } from 'react-icons/md';
import { Link } from 'react-router-dom';
import AgentsList from './AgentsList';

/* ─── Org hierarchy ─────────────────────── */
const FOUNDERS = [
  { name: 'Kristina Denney', title: 'CEO & Co-Founder', initials: 'KD', color: '#DB2777', photo: '/kristina_headshot.jpg' },
  { name: 'Andrew Zwelling', title: 'COO & Co-Founder', initials: 'AZ', color: '#2563EB', photo: '/andrew_headshot.jpg' },
];

const DEPARTMENTS = [
  { label: 'Engineering', role: 'cto' },
  { label: 'Product', role: 'cpo' },
  { label: 'Finance', role: 'cfo' },
  { label: 'Marketing', role: 'cmo' },
  { label: 'Sales', role: 'vp-sales' },
  { label: 'Design & Frontend', role: 'vp-design' },
  { label: 'Operations & IT', role: 'ops' },
  { label: 'Legal', role: 'clo' },
  { label: 'Research', role: 'vp-research' },
  { label: 'People & Culture', role: 'head-of-hr' },
];

const TITLE_MAP: Record<string, string> = {
  'chief-of-staff': 'Chief of Staff',
  cto: 'Chief Technology Officer',
  cpo: 'Chief Product Officer',
  cfo: 'Chief Financial Officer',
  cmo: 'Chief Marketing Officer',
  'vp-sales': 'VP Sales',
  'vp-design': 'VP Design & Frontend',
  ops: 'Operations Agent',
  clo: 'Chief Legal Officer',
  'vp-research': 'VP Research & Intelligence',
  'competitive-research-analyst': 'Competitive Research Analyst',
  'market-research-analyst': 'Market Research Analyst',
  'technical-research-analyst': 'Technical Research Analyst',
  'industry-research-analyst': 'Industry Research Analyst',
  'm365-admin': 'M365 Administrator',
  'global-admin': 'Global Administrator',
  'head-of-hr': 'Head of People & Culture',
};

type ViewMode = 'org-chart' | 'grid';
type Tab = 'overview' | 'roster';

export default function Workforce() {
  const { data: agents, loading } = useAgents();
  const [view, setView] = useState<ViewMode>('org-chart');
  const [tab, setTab] = useState<Tab>('overview');

  const agentMap = new Map(agents.map((a) => [a.role, a]));
  const cos = agentMap.get('chief-of-staff');
  const executiveAgents = agents.filter((a) => a.role in TITLE_MAP);
  const execCount = executiveAgents.length;
  const individualContributors = agents.filter((a) => {
    const hasManager = Boolean(a.reports_to);
    const isExec = a.role in TITLE_MAP;
    return hasManager && !isExec;
  });
  const totalHeadcount = FOUNDERS.length + agents.length;

  return (
    <div className="space-y-8">
      {/* ── Header ─────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-txt-primary">Workforce</h1>
          <p className="mt-1 text-sm text-txt-muted">
            {totalHeadcount} employees · {FOUNDERS.length} founders · {execCount} AI executives · {individualContributors.length} team members
          </p>
        </div>
        <Link
          to="/agents/new"
          className="rounded-lg border border-border bg-surface px-4 py-1.5 text-xs font-semibold text-txt-primary transition-all hover:border-border-hover hover:shadow-md"
        >
          + New Agent
        </Link>
      </div>

      <PageTabs
        tabs={[
          { key: 'overview' as Tab, label: 'Overview' },
          { key: 'roster' as Tab, label: 'Agent Roster' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'roster' ? (
        <AgentsList />
      ) : (
      <>
      <div className="flex justify-end">
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

          {/* Chief of Staff + direct reports */}
          <div className="flex justify-center">
            <div className="flex flex-col items-center gap-2">
              <div className="w-48">
                {cos ? <AgentNode agent={cos} /> : <Skeleton className="h-24 w-full" />}
              </div>
              {(() => {
                const deptHeadRoles = new Set(DEPARTMENTS.map((d) => d.role));
                const cosDirects = agents.filter(
                  (m) => m.reports_to === 'chief-of-staff' && m.role !== 'chief-of-staff' && !deptHeadRoles.has(m.role),
                );
                if (cosDirects.length === 0) return null;
                return (
                  <>
                    <div className="h-4 w-px bg-border" />
                    <div className="flex flex-col gap-1.5">
                      {cosDirects.map((m) => (
                        <SubTeamNode key={m.id} member={m} />
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Connector: CoS → departments */}
          <div className="flex justify-center">
            <div className="relative h-10 w-full max-w-6xl">
              <div className="absolute left-1/2 top-0 h-4 w-px bg-border" />
              <div className="absolute top-4 h-px bg-border" style={{ left: '10%', width: '80%' }} />
              {Array.from({ length: Math.min(DEPARTMENTS.length, 5) }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-4 h-6 w-px bg-border"
                  style={{ left: `${10 + i * 20}%` }}
                />
              ))}
            </div>
          </div>

          {/* Department columns with heads + sub-teams */}
          <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-5">
            {DEPARTMENTS.map((dept) => {
              const agent = agentMap.get(dept.role);
              const deptHeadRoles = new Set(DEPARTMENTS.map((d) => d.role));
              const members = agents.filter((m) => m.reports_to === dept.role && m.role !== dept.role && !deptHeadRoles.has(m.role));
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
                      <SubTeamNode key={m.id} member={m} />
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
              <Card key={f.name} className="relative overflow-hidden h-28">
                <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl" style={{ background: f.color }} />
                <div className="flex items-center gap-4 pl-3 h-full">
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

          {/* Agent grid — executives only */}
          <div className="mb-6 grid grid-cols-2 gap-4">
            {agents
              .filter((a) => a.role in TITLE_MAP)
              .sort((a, b) => {
                const order = ['chief-of-staff', 'cto', 'cpo', 'cfo', 'cmo', 'vp-customer-success', 'vp-sales', 'vp-design', 'ops', 'clo', 'vp-research', 'competitive-research-analyst', 'market-research-analyst', 'technical-research-analyst', 'industry-research-analyst', 'm365-admin', 'global-admin'];
                return (order.indexOf(a.role) === -1 ? 99 : order.indexOf(a.role)) - (order.indexOf(b.role) === -1 ? 99 : order.indexOf(b.role));
              })
              .map((agent) => {
                const meta = AGENT_META[agent.role];
                return (
                  <Card key={agent.id} className="group relative overflow-hidden h-28">
                    <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl" style={{ background: meta?.color ?? '#64748b' }} />
                    <div className="flex items-start gap-4 pl-3 h-full">
                      <AgentAvatar role={agent.role} size={60} glow={agent.status === 'active'} avatarUrl={agent.avatar_url} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-[15px] font-semibold text-txt-primary">{DISPLAY_NAME_MAP[agent.role] ?? agent.display_name ?? agent.name ?? agent.role}</h3>
                          <StatusDot status={agent.status} />
                        </div>
                        <p className="text-[12px] text-txt-muted">{TITLE_MAP[agent.role] ?? agent.title ?? agent.role}</p>
                        <p className="mt-0.5 text-[11px] text-txt-faint">
                          AI Agent
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

          <SectionHeader title={`Team Members (${individualContributors.length})`} />

          {/* Sub-team grid */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {individualContributors.map((m) => {
              const meta = AGENT_META[m.role];
              return (
              <Card key={m.id} className="relative overflow-hidden h-24">
                <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl" style={{ background: meta?.color ?? '#64748b' }} />
                <div className="flex items-center gap-3 pl-3 h-full">
                  <AgentAvatar role={m.role} size={48} glow={m.status === 'active'} avatarUrl={m.avatar_url} />
                  <div>
                    <h3 className="text-[13px] font-semibold text-txt-primary">{DISPLAY_NAME_MAP[m.role] ?? m.name ?? m.display_name ?? m.role}</h3>
                    <p className="text-[11px] text-txt-muted">{TITLE_MAP[m.role] ?? m.title ?? m.role}</p>
                    <p className="mt-0.5 text-[10px] text-txt-faint">{m.department ?? 'Unassigned'} · Reports to {DISPLAY_NAME_MAP[m.reports_to ?? ''] ?? m.reports_to ?? 'Founders'}</p>
                  </div>
                </div>
              </Card>
            );})}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}

/* ─── Founder Node (org chart) ────────────── */
function FounderNode({ name, title, initials, color, photo }: { name: string; title: string; initials: string; color: string; photo: string }) {
  return (
    <Card className="w-64 min-h-[13rem] text-center p-5">
      <div className="flex flex-col items-center justify-center gap-3 h-full">
        <img
          src={photo}
          alt={name}
          className="rounded-full object-cover shrink-0"
          style={{ width: 88, height: 88, border: `2px solid ${color}50` }}
        />
        <div>
          <h3 className="text-base font-semibold text-txt-primary leading-tight">{name}</h3>
          <p className="text-xs text-txt-muted leading-tight">{title}</p>
          <span
            className="mt-1 inline-block rounded-full bg-prism-fill-2/10 px-2 py-0.5 text-[10px] font-medium text-prism-teal border border-prism-fill-2/20">
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
      <Card className={`${compact ? 'p-4' : 'p-5'} w-full h-[12rem] text-center`}>
        <div className="flex flex-col items-center justify-center gap-2 h-full">
          <AgentAvatar role={agent.role} size={compact ? 48 : 64} glow={agent.status === 'active'} avatarUrl={agent.avatar_url} />
          <div className="min-w-0 w-full">
            <div className="flex items-center justify-center gap-1.5">
              <h3 className="font-semibold text-txt-primary leading-tight text-xs">
                {DISPLAY_NAME_MAP[agent.role] ?? agent.display_name ?? agent.name ?? agent.role}
              </h3>
              <StatusDot status={agent.status} />
            </div>
            <p className="text-[10px] text-txt-muted leading-tight">
              {TITLE_MAP[agent.role] ?? agent.title ?? agent.role}
            </p>
            <div className="mt-2 flex items-center justify-center gap-2 text-xs">
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
function SubTeamNode({ member }: { member: Agent }) {
  const displayName = DISPLAY_NAME_MAP[member.role] ?? member.name ?? member.display_name ?? member.role;
  const title = TITLE_MAP[member.role] ?? member.title ?? member.role;
  return (
    <Link to={`/agents/${member.role}`} className="block transition-transform hover:scale-[1.02]">
      <Card className="p-3 min-h-[72px]">
        <div className="flex items-center gap-3 h-full">
          <AgentAvatar role={member.role} size={48} glow={member.status === 'active'} avatarUrl={member.avatar_url} />
          <div className="min-w-0 text-left">
            <p className="text-sm font-semibold text-txt-primary leading-tight">{displayName}</p>
            <p className="text-xs text-txt-muted leading-tight">{title}</p>
          </div>
        </div>
      </Card>
    </Link>
  );
}
