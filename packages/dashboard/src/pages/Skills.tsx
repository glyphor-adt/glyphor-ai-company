import { useState, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  MdAttachMoney, MdSettings, MdCampaign, MdExplore, MdHandshake,
  MdTrackChanges, MdPalette, MdStars, MdBarChart, MdTrendingUp,
} from 'react-icons/md';
import { supabase } from '../lib/supabase';
import { DISPLAY_NAME_MAP } from '../lib/types';
import { Card, SectionHeader, Skeleton, AgentAvatar } from '../components/ui';

/* ── Types ── */
interface SkillRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  tools_granted: string[];
  version: number;
  agent_count: number;
}

interface AgentSkillRow {
  agent_role: string;
  skill_id: string;
  proficiency: string;
  times_used: number;
  successes: number;
  failures: number;
  skill: {
    slug: string;
    name: string;
    category: string;
  };
}

const CATEGORY_META: Record<string, { label: string; color: string; icon: ReactNode }> = {
  finance:            { label: 'Finance',           color: '#4B9FE1', icon: <MdAttachMoney className="inline h-4 w-4" /> },
  engineering:        { label: 'Engineering',       color: '#0097FF', icon: <MdSettings className="inline h-4 w-4" /> },
  marketing:          { label: 'Marketing',         color: '#7B68EE', icon: <MdCampaign className="inline h-4 w-4" /> },
  product:            { label: 'Product',           color: '#00E0FF', icon: <MdExplore className="inline h-4 w-4" /> },
  'customer-success': { label: 'Customer Success',  color: '#00BCD4', icon: <MdHandshake className="inline h-4 w-4" /> },
  sales:              { label: 'Sales',             color: '#5B8DEF', icon: <MdTrackChanges className="inline h-4 w-4" /> },
  design:             { label: 'Design',            color: '#E91E63', icon: <MdPalette className="inline h-4 w-4" /> },
  leadership:         { label: 'Leadership',        color: '#623CEA', icon: <MdStars className="inline h-4 w-4" /> },
  operations:         { label: 'Operations',        color: '#FF6B35', icon: <MdBarChart className="inline h-4 w-4" /> },
  analytics:          { label: 'Analytics',         color: '#10B981', icon: <MdTrendingUp className="inline h-4 w-4" /> },
};

const PROFICIENCY_COLOR: Record<string, string> = {
  learning:  'bg-slate-500/15 text-slate-400',
  competent: 'bg-blue-500/15 text-blue-400',
  expert:    'bg-cyan/15 text-cyan',
  master:    'bg-amber-500/15 text-amber-400',
};

