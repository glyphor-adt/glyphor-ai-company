import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, SCHEDULER_URL } from '../lib/supabase';
import {
  DISPLAY_NAME_MAP,
  AGENT_META,
  AGENT_SKILLS,
  AGENT_SOUL,
  ROLE_TIER,
  ROLE_DEPARTMENT,
  ROLE_TITLE,
  SUB_TEAM,
} from '../lib/types';
import { Card, AgentAvatar, Skeleton, timeAgo } from '../components/ui';
import { QualityChart } from '../components/QualityChart';
import { GrowthAreas } from '../components/GrowthAreas';
import { PeerFeedback } from '../components/PeerFeedback';

/* ── Types ── */
interface AgentRow {
  id: string;
  role: string;
  display_name: string;
  name?: string | null;
  title?: string | null;
  department?: string | null;
  reports_to?: string | null;
  status: string;
  model: string | null;
  temperature?: number | null;
  max_turns?: number | null;
  thinking_enabled?: boolean | null;
  budget_per_run?: number | null;
  budget_daily?: number | null;
  budget_monthly?: number | null;
  is_core?: boolean | null;
  total_runs: number;
  total_cost_usd: number;
  performance_score?: number | null;
  last_run_at?: string | null;
  created_at: string;
  schedule_cron?: string | null;
}

interface AgentProfile {
  agent_id: string;
  avatar_emoji: string | null;
  personality_summary: string | null;
  backstory: string | null;
  communication_traits: string[] | null;
  quirks: string[] | null;
  tone_formality: number | null;
  emoji_usage: number | null;
  verbosity: number | null;
  voice_sample: string | null;
  signature: string | null;
  clifton_strengths: string[] | null;
  working_style: string | null;
  voice_examples: VoiceExample[] | null;
}

interface VoiceExample {
  situation: string;
  response: string;
}

interface PerformanceDay {
  date: string;
  avg_quality_score: number | null;
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  total_cost: number;
  avg_duration_ms: number | null;
  total_tool_calls: number;
  decisions_filed: number;
  incidents_created: number;
  incidents_resolved: number;
  max_quality_score: number | null;
  min_quality_score: number | null;
}

interface Milestone {
  id: string;
  type: string;
  title: string;
  description: string | null;
  quality_score: number | null;
  created_at: string;
}

interface GrowthArea {
  dimension: string;
  direction: string;
  current_value: number;
  previous_value: number;
  period: string;
  evidence: string | null;
}

interface FeedbackRow {
  id: string;
  from_agent: string;
  to_agent: string;
  feedback: string;
  context: string | null;
  sentiment: string;
  created_at: string;
}

interface MemoryRow {
  id: string;
  agent_role: string;
  memory_type: string;
  content: string;
  importance: number;
  created_at: string;
}

interface ActivityRow {
  id: string;
  agent_role: string;
  action: string;
  summary: string;
  created_at: string;
}

type Tab = 'overview' | 'performance' | 'memory' | 'messages' | 'settings';

