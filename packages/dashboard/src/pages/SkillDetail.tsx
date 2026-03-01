import { useState, useEffect, type ReactNode } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  MdAttachMoney, MdSettings, MdCampaign, MdExplore, MdHandshake,
  MdTrackChanges, MdPalette, MdStars, MdBarChart, MdTrendingUp,
  MdCheck, MdWarning,
} from 'react-icons/md';
import { apiCall } from '../lib/firebase';
import { DISPLAY_NAME_MAP } from '../lib/types';
import { Card, Skeleton, AgentAvatar } from '../components/ui';

/* ── Types ── */
interface SkillDetail {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  methodology: string;
  tools_granted: string[];
  version: number;
  created_at: string;
  updated_at: string;
}

interface AgentAssignment {
  id: string;
  agent_role: string;
  proficiency: string;
  times_used: number;
  successes: number;
  failures: number;
  last_used_at: string | null;
  learned_refinements: string[];
  failure_modes: string[];
  assigned_at: string;
}

const CATEGORY_META: Record<string, { label: string; color: string; icon: ReactNode }> = {
  finance:            { label: 'Finance',           color: '#0369A1', icon: <MdAttachMoney className="inline h-4 w-4" /> },
  engineering:        { label: 'Engineering',       color: '#2563EB', icon: <MdSettings className="inline h-4 w-4" /> },
  marketing:          { label: 'Marketing',         color: '#7C3AED', icon: <MdCampaign className="inline h-4 w-4" /> },
  product:            { label: 'Product',           color: '#0891B2', icon: <MdExplore className="inline h-4 w-4" /> },
  'customer-success': { label: 'Customer Success',  color: '#0E7490', icon: <MdHandshake className="inline h-4 w-4" /> },
  sales:              { label: 'Sales',             color: '#1D4ED8', icon: <MdTrackChanges className="inline h-4 w-4" /> },
  design:             { label: 'Design',            color: '#DB2777', icon: <MdPalette className="inline h-4 w-4" /> },
  leadership:         { label: 'Leadership',        color: '#7C3AED', icon: <MdStars className="inline h-4 w-4" /> },
  operations:         { label: 'Operations',        color: '#EA580C', icon: <MdBarChart className="inline h-4 w-4" /> },
  analytics:          { label: 'Analytics',         color: '#059669', icon: <MdTrendingUp className="inline h-4 w-4" /> },
};