export default function Skills() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [topAgents, setTopAgents] = useState<AgentSkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);

      // Load all skills
      const { data: skillsData } = await supabase
        .from('skills')
        .select('id, slug, name, category, description, tools_granted, version')
        .order('category')
        .order('name');

      // Load agent_skills to compute agent counts and top performers
      const { data: agentSkillsData } = await supabase
        .from('agent_skills')
        .select('agent_role, proficiency, times_used, successes, failures, skill_id');

      // Load skills for join
      const skillMap = new Map((skillsData ?? []).map((s: SkillRow) => [s.id, s]));

      // Compute agent count per skill
      const countMap = new Map<string, number>();
      for (const as of ((agentSkillsData ?? []) as AgentSkillRow[])) {
        countMap.set(as.skill_id, (countMap.get(as.skill_id) ?? 0) + 1);
      }

      const enrichedSkills: SkillRow[] = (skillsData ?? []).map((s: SkillRow) => ({
        ...s,
        agent_count: countMap.get(s.id) ?? 0,
      }));

      setSkills(enrichedSkills);

      // Top agents by usage
      const topByUsage = (agentSkillsData ?? [])
        .filter((as: AgentSkillRow) => as.times_used > 0)
        .sort((a: AgentSkillRow, b: AgentSkillRow) => b.times_used - a.times_used)
        .slice(0, 8)
        .map((as: AgentSkillRow) => {
          const skill = skillMap.get((as as unknown as { skill_id: string }).skill_id);
          return {
            ...as,
            skill: skill ? { slug: skill.slug, name: skill.name, category: skill.category } : { slug: '', name: 'Unknown', category: '' },
          };
        });

      setTopAgents(topByUsage);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-3 gap-4"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  // Group skills by category
  const categories = [...new Set(skills.map((s) => s.category))];
  const filtered = filter ? skills.filter((s) => s.category === filter) : skills;

  // Stats
  const totalSkills = skills.length;
  const totalAssignments = skills.reduce((s, sk) => s + sk.agent_count, 0);
  const categoryCounts = categories.map((c) => ({
    category: c,
    count: skills.filter((s) => s.category === c).length,
  }));

  return (
    <div className="space-y-6">
      <SectionHeader title="Skill Library" />

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="text-center py-3">
          <p className="text-2xl font-bold text-txt-primary">{totalSkills}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-txt-faint">Total Skills</p>
        </Card>
        <Card className="text-center py-3">
          <p className="text-2xl font-bold text-txt-primary">{categories.length}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-txt-faint">Categories</p>
        </Card>
        <Card className="text-center py-3">
          <p className="text-2xl font-bold text-txt-primary">{totalAssignments}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-txt-faint">Agent Assignments</p>
        </Card>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter(null)}
          className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
            !filter
              ? 'bg-cyan/15 text-cyan border border-cyan/30'
              : 'bg-raised text-txt-muted border border-border hover:text-txt-secondary'
          }`}
        >
          All ({totalSkills})
        </button>
        {categoryCounts.map(({ category, count }) => {
          const meta = CATEGORY_META[category];
          return (
            <button
              key={category}
              onClick={() => setFilter(filter === category ? null : category)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                filter === category
                  ? 'border text-white'
                  : 'bg-raised text-txt-muted border border-border hover:text-txt-secondary'
              }`}
              style={filter === category ? { backgroundColor: `${meta?.color ?? '#666'}25`, borderColor: `${meta?.color ?? '#666'}50`, color: meta?.color } : undefined}
            >
              {meta?.icon} {meta?.label ?? category} ({count})
            </button>
          );
        })}
      </div>

      {/* Skills grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((skill) => {
          const meta = CATEGORY_META[skill.category];
          return (
            <Link
              key={skill.slug}
              to={`/skills/${skill.slug}`}
              className="group"
            >
              <Card className="h-full transition-all hover:border-cyan/30 hover:shadow-[0_0_15px_rgba(0,224,255,0.08)]">
                <div className="flex items-start justify-between mb-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ backgroundColor: `${meta?.color ?? '#666'}15`, color: meta?.color }}
                  >
                    {meta?.icon} {meta?.label ?? skill.category}
                  </span>
                  <span className="text-[10px] text-txt-faint">v{skill.version}</span>
                </div>
                <h3 className="text-sm font-semibold text-txt-primary group-hover:text-cyan transition-colors">
                  {skill.name}
                </h3>
                <p className="mt-1 text-[12px] text-txt-muted line-clamp-2">{skill.description}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] text-txt-faint">
                    {skill.agent_count} agent{skill.agent_count !== 1 ? 's' : ''}
                  </span>
                  <div className="flex gap-1">
                    {skill.tools_granted.slice(0, 3).map((t) => (
                      <span key={t} className="rounded bg-raised px-1.5 py-0.5 font-mono text-[9px] text-txt-faint">
                        {t}
                      </span>
                    ))}
                    {skill.tools_granted.length > 3 && (
                      <span className="text-[9px] text-txt-faint">+{skill.tools_granted.length - 3}</span>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Top Skill Users */}
      {topAgents.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">
            Top Skill Users
          </h3>
          <div className="space-y-2">
            {topAgents.map((as, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2">
                <AgentAvatar role={as.agent_role} size={28} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-txt-primary">{DISPLAY_NAME_MAP[as.agent_role] ?? as.agent_role}</p>
                  <p className="text-[11px] text-txt-faint">{as.skill.name}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${PROFICIENCY_COLOR[as.proficiency] ?? PROFICIENCY_COLOR.learning}`}>
                  {as.proficiency}
                </span>
                <span className="text-[11px] text-txt-muted font-mono">{as.times_used}×</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