export default function AgentProfile() {
  const { agentId } = useParams();
  const [tab, setTab] = useState<Tab>('overview');
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agentId) return;
    (async () => {
      setLoading(true);
      // Load agent + profile in parallel
      let { data: agentData } = await supabase
        .from('company_agents').select('*').eq('role', agentId).single();
      if (!agentData) {
        ({ data: agentData } = await supabase
          .from('company_agents').select('*').eq('id', agentId).single());
      }

      let profileData: AgentProfile | null = null;
      if (agentData) {
        const role = (agentData as unknown as AgentRow).role;
        const { data: p } = await supabase
          .from('agent_profiles').select('*').eq('agent_id', role).single();
        profileData = p as AgentProfile | null;
      }

      setAgent(agentData as unknown as AgentRow | null);
      setProfile(profileData);
      setLoading(false);
    })();
  }, [agentId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-28 w-full" />
        <div className="grid grid-cols-2 gap-6"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <p className="text-sm text-txt-faint">Agent not found</p>
        <Link to="/agents" className="text-sm text-cyan hover:underline">← All Agents</Link>
      </div>
    );
  }

  const displayName = agent.name ?? DISPLAY_NAME_MAP[agent.role] ?? agent.display_name;
  const titleText = ROLE_TITLE[agent.role] ?? agent.title ?? agent.role;
  const department = ROLE_DEPARTMENT[agent.role] ?? agent.department ?? '';
  const reportsToName = agent.reports_to
    ? DISPLAY_NAME_MAP[agent.reports_to] ?? agent.reports_to
    : agent.role === 'chief-of-staff' ? 'Kristina & Andrew (Founders)'
    : agent.role === 'ops' ? 'Kristina & Andrew (Founders)'
    : undefined;
  const daysSinceCreated = Math.max(1, Math.floor((Date.now() - new Date(agent.created_at).getTime()) / 86400000));

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'performance', label: 'Performance' },
    { key: 'memory', label: 'Memory' },
    { key: 'messages', label: 'Messages' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Link to="/agents" className="inline-flex items-center gap-1 text-sm text-txt-muted transition-colors hover:text-cyan">
        <span>‹</span> All Agents
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <AgentAvatar role={agent.role} size={64} glow={agent.status === 'active'} />
          <div>
            <h1 className="text-2xl font-bold text-txt-primary">{displayName}</h1>
            <p className="text-sm text-txt-muted">{titleText}</p>
            <p className="mt-0.5 text-[12px] text-txt-faint">
              {department} · Reports to {reportsToName ?? 'Founders'}
              <span className="ml-2">·</span>
              <span className="ml-2">Active since {new Date(agent.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ({daysSinceCreated}d)</span>
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                agent.status === 'active' ? 'bg-tier-green/15 text-tier-green'
                : agent.status === 'paused' ? 'bg-tier-yellow/15 text-tier-yellow'
                : 'bg-slate-500/15 text-slate-400'
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${
                  agent.status === 'active' ? 'bg-tier-green' : agent.status === 'paused' ? 'bg-tier-yellow' : 'bg-slate-500'
                }`} />
                {agent.status}
              </span>
              <span className="text-[11px] text-txt-faint">·</span>
              <span className="font-mono text-[11px] text-txt-muted">{agent.model ?? 'gemini-3-flash-preview'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link to={`/chat/${agent.role}`} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-txt-secondary transition-colors hover:border-cyan hover:text-cyan">
            Chat
          </Link>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-5 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-b-2 border-cyan text-cyan'
                : 'text-txt-muted hover:text-txt-secondary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && <OverviewTab agent={agent} profile={profile} />}
      {tab === 'performance' && <PerformanceTab agent={agent} />}
      {tab === 'memory' && <MemoryTab agent={agent} />}
      {tab === 'messages' && <MessagesTab agent={agent} />}
      {tab === 'settings' && <SettingsTab agent={agent} profile={profile} onUpdate={setAgent} />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   OVERVIEW TAB
   ════════════════════════════════════════════════════════════════ */
function OverviewTab({ agent, profile }: { agent: AgentRow; profile: AgentProfile | null }) {
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const skills = AGENT_SKILLS[agent.role] ?? [];
  const directReports = SUB_TEAM.filter((m) => m.reportsTo === agent.role);
  const soul = AGENT_SOUL[agent.role];
  const tier = ROLE_TIER[agent.role] ?? 'Agent';
  const department = ROLE_DEPARTMENT[agent.role] ?? agent.department ?? '';

  useEffect(() => {
    supabase
      .from('activity_log')
      .select('id, agent_role, action, summary, created_at')
      .eq('agent_role', agent.role)
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data }) => setActivity((data as unknown as ActivityRow[]) ?? []));
  }, [agent.role]);

  // Derive thinking level from temperature
  const thinkingLevel = (agent.temperature ?? 0.3) <= 0.2
    ? 'Precise' : (agent.temperature ?? 0.3) <= 0.5
    ? 'Balanced' : (agent.temperature ?? 0.3) <= 0.8
    ? 'Creative' : 'Exploratory';

  return (
    <div className="space-y-6">
      {/* Soul */}
      {soul && (
        <Card>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-txt-primary">Soul</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan">Mission</p>
              <p className="mt-1.5 text-sm leading-relaxed text-txt-secondary">{soul.mission}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan">Persona</p>
              <p className="mt-1.5 text-sm leading-relaxed text-txt-secondary">{soul.persona}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan">Tone</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {soul.tone.split(', ').map((t) => (
                  <span key={t} className="rounded-full border border-cyan/20 bg-cyan/10 px-2.5 py-0.5 text-[11px] font-medium text-cyan capitalize">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan">Ethics</p>
              <p className="mt-1.5 text-sm leading-relaxed text-txt-secondary">{soul.ethics}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Configuration */}
      <Card>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-txt-primary">Configuration</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Agent ID</p>
            <p className="mt-1 font-mono text-sm text-txt-secondary">{agent.role}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Type</p>
            <p className="mt-1 text-sm text-txt-secondary">{agent.is_core ? 'Core' : 'Extended'}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Tier</p>
            <span className={`mt-1 inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
              tier === 'Orchestrator' ? 'border-accent/30 bg-accent/15 text-accent'
              : tier === 'Executive' ? 'border-azure/30 bg-azure/15 text-azure'
              : tier === 'Specialist' ? 'border-cyan/30 bg-cyan/15 text-cyan'
              : 'border-border bg-raised text-txt-secondary'
            }`}>
              {tier}
            </span>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Office</p>
            <p className="mt-1 text-sm text-txt-secondary">{department}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Thinking Level</p>
            <p className="mt-1 text-sm text-txt-secondary">{thinkingLevel}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Model</p>
            <p className="mt-1 font-mono text-sm text-txt-secondary">{agent.model ?? 'gemini-3-flash-preview'}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Created</p>
            <p className="mt-1 text-sm text-txt-secondary">{new Date(agent.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Status</p>
            <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              agent.status === 'active' ? 'bg-tier-green/15 text-tier-green'
              : agent.status === 'paused' ? 'bg-tier-yellow/15 text-tier-yellow'
              : 'bg-slate-500/15 text-slate-400'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${
                agent.status === 'active' ? 'bg-tier-green' : agent.status === 'paused' ? 'bg-tier-yellow' : 'bg-slate-500'
              }`} />
              {agent.status}
            </span>
          </div>
        </div>
      </Card>

      {/* Skills */}
      {skills.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">
            Skills ({skills.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {skills.map((s) => (
              <span key={s} className="rounded-lg border border-cyan/20 bg-cyan/5 px-3 py-1.5 font-mono text-[12px] text-cyan/80 transition-colors hover:bg-cyan/10 hover:text-cyan">
                {s}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Personality + Communication (two-column) */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Personality */}
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">Personality</h3>
          {profile?.personality_summary ? (
            <p className="text-sm leading-relaxed text-txt-secondary italic">"{profile.personality_summary}"</p>
          ) : (
            <p className="text-sm text-txt-faint">No personality summary defined</p>
          )}
          {profile?.clifton_strengths && profile.clifton_strengths.length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">CliftonStrengths</p>
              <p className="mt-1 text-sm text-txt-secondary">{profile.clifton_strengths.join(', ')}</p>
            </div>
          )}
          {profile?.working_style && (
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Working Style</p>
              <p className="mt-1 text-sm text-txt-secondary capitalize">{profile.working_style}</p>
            </div>
          )}
        </Card>

        {/* Communication Style */}
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">Communication Style</h3>
          {profile?.communication_traits && profile.communication_traits.length > 0 ? (
            <ul className="space-y-1.5">
              {profile.communication_traits.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-txt-secondary">
                  <span className="mt-1 text-txt-faint">•</span>
                  <span className="capitalize">{t}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-txt-faint">No communication traits defined</p>
          )}
        </Card>
      </div>

      {/* Quirks */}
      {profile?.quirks && profile.quirks.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">Quirks</h3>
          <ul className="space-y-1.5">
            {profile.quirks.map((q, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-txt-secondary">
                <span className="mt-1 text-txt-faint">•</span>
                {q}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Recent Activity + Org Structure (two-column) */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Activity */}
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">Recent Activity</h3>
          {activity.length > 0 ? (
            <ul className="space-y-2.5">
              {activity.map((a) => (
                <li key={a.id} className="flex items-start gap-3">
                  <span className="mt-0.5 text-[11px] text-txt-faint whitespace-nowrap">
                    {timeAgo(a.created_at)}
                  </span>
                  <span className="text-sm text-txt-secondary">{a.summary}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-txt-faint">No recent activity</p>
          )}
        </Card>

        {/* Org Structure */}
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">
            Org Structure
          </h3>
          {/* Reports To */}
          {agent.reports_to && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint mb-2">Reports To</p>
              <Link to={`/agents/${agent.reports_to}`} className="flex items-center gap-3 rounded-lg border border-border bg-raised px-3 py-2 transition-colors hover:border-cyan/30">
                <AgentAvatar role={agent.reports_to} size={28} />
                <div>
                  <p className="text-sm font-medium text-txt-primary">{DISPLAY_NAME_MAP[agent.reports_to] ?? agent.reports_to}</p>
                  <p className="text-[11px] text-txt-faint">{ROLE_TITLE[agent.reports_to] ?? agent.reports_to}</p>
                </div>
              </Link>
            </div>
          )}
          {/* Direct Reports */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint mb-2">
              Direct Reports ({directReports.length})
            </p>
            {directReports.length > 0 ? (
              <ul className="space-y-2">
                {directReports.map((m) => (
                  <li key={m.name}>
                    <Link to={`/agents/${m.avatar}`} className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2 transition-colors hover:border-cyan/30">
                      <img
                        src={`/avatars/${m.avatar}.png`}
                        alt={m.name}
                        className="h-7 w-7 rounded-full object-cover"
                        style={{ border: `1.5px solid ${m.color}40` }}
                      />
                      <div>
                        <p className="text-sm font-medium text-txt-primary">{m.name}</p>
                        <p className="text-[11px] text-txt-faint">{m.title}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-txt-faint">No direct reports</p>
            )}
          </div>
        </Card>
      </div>

      {/* Key Stats (last 30 days) */}
      <Card>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-txt-primary">Key Stats</h3>
        <KeyStatsGrid agent={agent} />
      </Card>
    </div>
  );
}

function KeyStatsGrid({ agent }: { agent: AgentRow }) {
  const [stats, setStats] = useState<{
    totalRuns: number; avgQuality: number | null; totalCost: number;
    successRate: number | null; avgDuration: number | null; totalToolCalls: number;
    decisions: number; incidents: number; resolved: number;
  } | null>(null);

  useEffect(() => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    supabase
      .from('agent_performance')
      .select('*')
      .eq('agent_id', agent.role)
      .gte('date', since)
      .then(({ data }) => {
        const rows = (data ?? []) as PerformanceDay[];
        if (!rows.length) {
          // Fall back to agent-level stats
          setStats({
            totalRuns: agent.total_runs,
            avgQuality: agent.performance_score != null ? Math.round(Number(agent.performance_score) * 100) : null,
            totalCost: agent.total_cost_usd,
            successRate: null, avgDuration: null, totalToolCalls: 0,
            decisions: 0, incidents: 0, resolved: 0,
          });
          return;
        }
        const totalRuns = rows.reduce((s, r) => s + r.total_runs, 0);
        const successfulRuns = rows.reduce((s, r) => s + r.successful_runs, 0);
        const qualityRows = rows.filter((r) => r.avg_quality_score != null);
        const avgQuality = qualityRows.length
          ? qualityRows.reduce((s, r) => s + r.avg_quality_score!, 0) / qualityRows.length
          : null;
        const durationRows = rows.filter((r) => r.avg_duration_ms != null);
        const avgDuration = durationRows.length
          ? durationRows.reduce((s, r) => s + r.avg_duration_ms!, 0) / durationRows.length
          : null;
        setStats({
          totalRuns,
          avgQuality: avgQuality != null ? Math.round(avgQuality) : null,
          totalCost: rows.reduce((s, r) => s + Number(r.total_cost), 0),
          successRate: totalRuns > 0 ? (successfulRuns / totalRuns) * 100 : null,
          avgDuration,
          totalToolCalls: rows.reduce((s, r) => s + r.total_tool_calls, 0),
          decisions: rows.reduce((s, r) => s + r.decisions_filed, 0),
          incidents: rows.reduce((s, r) => s + r.incidents_created, 0),
          resolved: rows.reduce((s, r) => s + r.incidents_resolved, 0),
        });
      });
  }, [agent.role, agent.total_runs, agent.total_cost_usd, agent.performance_score]);

  if (!stats) return <Skeleton className="h-16" />;

  const cells = [
    { label: 'Total runs', value: String(stats.totalRuns) },
    { label: 'Avg quality', value: stats.avgQuality != null ? `${stats.avgQuality}/100` : '—' },
    { label: 'Cost', value: `$${stats.totalCost.toFixed(2)}` },
    { label: 'Success rate', value: stats.successRate != null ? `${stats.successRate.toFixed(1)}%` : '—' },
    { label: 'Avg duration', value: stats.avgDuration != null ? `${(stats.avgDuration / 1000).toFixed(0)}s` : '—' },
    { label: 'Tool calls', value: String(stats.totalToolCalls) },
    { label: 'Decisions', value: String(stats.decisions) },
    { label: 'Incidents', value: String(stats.incidents) },
    { label: 'Resolved', value: String(stats.resolved) },
  ];

  return (
    <div className="grid grid-cols-3 gap-4 sm:grid-cols-3 lg:grid-cols-9">
      {cells.map((c) => (
        <div key={c.label} className="text-center">
          <p className="text-lg font-bold text-txt-primary">{c.value}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-txt-faint">{c.label}</p>
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   PERFORMANCE TAB
   ════════════════════════════════════════════════════════════════ */
function PerformanceTab({ agent }: { agent: AgentRow }) {
  const [perf, setPerf] = useState<PerformanceDay[]>([]);
  const [growth, setGrowth] = useState<GrowthArea[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [learnings, setLearnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const role = agent.role;

    Promise.all([
      supabase.from('agent_performance').select('*').eq('agent_id', role).order('date', { ascending: true }).limit(30),
      supabase.from('agent_growth').select('*').eq('agent_id', role),
      supabase.from('agent_milestones').select('*').eq('agent_id', role).order('created_at', { ascending: false }).limit(10),
      supabase.from('agent_peer_feedback').select('*').eq('to_agent', role).order('created_at', { ascending: false }).limit(10),
      supabase.from('agent_reflections').select('what_went_well, what_could_improve').eq('agent_role', role).order('created_at', { ascending: false }).limit(10),
    ]).then(([perfRes, growthRes, mileRes, fbRes, reflRes]) => {
      setPerf((perfRes.data ?? []) as PerformanceDay[]);
      setGrowth((growthRes.data ?? []) as GrowthArea[]);
      setMilestones((mileRes.data ?? []) as Milestone[]);
      setFeedback((fbRes.data ?? []) as FeedbackRow[]);

      // Extract unique learnings from reflections
      const allLearnings: string[] = [];
      for (const r of (reflRes.data ?? []) as { what_went_well: string[]; what_could_improve: string[] }[]) {
        if (r.what_could_improve) allLearnings.push(...r.what_could_improve);
      }
      // Deduplicate
      setLearnings([...new Set(allLearnings)].slice(0, 8));
      setLoading(false);
    });
  }, [agent.role]);

  if (loading) {
    return <div className="space-y-6"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>;
  }

  const milestoneIcon: Record<string, string> = {
    achievement: '🏆',
    incident: '🔥',
    learning: '📚',
    first: '🎉',
  };

  return (
    <div className="space-y-6">
      {/* Quality Score Trend */}
      <Card>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-txt-primary">Quality Score Trend</h3>
        <QualityChart data={perf} />
      </Card>

      {/* Growth Areas */}
      <Card>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-txt-primary">Growth Areas</h3>
        <GrowthAreas data={growth} />
      </Card>

      {/* Learnings + Milestones (two-column) */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Learnings */}
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">Learnings</h3>
          {learnings.length > 0 ? (
            <ul className="space-y-2">
              {learnings.map((l, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-txt-secondary">
                  <span className="mt-1 text-txt-faint">•</span>
                  "{l}"
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-txt-faint">No learnings captured yet</p>
          )}
        </Card>

        {/* Milestones */}
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">Milestones</h3>
          {milestones.length > 0 ? (
            <ul className="space-y-2.5">
              {milestones.map((m) => (
                <li key={m.id} className="flex items-start gap-2">
                  <span className="mt-0.5">{milestoneIcon[m.type] ?? '📌'}</span>
                  <div>
                    <p className="text-sm font-medium text-txt-primary">{m.title}</p>
                    <p className="text-[11px] text-txt-faint">
                      {new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {m.description && ` — ${m.description}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-txt-faint">No milestones yet</p>
          )}
        </Card>
      </div>

      {/* Peer Feedback */}
      <Card>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-txt-primary">Peer Feedback</h3>
        <PeerFeedback data={feedback} />
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   MEMORY TAB
   ════════════════════════════════════════════════════════════════ */
function MemoryTab({ agent }: { agent: AgentRow }) {
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('agent_memory')
      .select('*')
      .eq('agent_role', agent.role)
      .order('importance', { ascending: false })
      .limit(30);
    setMemories((data as MemoryRow[]) ?? []);
    setLoading(false);
  }, [agent.role]);

  useEffect(() => { loadMemories(); }, [loadMemories]);

  if (loading) return <Skeleton className="h-48" />;

  const typeColor: Record<string, string> = {
    fact: 'bg-blue-500/15 text-blue-400',
    pattern: 'bg-purple-500/15 text-purple-400',
    learning: 'bg-tier-green/15 text-tier-green',
    observation: 'bg-amber-500/15 text-amber-400',
    preference: 'bg-cyan/15 text-cyan',
  };

  const oldest = memories.length
    ? new Date(memories[memories.length - 1].created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—';
  const newest = memories.length
    ? new Date(memories[0].created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—';

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-txt-primary">
            What {DISPLAY_NAME_MAP[agent.role] ?? agent.display_name} Remembers
          </h3>
          <span className="text-[11px] text-txt-faint">
            {memories.length} memories · Oldest: {oldest} · Newest: {newest}
          </span>
        </div>

        {memories.length > 0 ? (
          <ul className="space-y-2">
            {memories.map((m) => (
              <li key={m.id} className="flex items-start gap-3 rounded-lg border border-border/50 px-3 py-2.5">
                <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${typeColor[m.memory_type] ?? 'bg-slate-500/15 text-slate-400'}`}>
                  {m.memory_type}
                </span>
                <span className="flex-1 text-sm text-txt-secondary">{m.content}</span>
                <span className="whitespace-nowrap text-[10px] text-txt-faint">
                  {(m.importance * 100).toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-txt-faint">No memories stored yet. Memories are created during agent runs.</p>
        )}
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   MESSAGES TAB
   ════════════════════════════════════════════════════════════════ */
interface AgentMessage {
  id: string;
  from_agent: string;
  to_agent: string;
  thread_id: string;
  message: string;
  message_type: string;
  priority: string;
  status: string;
  created_at: string;
}

interface AgentMeeting {
  id: string;
  called_by: string;
  title: string;
  meeting_type: string;
  attendees: string[];
  status: string;
  summary: string | null;
  created_at: string;
}

function MessagesTab({ agent }: { agent: AgentRow }) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [meetings, setMeetings] = useState<AgentMeeting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase
        .from('agent_messages')
        .select('*')
        .or(`from_agent.eq.${agent.role},to_agent.eq.${agent.role}`)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('agent_meetings')
        .select('id, called_by, title, meeting_type, attendees, status, summary, created_at')
        .contains('attendees', [agent.role])
        .order('created_at', { ascending: false })
        .limit(15),
    ]).then(([msgRes, mtgRes]) => {
      setMessages((msgRes.data as unknown as AgentMessage[]) ?? []);
      setMeetings((mtgRes.data as unknown as AgentMeeting[]) ?? []);
      setLoading(false);
    });
  }, [agent.role]);

  if (loading) return <Skeleton className="h-48" />;

  const received = messages.filter((m) => m.to_agent === agent.role);
  const sent = messages.filter((m) => m.from_agent === agent.role);
  const displayName = DISPLAY_NAME_MAP[agent.role] ?? agent.display_name;

  const typeColor: Record<string, string> = {
    request: 'bg-blue-500/15 text-blue-400',
    response: 'bg-tier-green/15 text-tier-green',
    info: 'bg-slate-500/15 text-slate-400',
    followup: 'bg-purple-500/15 text-purple-400',
  };

  const statusIcon: Record<string, string> = {
    scheduled: '📅',
    in_progress: '⏳',
    completed: '✅',
    cancelled: '❌',
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Received', value: received.length },
          { label: 'Sent', value: sent.length },
          { label: 'Meetings', value: meetings.length },
          { label: 'Pending', value: received.filter((m) => m.status === 'pending').length },
        ].map((s) => (
          <Card key={s.label} className="text-center py-3">
            <p className="text-xl font-bold text-txt-primary">{s.value}</p>
            <p className="text-[10px] font-medium uppercase tracking-wider text-txt-faint">{s.label}</p>
          </Card>
        ))}
      </div>

      {/* Direct Messages */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">
          Direct Messages
        </h3>
        {messages.length === 0 ? (
          <p className="text-sm text-txt-faint">No messages yet</p>
        ) : (
          <ul className="space-y-2">
            {messages.map((m) => {
              const isSent = m.from_agent === agent.role;
              const otherAgent = isSent ? m.to_agent : m.from_agent;
              return (
                <li key={m.id} className="flex items-start gap-3 rounded-lg border border-border/50 px-3 py-2.5">
                  <div className="flex flex-col items-center gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${typeColor[m.message_type] ?? typeColor.info}`}>
                      {m.message_type}
                    </span>
                    {m.priority === 'urgent' && (
                      <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold text-red-400">!</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-txt-faint">
                      {isSent ? (
                        <><span className="text-txt-secondary">{displayName}</span> → <span className="font-medium text-txt-secondary">{DISPLAY_NAME_MAP[otherAgent] ?? otherAgent}</span></>
                      ) : (
                        <><span className="font-medium text-txt-secondary">{DISPLAY_NAME_MAP[otherAgent] ?? otherAgent}</span> → <span className="text-txt-secondary">{displayName}</span></>
                      )}
                      <span className="ml-2">{timeAgo(m.created_at)}</span>
                    </p>
                    <p className="mt-0.5 text-sm text-txt-secondary">{m.message}</p>
                  </div>
                  <span className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${
                    m.status === 'pending' ? 'bg-cyan' : m.status === 'read' ? 'bg-slate-500' : 'bg-tier-green'
                  }`} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Meeting Participation */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">
          Meeting Participation
        </h3>
        {meetings.length === 0 ? (
          <p className="text-sm text-txt-faint">No meetings yet</p>
        ) : (
          <ul className="space-y-2">
            {meetings.map((m) => (
              <li key={m.id} className="flex items-start gap-3 rounded-lg border border-border/50 px-3 py-2.5">
                <span className="mt-0.5">{statusIcon[m.status] ?? '📅'}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-txt-primary">{m.title}</p>
                  <p className="text-[11px] text-txt-faint">
                    Called by {DISPLAY_NAME_MAP[m.called_by] ?? m.called_by}
                    <span className="mx-1">·</span>
                    {m.attendees.length} attendees
                    <span className="mx-1">·</span>
                    {timeAgo(m.created_at)}
                  </p>
                  {m.summary && (
                    <p className="mt-1 text-sm text-txt-secondary line-clamp-2">{m.summary}</p>
                  )}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  m.status === 'completed' ? 'bg-tier-green/15 text-tier-green'
                  : m.status === 'in_progress' ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-slate-500/15 text-slate-400'
                }`}>
                  {m.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   SETTINGS TAB
   ════════════════════════════════════════════════════════════════ */
function SettingsTab({
  agent,
  profile,
  onUpdate,
}: {
  agent: AgentRow;
  profile: AgentProfile | null;
  onUpdate: (updater: (prev: AgentRow | null) => AgentRow | null) => void;
}) {
  const [model, setModel] = useState(agent.model ?? 'gemini-3-flash-preview');
  const [temperature, setTemperature] = useState(agent.temperature ?? 0.3);
  const [maxTurns, setMaxTurns] = useState(agent.max_turns ?? 10);
  const [thinkingEnabled, setThinkingEnabled] = useState(agent.thinking_enabled ?? true);
  const [budgetPerRun, setBudgetPerRun] = useState(agent.budget_per_run ?? 0.05);
  const [budgetDaily, setBudgetDaily] = useState(agent.budget_daily ?? 0.5);
  const [budgetMonthly, setBudgetMonthly] = useState(agent.budget_monthly ?? 15);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const resp = await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agent.id)}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature, max_turns: maxTurns, thinking_enabled: thinkingEnabled, budget_per_run: budgetPerRun, budget_daily: budgetDaily, budget_monthly: budgetMonthly }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        console.error('Save failed:', err);
        return;
      }
      onUpdate((prev) => prev ? { ...prev, model, temperature, max_turns: maxTurns, thinking_enabled: thinkingEnabled, budget_per_run: budgetPerRun, budget_daily: budgetDaily, budget_monthly: budgetMonthly } : prev);
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } finally {
      setSaving(false);
    }
  };

  const handlePause = async () => {
    await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agent.id)}/pause`, { method: 'POST' });
    onUpdate((prev) => prev ? { ...prev, status: 'paused' } : prev);
  };

  const handleResume = async () => {
    await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agent.id)}/resume`, { method: 'POST' });
    onUpdate((prev) => prev ? { ...prev, status: 'active' } : prev);
  };

  const toneFormalityLabel = (v: number) =>
    v < 0.3 ? 'Casual and warm' : v < 0.7 ? 'Professional but approachable' : 'Formal and precise';
  const emojiLabel = (v: number) =>
    v < 0.2 ? 'Rarely' : v < 0.5 ? 'Occasionally' : 'Frequently';
  const verbosityLabel = (v: number) =>
    v < 0.3 ? 'Terse' : v < 0.7 ? 'Balanced' : 'Detailed';

  return (
    <div className="space-y-6">
      {/* Identity */}
      {profile && (
        <Card>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-txt-primary">Personality & Voice</h3>

          {profile.personality_summary && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Personality Summary</p>
              <p className="mt-1 rounded-lg border border-border bg-raised p-3 text-sm text-txt-secondary">{profile.personality_summary}</p>
            </div>
          )}

          {profile.communication_traits && profile.communication_traits.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Communication Traits</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {profile.communication_traits.map((t, i) => (
                  <span key={i} className="rounded-full border border-border bg-raised px-3 py-1 text-[12px] text-txt-secondary">{t}</span>
                ))}
              </div>
            </div>
          )}

          {profile.quirks && profile.quirks.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Quirks</p>
              <ul className="mt-1.5 space-y-1">
                {profile.quirks.map((q, i) => (
                  <li key={i} className="text-sm text-txt-secondary">• {q}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4 mt-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Tone</p>
              <p className="mt-1 text-sm text-txt-secondary">{toneFormalityLabel(profile.tone_formality ?? 0.5)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Emoji Usage</p>
              <p className="mt-1 text-sm text-txt-secondary">{emojiLabel(profile.emoji_usage ?? 0.1)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Verbosity</p>
              <p className="mt-1 text-sm text-txt-secondary">{verbosityLabel(profile.verbosity ?? 0.5)}</p>
            </div>
          </div>

          {profile.voice_sample && (
            <div className="mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Voice Sample</p>
              <pre className="mt-1.5 whitespace-pre-wrap rounded-lg border border-border bg-raised p-3 text-sm leading-relaxed text-txt-secondary">{profile.voice_sample}</pre>
            </div>
          )}
        </Card>
      )}

      {/* Model & Budget */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-txt-primary">Model & Budget</h3>
          <div className="flex items-center gap-2">
            {agent.status === 'active' ? (
              <button onClick={handlePause} className="rounded-lg border border-tier-yellow/30 bg-tier-yellow/10 px-3 py-1.5 text-xs font-medium text-tier-yellow hover:bg-tier-yellow/20 transition-colors">
                Pause Agent
              </button>
            ) : agent.status === 'paused' ? (
              <button onClick={handleResume} className="rounded-lg border border-tier-green/30 bg-tier-green/10 px-3 py-1.5 text-xs font-medium text-tier-green hover:bg-tier-green/20 transition-colors">
                Resume Agent
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40">
              <optgroup label="Google Gemini">
                <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview</option>
                <option value="gemini-3-flash-preview">gemini-3-flash-preview (default)</option>
                <option value="gemini-3-pro-preview">gemini-3-pro-preview</option>
                <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
                <option value="gemini-2.5-pro">gemini-2.5-pro</option>
              </optgroup>
              <optgroup label="OpenAI">
                <option value="gpt-5.2">gpt-5.2</option>
                <option value="gpt-5.2-pro">gpt-5.2-pro</option>
                <option value="gpt-5.1">gpt-5.1</option>
                <option value="gpt-5">gpt-5</option>
                <option value="gpt-5-mini">gpt-5-mini</option>
                <option value="gpt-5-nano">gpt-5-nano</option>
                <option value="gpt-4.1">gpt-4.1</option>
                <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                <option value="o3">o3</option>
                <option value="o4-mini">o4-mini</option>
              </optgroup>
              <optgroup label="Anthropic">
                <option value="claude-opus-4-6">claude-opus-4-6</option>
                <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                <option value="claude-haiku-4-5">claude-haiku-4-5</option>
              </optgroup>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Thinking</span>
            <button
              type="button"
              onClick={() => setThinkingEnabled(!thinkingEnabled)}
              className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                thinkingEnabled
                  ? 'border-cyan/40 bg-cyan/10 text-cyan'
                  : 'border-border bg-raised text-txt-faint'
              }`}
            >
              <span>{thinkingEnabled ? 'Enabled' : 'Disabled'}</span>
              <span className={`inline-flex h-5 w-9 items-center rounded-full transition-colors ${thinkingEnabled ? 'bg-cyan' : 'bg-slate-600'}`}>
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${thinkingEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
              </span>
            </button>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Temperature</span>
            <input type="number" step="0.1" min="0" max="2" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40" />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Max Turns</span>
            <input type="number" min="1" max="50" value={maxTurns} onChange={(e) => setMaxTurns(parseInt(e.target.value, 10))} className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40" />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-4">
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Per Run ($)</span>
            <input type="number" step="0.01" min="0" value={budgetPerRun} onChange={(e) => setBudgetPerRun(parseFloat(e.target.value))} className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40" />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Daily ($)</span>
            <input type="number" step="0.01" min="0" value={budgetDaily} onChange={(e) => setBudgetDaily(parseFloat(e.target.value))} className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40" />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Monthly ($)</span>
            <input type="number" step="0.01" min="0" value={budgetMonthly} onChange={(e) => setBudgetMonthly(parseFloat(e.target.value))} className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40" />
          </label>
        </div>

        {agent.budget_monthly != null && agent.budget_monthly > 0 && (
          <div className="mt-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Used this month</p>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="flex-1 h-2 rounded-full bg-raised overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan to-azure transition-all"
                  style={{ width: `${Math.min(100, (agent.total_cost_usd / agent.budget_monthly) * 100)}%` }}
                />
              </div>
              <span className="text-sm font-mono text-txt-secondary">
                ${agent.total_cost_usd.toFixed(2)} / ${agent.budget_monthly.toFixed(2)} ({Math.round((agent.total_cost_usd / agent.budget_monthly) * 100)}%)
              </span>
            </div>
          </div>
        )}

        {agent.schedule_cron && (
          <div className="mt-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Schedule</p>
            <p className="mt-1 font-mono text-sm text-txt-secondary">{agent.schedule_cron}</p>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button onClick={handleSave} disabled={saving} className="rounded-lg bg-gradient-to-r from-cyan to-azure px-6 py-2 text-sm font-semibold text-[#0B0B0C] transition-all hover:shadow-[0_0_20px_rgba(0,224,255,0.4)] disabled:opacity-40">
            {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </Card>

      {/* Voice Examples */}
      {profile?.voice_examples && profile.voice_examples.length > 0 && (
        <Card>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-txt-primary">Voice Calibration Examples</h3>
          <div className="space-y-4">
            {profile.voice_examples.map((ex, i) => (
              <details key={i} className="group rounded-lg border border-border">
                <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-txt-primary hover:text-cyan transition-colors">
                  <span>{ex.situation}</span>
                  <span className="text-txt-faint transition-transform group-open:rotate-90">▸</span>
                </summary>
                <pre className="whitespace-pre-wrap border-t border-border bg-raised/50 px-4 py-3 text-sm leading-relaxed text-txt-secondary">{ex.response}</pre>
              </details>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
