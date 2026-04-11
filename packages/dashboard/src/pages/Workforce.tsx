import { useState, type DragEvent } from 'react';
import { useAgents } from '../lib/hooks';
import { SCHEDULER_URL, buildApiHeaders } from '../lib/firebase';
import { DISPLAY_NAME_MAP, AGENT_META, ROLE_MANAGER_OVERRIDES, type Agent } from '../lib/types';
import {
  Card,
  SectionHeader,
  AgentAvatar,
  StatusDot,
  Skeleton,
  timeAgo,
  PageTabs,
} from '../components/ui';
import { MdArrowForward, MdExpandMore } from 'react-icons/md';
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
  { label: 'Design & Frontend', role: 'vp-design' },
  { label: 'Research & Intelligence', role: 'vp-research' },
  { label: 'Operations & IT', role: 'ops' },
];

const TITLE_MAP: Record<string, string> = {
  'chief-of-staff': 'Chief of Staff',
  cto: 'Chief Technology Officer',
  cpo: 'Chief Product Officer',
  cfo: 'Chief Financial Officer',
  cmo: 'Chief Marketing Officer',
  'vp-design': 'VP Design & Frontend',
  'vp-research': 'VP Research & Intelligence',
  ops: 'Operations & System Intelligence',
};

type ViewMode = 'org-chart' | 'grid';
type Tab = 'overview' | 'roster';
type DensityMode = 'compact' | 'comfortable';

const HIDDEN_WORKFORCE_STATUSES = new Set(['retired', 'inactive', 'deleted']);

/** Fixed org-chart card shell so founders, executives, and reports share one footprint. */
function orgChartCardClass(compact: boolean) {
  return compact
    ? 'w-48 min-h-[172px] h-[172px] p-3'
    : 'w-52 min-h-[188px] h-[188px] p-4';
}

function orgChartAvatarSize(compact: boolean) {
  return compact ? 48 : 56;
}

