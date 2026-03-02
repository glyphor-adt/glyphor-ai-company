import { Link } from 'react-router-dom';
import {
  MdWarning,
  MdTrendingUp,
  MdTrendingDown,
  MdCheckCircle,
  MdFlag,
  MdLightbulb,
  MdArrowForward,
} from 'react-icons/md';
import { useCompanyPulse, useActiveDirectives, useOpenIncidents, useTopReflections, useDecisions } from '../lib/hooks';
import { DISPLAY_NAME_MAP, TIER_TO_IMPACT } from '../lib/types';
import { Card, SectionHeader, AgentAvatar, ImpactBadge, Skeleton, timeAgo } from './ui';

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-prism-critical',
  high: 'text-prism-elevated',
  medium: 'text-prism-sky',
  low: 'text-txt-faint',
};

const MOOD_EMOJI: Record<string, string> = {
  thriving: 'G',
  steady: 'S',
  stressed: 'W',
  critical: 'C',
};

export default function FounderBriefing() {
  const { data: pulse, loading: pulseLoading } = useCompanyPulse();
  const { data: directives, loading: directivesLoading } = useActiveDirectives();
  const { data: incidents, loading: incidentsLoading } = useOpenIncidents();
  const { data: reflections, loading: reflectionsLoading } = useTopReflections(4);
  const { data: decisions, loading: decisionsLoading } = useDecisions();

  const pendingDecisions = decisions.filter((d) => d.status === 'pending');
  const highPriorityDecisions = pendingDecisions.filter((d) => d.tier === 'red' || d.tier === 'yellow');

  const loading = pulseLoading || directivesLoading || incidentsLoading || reflectionsLoading || decisionsLoading;

  if (loading) {
    return (
      <Card className="col-span-2">
        <SectionHeader title="Founder Briefing" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card className="col-span-2">
      <SectionHeader
        title="Founder Briefing"
        action={
          <span className="text-[11px] text-txt-faint">
            Updated {pulse ? timeAgo(pulse.updated_at) : 'N/A'}
          </span>
        }
      />

      <div className="space-y-5">
        {/* ── Company Pulse ─────────────────── */}
        {pulse && (
          <div className="rounded-lg border border-border bg-raised/50 p-3.5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm">{MOOD_EMOJI[pulse.company_mood] ?? 'S'}</span>
              <span className="text-[13px] font-semibold text-txt-primary capitalize">
                {pulse.company_mood}
              </span>
              {pulse.platform_status && pulse.platform_status !== 'green' && (
                <span className={`ml-auto text-[11px] font-medium ${
                  pulse.platform_status === 'red' ? 'text-prism-critical' : 'text-prism-elevated'
                }`}>
                  Platform {pulse.platform_status}
                </span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-3">
              {pulse.mrr != null && (
                <PulseMetric
                  label="MRR"
                  value={`$${(Number(pulse.mrr) / 1000).toFixed(1)}k`}
                  change={pulse.mrr_change_pct}
                />
              )}
              {pulse.active_users != null && (
                <PulseMetric label="Active Users" value={String(pulse.active_users)} />
              )}
              {pulse.new_users_today != null && (
                <PulseMetric label="New Today" value={`+${pulse.new_users_today}`} />
              )}
              {pulse.churn_events_today != null && (
                <PulseMetric
                  label="Churn Events"
                  value={String(pulse.churn_events_today)}
                  alert={pulse.churn_events_today > 0}
                />
              )}
            </div>
          </div>
        )}

        {/* ── Incidents / Alerts ────────────── */}
        {incidents.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <MdWarning className="h-4 w-4 text-prism-critical" />
              <span className="text-[12px] font-semibold text-prism-critical uppercase tracking-wider">
                Open Incidents
              </span>
            </div>
            <div className="space-y-1.5">
              {incidents.map((inc) => (
                <div
                  key={inc.id}
                  className="flex items-center gap-3 rounded-lg border border-prism-critical/20 bg-prism-critical/5 px-3 py-2"
                >
                  <span className={`text-[11px] font-bold uppercase ${
                    inc.severity === 'critical' ? 'text-prism-critical' : 'text-prism-elevated'
                  }`}>
                    {inc.severity}
                  </span>
                  <span className="text-[13px] text-txt-secondary flex-1 line-clamp-1">{inc.title}</span>
                  <span className="text-[10px] text-txt-faint">{timeAgo(inc.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Decisions Needing Attention ───── */}
        {highPriorityDecisions.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <MdFlag className="h-4 w-4 text-prism-elevated" />
                <span className="text-[12px] font-semibold text-txt-muted uppercase tracking-wider">
                  Decisions Needing Attention
                </span>
              </div>
              <Link to="/approvals" className="text-[11px] text-cyan hover:underline flex items-center gap-0.5">
                All decisions <MdArrowForward className="h-3 w-3" />
              </Link>
            </div>
            <div className="space-y-1.5">
              {highPriorityDecisions.slice(0, 3).map((d) => (
                <Link
                  key={d.id}
                  to="/approvals"
                  className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-raised transition-colors"
                >
                  <AgentAvatar role={d.proposed_by} size={24} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-txt-secondary line-clamp-1">{d.title}</p>
                    <p className="text-[11px] text-txt-faint line-clamp-1">{d.summary}</p>
                  </div>
                  <ImpactBadge impact={TIER_TO_IMPACT[d.tier] ?? d.tier} />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── Directive Progress ────────────── */}
        {directives.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-semibold text-txt-muted uppercase tracking-wider">
                Directive Progress
              </span>
              <Link to="/directives" className="text-[11px] text-cyan hover:underline flex items-center gap-0.5">
                All directives <MdArrowForward className="h-3 w-3" />
              </Link>
            </div>
            <div className="space-y-2">
              {directives
                .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3))
                .slice(0, 4)
                .map((d) => {
                  const total = d.assignments.length;
                  const completed = d.assignments.filter((a) => a.status === 'completed').length;
                  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

                  return (
                    <Link
                      key={d.id}
                      to="/directives"
                      className="block rounded-lg px-3 py-2.5 hover:bg-raised transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <MdFlag className={`h-3.5 w-3.5 ${PRIORITY_COLORS[d.priority] ?? 'text-txt-faint'}`} />
                        <span className="text-[13px] text-txt-secondary font-medium line-clamp-1 flex-1">
                          {d.title}
                        </span>
                        <span className="text-[11px] text-txt-faint">
                          {total > 0 ? `${completed}/${total} tasks` : 'No tasks yet'}
                        </span>
                      </div>
                      {total > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-border overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                pct === 100 ? 'bg-prism-fill-2' : 'bg-cyan'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-txt-faint w-8 text-right">{pct}%</span>
                        </div>
                      )}
                    </Link>
                  );
                })}
            </div>
          </div>
        )}

        {/* ── Agent Insights ────────────────── */}
        {reflections.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <MdLightbulb className="h-4 w-4 text-prism-elevated" />
              <span className="text-[12px] font-semibold text-txt-muted uppercase tracking-wider">
                Agent Insights
              </span>
            </div>
            <div className="space-y-1.5">
              {reflections.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-raised transition-colors"
                >
                  <AgentAvatar role={r.agent_role} size={24} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-txt-secondary line-clamp-2">{r.summary}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] text-txt-faint">
                        {DISPLAY_NAME_MAP[r.agent_role] ?? r.agent_role}
                      </span>
                      {r.quality_score != null && (
                        <span className={`text-[10px] font-medium ${
                          r.quality_score >= 80 ? 'text-prism-teal' : 'text-txt-faint'
                        }`}>
                          Q{r.quality_score}
                        </span>
                      )}
                      <span className="text-[10px] text-txt-faint">{timeAgo(r.created_at)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Fallback if everything is empty ── */}
        {!pulse && incidents.length === 0 && highPriorityDecisions.length === 0 &&
         directives.length === 0 && reflections.length === 0 && (
          <p className="py-8 text-center text-sm text-txt-faint flex items-center justify-center gap-2">
            <MdCheckCircle className="h-4 w-4 text-prism-teal" />
            All clear — nothing needs your attention right now
          </p>
        )}
      </div>
    </Card>
  );
}

/* ── Pulse Metric mini-card ────────────────── */
function PulseMetric({
  label,
  value,
  change,
  alert,
}: {
  label: string;
  value: string;
  change?: number | null;
  alert?: boolean;
}) {
  return (
    <div className="text-center">
      <p className={`text-lg font-bold font-mono ${alert ? 'text-prism-critical' : 'text-txt-primary'}`}>
        {value}
      </p>
      <p className="text-[10px] text-txt-faint">{label}</p>
      {change != null && (
        <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${
          change >= 0 ? 'text-prism-teal' : 'text-prism-critical'
        }`}>
          {change >= 0 ? <MdTrendingUp className="h-3 w-3" /> : <MdTrendingDown className="h-3 w-3" />}
          {change >= 0 ? '+' : ''}{Number(change).toFixed(1)}%
        </span>
      )}
    </div>
  );
}