const PROFICIENCY_COLOR: Record<string, string> = {
  learning:  'bg-slate-500/15 text-slate-400 border-slate-500/30',
  competent: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  expert:    'bg-cyan/15 text-cyan border-cyan/30',
  master:    'bg-amber-500/15 text-amber-400 border-amber-500/30',
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function SkillDetailPage() {
  const { slug } = useParams();
  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [assignments, setAssignments] = useState<AgentAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);

      const skillData = await apiCall<SkillDetail>(`/api/skills?slug=${slug}`).catch(() => null);

      if (skillData) {
        const typed = skillData;
        setSkill(typed);

        const agentSkills = await apiCall<AgentAssignment[]>(`/api/agent-skills?skill_id=${typed.id}`).catch(() => []);

        setAssignments(agentSkills ?? []);
      }

      setLoading(false);
    })();
  }, [slug]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-txt-faint">Skill not found</p>
        <Link to="/skills" className="text-sm text-cyan hover:underline">← All Skills</Link>
      </div>
    );
  }

  const meta = CATEGORY_META[skill.category];
  const totalUsage = assignments.reduce((s, a) => s + a.times_used, 0);
  const totalSuccesses = assignments.reduce((s, a) => s + a.successes, 0);
  const totalFailures = assignments.reduce((s, a) => s + a.failures, 0);
  const overallSuccessRate = totalUsage > 0 ? ((totalSuccesses / totalUsage) * 100).toFixed(1) : '—';

  // Collect all unique refinements and failure modes across agents
  const allRefinements = [...new Set(assignments.flatMap((a) => a.learned_refinements))];
  const allFailureModes = [...new Set(assignments.flatMap((a) => a.failure_modes))];

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link to="/skills" className="inline-flex items-center gap-1 text-sm text-txt-muted transition-colors hover:text-cyan">
        <span>‹</span> All Skills
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
              style={{ backgroundColor: `${meta?.color ?? '#666'}15`, color: meta?.color }}
            >
              {meta?.icon} {meta?.label ?? skill.category}
            </span>
            <span className="text-[11px] text-txt-faint">v{skill.version}</span>
          </div>
          <h1 className="text-2xl font-bold text-txt-primary">{skill.name}</h1>
          <p className="mt-1 text-sm text-txt-muted">{skill.description}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Agents', value: String(assignments.length) },
          { label: 'Total Usage', value: String(totalUsage) },
          { label: 'Success Rate', value: overallSuccessRate !== '—' ? `${overallSuccessRate}%` : '—' },
          { label: 'Failures', value: String(totalFailures) },
        ].map((s) => (
          <Card key={s.label} className="text-center py-3">
            <p className="text-xl font-bold text-txt-primary">{s.value}</p>
            <p className="text-[10px] font-medium uppercase tracking-wider text-txt-faint">{s.label}</p>
          </Card>
        ))}
      </div>

      {/* Methodology */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">Methodology</h3>
        <pre className="whitespace-pre-wrap text-sm leading-relaxed text-txt-secondary font-sans">
          {skill.methodology}
        </pre>
      </Card>

      {/* Tools granted */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">
          Tools Granted ({skill.tools_granted.length})
        </h3>
        <div className="flex flex-wrap gap-2">
          {skill.tools_granted.map((t) => (
            <span key={t} className="rounded-lg border border-cyan/20 bg-cyan/5 px-3 py-1.5 font-mono text-[12px] text-cyan/80">
              {t}
            </span>
          ))}
        </div>
      </Card>

      {/* Agent Assignments */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">
          Agent Assignments ({assignments.length})
        </h3>
        {assignments.length > 0 ? (
          <div className="space-y-2">
            {assignments.map((a) => {
              const successRate = a.times_used > 0
                ? ((a.successes / a.times_used) * 100).toFixed(0)
                : null;
              return (
                <Link
                  key={a.id}
                  to={`/agents/${a.agent_role}`}
                  className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2.5 transition-colors hover:border-cyan/30"
                >
                  <AgentAvatar role={a.agent_role} size={32} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-txt-primary">
                      {DISPLAY_NAME_MAP[a.agent_role] ?? a.agent_role}
                    </p>
                    <p className="text-[11px] text-txt-faint">
                      {a.times_used > 0 ? `${a.times_used} uses · ${successRate}% success` : 'Not yet used'}
                      {a.last_used_at ? ` · Last: ${timeAgo(a.last_used_at)}` : ''}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${PROFICIENCY_COLOR[a.proficiency] ?? PROFICIENCY_COLOR.learning}`}>
                    {a.proficiency}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-txt-faint">No agents assigned to this skill yet.</p>
        )}
      </Card>

      {/* Collective Learnings */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Refinements */}
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">
            Learned Refinements ({allRefinements.length})
          </h3>
          {allRefinements.length > 0 ? (
            <ul className="space-y-1.5">
              {allRefinements.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-txt-secondary">
                  <MdCheck className="mt-1 h-4 w-4 text-tier-green" />
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-txt-faint">No refinements learned yet. These accumulate as agents use the skill.</p>
          )}
        </Card>

        {/* Failure Modes */}
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">
            Known Failure Modes ({allFailureModes.length})
          </h3>
          {allFailureModes.length > 0 ? (
            <ul className="space-y-1.5">
              {allFailureModes.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-txt-secondary">
                  <MdWarning className="mt-1 h-4 w-4 text-tier-red" />
                  {f}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-txt-faint">No failure modes recorded yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
