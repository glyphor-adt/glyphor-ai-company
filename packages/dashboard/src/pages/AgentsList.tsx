import { Link } from 'react-router-dom';
import { useAgents } from '../lib/hooks';
import { DISPLAY_NAME_MAP, AGENT_META, ROLE_TITLE, ROLE_DEPARTMENT, ROLE_TIER, AGENT_SKILLS, SUB_TEAM } from '../lib/types';
import { AgentAvatar, Card, StatusDot, Skeleton } from '../components/ui';

export default function AgentsList() {
  const { data: agents, loading } = useAgents();

  const activeCount = agents.filter((a) => a.status === 'active').length;

  return (
    <div className="space-y-6">
      {/* Agent Grid */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents
            .sort((a, b) => {
              const order = [
                'chief-of-staff', 'cto', 'cpo', 'cfo', 'cmo', 'vp-sales', 'vp-design', 'vp-research', 'clo', 'ops',
                // Engineering
                'platform-engineer', 'quality-engineer', 'devops-engineer',
                // Product
                'user-researcher', 'competitive-intel',
                // Finance
                // Marketing
                'content-creator', 'seo-analyst', 'social-media-manager',
                // Sales
                // Design
                'ui-ux-designer', 'frontend-engineer', 'design-critic', 'template-architect',
                // IT / Ops
                'm365-admin', 'global-admin',
                // Research & Intelligence
                'competitive-research-analyst', 'market-research-analyst',
              ];
              const ai = order.indexOf(a.role);
              const bi = order.indexOf(b.role);
              return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            })
            .map((agent) => {
              const meta = AGENT_META[agent.role];
              const directReports = SUB_TEAM.filter((m) => m.reportsTo === agent.role);
              const skills = AGENT_SKILLS[agent.role] ?? [];
              return (
                <Link key={agent.id} to={`/agents/${agent.role}`} className="group block h-full">
                  <Card className="relative flex h-full flex-col overflow-hidden transition-all hover:border-cyan/30 hover:shadow-[0_0_20px_rgba(34,211,238,0.06)]">
                    {/* Color accent */}
                    <div
                      className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
                      style={{ background: meta?.color ?? '#64748b' }}
                    />

                    <div className="flex flex-1 flex-col pl-3">
                      {/* Top row: avatar + name */}
                      <div className="flex items-start gap-3">
                        <AgentAvatar role={agent.role} size={48} glow={agent.status === 'active'} avatarUrl={agent.avatar_url} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-[15px] font-semibold text-txt-primary">
                              {DISPLAY_NAME_MAP[agent.role] ?? agent.display_name}
                            </h3>
                            <StatusDot status={agent.status} />
                          </div>
                          <p className="text-[12px] text-txt-muted">
                            {ROLE_TITLE[agent.role] ?? agent.title ?? agent.role}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-txt-faint">
                            <span>{ROLE_DEPARTMENT[agent.role] ?? agent.department ?? ''}</span>
                          </div>
                        </div>
                      </div>

                      {/* Stats row */}
                      <div className="mt-3 flex items-center gap-3">
                        <span className="font-mono text-sm text-txt-secondary">
                          {agent.performance_score != null ? `${Math.round(Number(agent.performance_score) * 100)}/100` : '—'}
                        </span>
                        {ROLE_TIER[agent.role] && (
                          <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-txt-muted">
                            {ROLE_TIER[agent.role]}
                          </span>
                        )}
                      </div>

                      {/* Skills preview */}
                      <div className="mt-3 flex flex-wrap gap-1">
                        {skills.length > 0 ? (
                          <>
                            {skills.slice(0, 3).map((s) => (
                              <span
                                key={s}
                                className="rounded-md border border-border/60 bg-raised px-1.5 py-0.5 text-[10px] font-mono text-txt-secondary"
                              >
                                {s}
                              </span>
                            ))}
                            {skills.length > 3 && (
                              <span className="rounded-md px-1.5 py-0.5 text-[10px] text-txt-muted">
                                +{skills.length - 3}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-[10px] text-txt-faint">&nbsp;</span>
                        )}
                      </div>

                      {/* Direct reports count — pinned to bottom */}
                      <div className="mt-auto pt-2">
                        {directReports.length > 0 && (
                          <p className="text-[10px] text-txt-faint">
                            {directReports.length} direct report{directReports.length > 1 ? 's' : ''}
                          </p>
                        )}
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
        </div>
      )}
    </div>
  );
}