export default function Workforce() {
  const { data: agents, loading, refresh } = useAgents();
  const [view, setView] = useState<ViewMode>('org-chart');
  const [density, setDensity] = useState<DensityMode>('compact');
  const [tab, setTab] = useState<Tab>('overview');
  const [draggingRole, setDraggingRole] = useState<string | null>(null);
  const [dropTargetRole, setDropTargetRole] = useState<string | null>(null);
  const [movingRole, setMovingRole] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState<string>('');
  const [expandedDepartments, setExpandedDepartments] = useState<Record<string, boolean>>({});

  // Keep non-active lifecycle statuses out of the live org hierarchy.
  const orgAgents = agents.filter((a) => !HIDDEN_WORKFORCE_STATUSES.has(String(a.status ?? '').toLowerCase()));
  const agentMap = new Map(orgAgents.map((a) => [a.role, a]));
  const cos = agentMap.get('chief-of-staff');
  const allDeptRoleSet = new Set(DEPARTMENTS.map((department) => department.role));

  const normalizeDepartment = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

  const resolveManagerRole = (member: Agent): string | null => {
    if (member.reports_to && agentMap.has(member.reports_to)) return member.reports_to;

    const overrideManager = ROLE_MANAGER_OVERRIDES[member.role];
    if (overrideManager && agentMap.has(overrideManager)) return overrideManager;

    const deptHead = DEPARTMENTS.find(
      (department) => normalizeDepartment(department.label) === normalizeDepartment(member.department),
    );
    if (deptHead && deptHead.role !== member.role && agentMap.has(deptHead.role)) return deptHead.role;

    if (cos && member.role !== 'chief-of-staff' && !allDeptRoleSet.has(member.role)) return 'chief-of-staff';
    return null;
  };

  /**
   * One column per department where we have an active agent for that executive role.
   * Do not filter by `reports_to`: if e.g. VP Design reports to CTO, they still belong on the chart;
   * the old filter hid whole columns whenever `resolveManagerRole` was another exec (not CoS).
   */
  const departmentHeads = DEPARTMENTS
    .map((department) => ({ ...department, agent: agentMap.get(department.role) }))
    .filter((department): department is (typeof DEPARTMENTS)[number] & { agent: Agent } => Boolean(department.agent));
  const deptHeadRoles = new Set(departmentHeads.map((department) => department.role));

  const executiveAgents = orgAgents.filter((a) => a.role in TITLE_MAP);
  const execCount = executiveAgents.length;
  const individualContributors = orgAgents.filter((a) => !(a.role in TITLE_MAP));
  const totalHeadcount = FOUNDERS.length + orgAgents.length;

  const canDropOnManager = (sourceRole: string, targetRole: string): boolean => {
    if (!sourceRole || !targetRole) return false;
    if (sourceRole === targetRole) return false;
    if (!agentMap.has(sourceRole) || !agentMap.has(targetRole)) return false;

    // Prevent hierarchy loops: target cannot be a descendant of source.
    let cursor: string | null = targetRole;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      if (cursor === sourceRole) return false;
      seen.add(cursor);
      const manager: string | null = agentMap.get(cursor)?.reports_to ?? null;
      cursor = manager && agentMap.has(manager) ? manager : null;
    }
    return true;
  };

  const persistManager = async (sourceRole: string, targetRole: string) => {
    setMovingRole(sourceRole);
    setMoveNotice('');
    try {
      const resp = await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(sourceRole)}/settings`, {
        method: 'PUT',
        headers: await buildApiHeaders(),
        body: JSON.stringify({ reports_to: targetRole }),
      });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok || result?.success === false) {
        throw new Error(result?.error || `Update failed (${resp.status})`);
      }
      await refresh();
      const sourceName = DISPLAY_NAME_MAP[sourceRole] ?? sourceRole;
      const targetName = DISPLAY_NAME_MAP[targetRole] ?? targetRole;
      setMoveNotice(`${sourceName} now reports to ${targetName}.`);
    } catch (err) {
      setMoveNotice(`Reassign failed: ${(err as Error).message}`);
    } finally {
      setMovingRole(null);
    }
  };

  const handleAgentDragStart = (role: string) => (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('text/plain', role);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingRole(role);
    setDropTargetRole(null);
  };

  const handleAgentDragEnd = () => {
    setDraggingRole(null);
    setDropTargetRole(null);
  };

  const handleManagerDragOver = (targetRole: string) => (e: DragEvent<HTMLDivElement>) => {
    const sourceRole = e.dataTransfer.getData('text/plain') || draggingRole;
    if (!sourceRole || !canDropOnManager(sourceRole, targetRole)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetRole(targetRole);
  };

  const handleManagerDrop = (targetRole: string) => async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const sourceRole = e.dataTransfer.getData('text/plain') || draggingRole;
    setDropTargetRole(null);
    setDraggingRole(null);
    if (!sourceRole || !canDropOnManager(sourceRole, targetRole)) return;
    await persistManager(sourceRole, targetRole);
  };

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        {view === 'org-chart' ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-txt-faint">Density</span>
            <div className="flex gap-1 rounded-md border border-border bg-panel p-0.5">
              <button
                onClick={() => setDensity('compact')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  density === 'compact' ? 'bg-raised text-txt-primary' : 'text-txt-muted hover:text-txt-secondary'
                }`}
              >
                Compact
              </button>
              <button
                onClick={() => setDensity('comfortable')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  density === 'comfortable' ? 'bg-raised text-txt-primary' : 'text-txt-muted hover:text-txt-secondary'
                }`}
              >
                Comfortable
              </button>
            </div>
          </div>
        ) : <div />}

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

      {view === 'org-chart' && (
        <p className="text-xs text-txt-faint">
          Drag an agent card onto another agent card to change manager and auto-rebalance the org chart.
          {movingRole ? ' Saving change...' : ''}
          {moveNotice ? ` ${moveNotice}` : ''}
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : view === 'org-chart' ? (
        /* ── Org Chart View ──────────────── */
        <div className={`mx-auto w-full ${density === 'compact' ? 'max-w-6xl' : 'max-w-7xl'} space-y-0`}>
          {/* Founders row */}
          <div className={`flex flex-wrap justify-center ${density === 'compact' ? 'gap-4' : 'gap-6'}`}>
            {FOUNDERS.map((f) => (
              <FounderNode
                key={f.name}
                name={f.name}
                title={f.title}
                initials={f.initials}
                color={f.color}
                photo={f.photo}
                compact={density === 'compact'}
              />
            ))}
          </div>

          {/* Connector: founders → CoS */}
          <div className="flex justify-center">
            <div className="relative h-8 w-[220px]">
              <div className="absolute left-1/4 top-0 h-3 w-px bg-border" />
              <div className="absolute right-1/4 top-0 h-3 w-px bg-border" />
              <div className="absolute left-1/4 top-3 h-px bg-border" style={{ width: '50%' }} />
              <div className="absolute left-1/2 top-3 h-5 w-px bg-border" />
            </div>
          </div>

          {/* Chief of Staff */}
          <div className="flex justify-center">
            <div className={`flex flex-col items-center ${density === 'compact' ? 'gap-2' : 'gap-3'}`}>
              <div className={density === 'compact' ? 'w-48' : 'w-52'}>
                {cos ? (
                  <AgentNode
                    agent={cos}
                    compact={density === 'compact'}
                    draggable
                    dropEnabled={Boolean(draggingRole)}
                    isDragging={draggingRole === cos.role}
                    isDropTarget={dropTargetRole === cos.role}
                    onDragStart={handleAgentDragStart(cos.role)}
                    onDragEnd={handleAgentDragEnd}
                    onDragOver={handleManagerDragOver(cos.role)}
                    onDrop={handleManagerDrop(cos.role)}
                  />
                ) : (
                  <Card className={`${orgChartCardClass(density === 'compact')} flex flex-col items-center justify-center gap-1.5 text-center`}>
                    <p className="text-xs font-medium text-txt-muted">Sarah / Chief of Staff</p>
                    <p className="text-[10px] leading-snug text-txt-faint">
                      No active <span className="font-mono">chief-of-staff</span> row in the roster. Add the agent or set status to active.
                    </p>
                    <Link
                      to="/agents/new"
                      className="text-[10px] font-medium text-cyan hover:underline"
                    >
                      + New agent
                    </Link>
                  </Card>
                )}
              </div>
              {(() => {
                const cosDirects = orgAgents.filter(
                  (m) => resolveManagerRole(m) === 'chief-of-staff' && m.role !== 'chief-of-staff' && !deptHeadRoles.has(m.role),
                );
                if (cosDirects.length === 0) return null;
                return (
                  <>
                    <div className="h-3 w-px bg-border" />
                    <div className={`grid w-full max-w-2xl justify-items-center ${density === 'compact' ? 'gap-1.5' : 'gap-2.5'} sm:grid-cols-2`}>
                      {cosDirects.map((m) => (
                        <SubTeamNode
                          key={m.id}
                          member={m}
                          compact={density === 'compact'}
                          draggable
                          dropEnabled={Boolean(draggingRole)}
                          isDragging={draggingRole === m.role}
                          isDropTarget={dropTargetRole === m.role}
                          onDragStart={handleAgentDragStart(m.role)}
                          onDragEnd={handleAgentDragEnd}
                          onDragOver={handleManagerDragOver(m.role)}
                          onDrop={handleManagerDrop(m.role)}
                        />
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Connector: CoS → departments */}
          <div className="flex justify-center">
            <div className="h-5 w-px bg-border" />
          </div>
          <div className="mx-auto h-px w-full bg-border" />

          {/* Department columns with heads + sub-teams */}
              <div className={`mt-4 grid grid-cols-1 items-start ${density === 'compact' ? 'gap-3' : 'gap-5'} sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4`}>
            {departmentHeads.map((dept) => {
                const members = orgAgents.filter((m) => resolveManagerRole(m) === dept.role && m.role !== dept.role && !deptHeadRoles.has(m.role));
                const membersUseGrid = density !== 'compact' && members.length >= 6;
                const memberGapClass = density === 'compact' ? 'gap-1.5' : 'gap-2.5';
                const membersLayoutClass = membersUseGrid ? `grid grid-cols-2 ${memberGapClass}` : `flex flex-col ${memberGapClass}`;
                    const hasMembers = members.length > 0;
                    const isExpanded = expandedDepartments[dept.role] ?? false;
              return (
                <div key={dept.label} className="self-start">
                  <div className={`flex flex-col items-center ${density === 'compact' ? 'gap-1.5' : 'gap-2.5'}`}>
                    <span className="text-[10px] font-medium uppercase tracking-widest text-txt-faint">
                      {dept.label}
                    </span>
                    <AgentNode
                      agent={dept.agent}
                      compact={density === 'compact'}
                      draggable
                      dropEnabled={Boolean(draggingRole)}
                      isDragging={draggingRole === dept.agent.role}
                      isDropTarget={dropTargetRole === dept.agent.role}
                      onDragStart={handleAgentDragStart(dept.agent.role)}
                      onDragEnd={handleAgentDragEnd}
                      onDragOver={handleManagerDragOver(dept.agent.role)}
                      onDrop={handleManagerDrop(dept.agent.role)}
                    />
                    {hasMembers ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setExpandedDepartments((prev) => ({ ...prev, [dept.role]: !isExpanded }))}
                          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-txt-muted hover:text-txt-primary"
                        >
                          <span>{members.length} report{members.length === 1 ? '' : 's'}</span>
                          <MdExpandMore className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                        {isExpanded && (
                          <>
                            <div className="h-3 w-px bg-border" />
                            <div className={`w-full ${membersLayoutClass} ${membersUseGrid ? 'justify-items-center' : 'items-center'}`}>
                              {members.map((m) => (
                                <SubTeamNode
                                  key={m.id}
                                  member={m}
                                  compact={density === 'compact'}
                                  draggable
                                  dropEnabled={Boolean(draggingRole)}
                                  isDragging={draggingRole === m.role}
                                  isDropTarget={dropTargetRole === m.role}
                                  onDragStart={handleAgentDragStart(m.role)}
                                  onDragEnd={handleAgentDragEnd}
                                  onDragOver={handleManagerDragOver(m.role)}
                                  onDrop={handleManagerDrop(m.role)}
                                />
                              ))}
                            </div>
                          </>
                        )}
                      </>
                    ) : (
                      <div className="h-[24px]" aria-hidden="true" />
                    )}
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
            {orgAgents
              .filter((a) => a.role in TITLE_MAP)
              .sort((a, b) => {
                const order = ['chief-of-staff', 'cto', 'cpo', 'cfo', 'cmo', 'vp-customer-success', 'vp-sales', 'vp-design', 'ops'];
                return (order.indexOf(a.role) === -1 ? 99 : order.indexOf(a.role)) - (order.indexOf(b.role) === -1 ? 99 : order.indexOf(b.role));
              })
              .map((agent) => {
                const meta = AGENT_META[agent.role];
                const managerRole = resolveManagerRole(agent);
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
                          AI Agent{managerRole ? ` · Reports to ${DISPLAY_NAME_MAP[managerRole] ?? managerRole}` : ''}
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
                          to={`/agents/${agent.role}/settings`}
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
              const managerRole = resolveManagerRole(m);
              return (
              <Card key={m.id} className="relative overflow-hidden h-24">
                <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl" style={{ background: meta?.color ?? '#64748b' }} />
                <div className="flex items-center gap-3 pl-3 h-full">
                  <AgentAvatar role={m.role} size={48} glow={m.status === 'active'} avatarUrl={m.avatar_url} />
                  <div>
                    <h3 className="text-[13px] font-semibold text-txt-primary">{DISPLAY_NAME_MAP[m.role] ?? m.name ?? m.display_name ?? m.role}</h3>
                    <p className="text-[11px] text-txt-muted">{TITLE_MAP[m.role] ?? m.title ?? m.role}</p>
                    <p className="mt-0.5 text-[10px] text-txt-faint">{m.department ?? 'Unassigned'} · Reports to {DISPLAY_NAME_MAP[managerRole ?? ''] ?? managerRole ?? 'Founders'}</p>
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
function FounderNode({ name, title, initials, color, photo, compact = true }: { name: string; title: string; initials: string; color: string; photo: string; compact?: boolean }) {
  const av = orgChartAvatarSize(compact);
  return (
    <Card className={`${orgChartCardClass(compact)} text-center flex flex-col`}>
      <div className={`flex min-h-0 flex-1 flex-col items-center justify-center ${compact ? 'gap-1.5' : 'gap-2'}`}>
        <img
          src={photo}
          alt={name}
          className="shrink-0 rounded-full object-cover"
          style={{ width: av, height: av, border: `2px solid ${color}40` }}
        />
        <div className="min-w-0 px-0.5">
          <h3 className={`${compact ? 'text-xs' : 'text-sm'} font-semibold leading-tight text-txt-primary line-clamp-2`}>{name}</h3>
          <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} leading-tight text-txt-muted line-clamp-2`}>{title}</p>
          <span className="badge badge-teal badge-xs mt-0.5">Human</span>
        </div>
      </div>
    </Card>
  );
}

/* ─── Agent Node (org chart) ──────────────── */
type OrgDragProps = {
  draggable?: boolean;
  dropEnabled?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void;
};

type AgentNodeProps = {
  agent: Agent;
  compact?: boolean;
} & OrgDragProps;

function AgentNode({
  agent,
  compact = false,
  draggable = false,
  dropEnabled = false,
  isDragging = false,
  isDropTarget = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: AgentNodeProps) {
  const av = orgChartAvatarSize(compact);
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`${isDragging ? 'opacity-60' : ''} ${isDropTarget ? 'ring-2 ring-cyan/40 rounded-xl' : ''} ${compact ? 'w-48' : 'w-52'}`}
    >
    <Link to={`/agents/${agent.role}/settings`} draggable={false} className="block transition-transform hover:scale-[1.02]">
      <Card className={`${orgChartCardClass(compact)} text-center flex flex-col ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1">
          <AgentAvatar role={agent.role} size={av} glow={agent.status === 'active'} avatarUrl={agent.avatar_url} />
          <div className="min-w-0 w-full px-0.5">
            <div className="flex items-center justify-center gap-1">
              <h3 className="line-clamp-2 text-xs font-semibold leading-tight text-txt-primary">
                {DISPLAY_NAME_MAP[agent.role] ?? agent.display_name ?? agent.name ?? agent.role}
              </h3>
              <StatusDot status={agent.status} />
            </div>
            <p className="line-clamp-2 text-[10px] leading-tight text-txt-muted">
              {TITLE_MAP[agent.role] ?? agent.title ?? agent.role}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-0 text-[10px]">
              <span className="font-mono text-txt-faint">
                {agent.performance_score != null ? `${Math.round(Number(agent.performance_score) * 100)}/100` : '—'}
              </span>
              {draggable && <span className="text-txt-faint">Drag to move</span>}
            </div>
            {!compact && (
              <p className="mt-0.5 line-clamp-1 text-[10px] text-txt-faint">Last run: {timeAgo(agent.last_run_at)}</p>
            )}
          </div>
        </div>
      </Card>
    </Link>
    </div>
  );
}

/* ─── Stats Card ──────────────────────────── */
const STAT_COLORS: Record<string, string> = {
  'Active': '#34D399',
  'Paused': '#F59E0B',
  'Error': '#EF4444',
};

function StatCard({ label, value, total, color, loading }: { label: string; value: number; total: number; color: string; loading: boolean }) {
  if (loading) return <Skeleton className="h-20" />;
  const pct = total > 0 ? (value / total) * 100 : 0;
  const topColor = STAT_COLORS[label] ?? '#64748b';
  return (
    <div
      className="glass-surface rounded-xl px-4 py-3"
      style={{ borderTopColor: topColor, borderTopWidth: '2px' }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: topColor }}>{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold text-txt-primary">
        {value}
        <span className="text-sm text-txt-faint">/{total}</span>
      </p>
      <div className="mt-2 h-1.5 w-full rounded-full bg-border">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ─── Sub-Team Node (org chart) ───────────── */
type SubTeamNodeProps = {
  member: Agent;
  compact?: boolean;
} & OrgDragProps;

function SubTeamNode({
  member,
  compact = false,
  draggable = false,
  dropEnabled = false,
  isDragging = false,
  isDropTarget = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: SubTeamNodeProps) {
  const displayName = DISPLAY_NAME_MAP[member.role] ?? member.name ?? member.display_name ?? member.role;
  const title = TITLE_MAP[member.role] ?? member.title ?? member.role;
  const av = orgChartAvatarSize(compact);
  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`${isDragging ? 'opacity-60' : ''} ${isDropTarget ? 'ring-2 ring-cyan/40 rounded-xl' : ''} ${compact ? 'w-48' : 'w-52'}`}
    >
    <Link to={`/agents/${member.role}/settings`} draggable={false} className="block transition-transform hover:scale-[1.02]">
      <Card className={`${orgChartCardClass(compact)} text-center flex flex-col ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1">
          <AgentAvatar role={member.role} size={av} glow={member.status === 'active'} avatarUrl={member.avatar_url} />
          <div className="min-w-0 w-full px-0.5">
            <div className="flex items-center justify-center gap-1">
              <h3 className="line-clamp-2 text-xs font-semibold leading-tight text-txt-primary">{displayName}</h3>
              <StatusDot status={member.status} />
            </div>
            <p className="line-clamp-2 text-[10px] leading-tight text-txt-muted">{title}</p>
            <div className="mt-0.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-0 text-[10px]">
              <span className="font-mono text-txt-faint">
                {member.performance_score != null ? `${Math.round(Number(member.performance_score) * 100)}/100` : '—'}
              </span>
              {draggable && <span className="text-txt-faint">Drag to move</span>}
            </div>
          </div>
        </div>
      </Card>
    </Link>
    </div>
  );
}
