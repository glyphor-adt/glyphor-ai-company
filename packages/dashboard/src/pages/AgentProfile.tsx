import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Markdown from 'react-markdown';
import {
  MdEmojiEvents, MdLocalFireDepartment, MdMenuBook, MdCelebration,
  MdPushPin, MdCalendarToday, MdHourglassEmpty, MdCheckCircle,
  MdCancel, MdCheck, MdWarning, MdArrowForward, MdPsychology,
  MdSecurity,
} from 'react-icons/md';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { apiCall, SCHEDULER_URL } from '../lib/firebase';
import { MODELS, VERIFICATION_MODELS, getModelsByProvider, PROVIDER_LABELS } from '../lib/models';
import {
  DISPLAY_NAME_MAP,
  AGENT_META,
  AGENT_SKILLS,
  AGENT_SOUL,
  ROLE_TIER,
  ROLE_DEPARTMENT,
  ROLE_TITLE,
  ROLE_MANAGER_OVERRIDES,
} from '../lib/types';
import { getToolPlatformMeta } from '../lib/toolPlatform';
import { Card, InnerCard, AgentAvatar, Skeleton, timeAgo } from '../components/ui';
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
  avatar_url: string | null;
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

interface AgentBrief {
  agent_id: string;
  system_prompt: string | null;
  skills: string[] | null;
  tools: string[] | null;
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

type Tab = 'overview' | 'performance' | 'memory' | 'messages' | 'skills' | 'world-model' | 'settings';

export default function AgentProfile() {
  const { agentId } = useParams();
  const [tab, setTab] = useState<Tab>('overview');
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [brief, setBrief] = useState<AgentBrief | null>(null);
  const [directReports, setDirectReports] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !agent) return;
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) { setAvatarError('Only PNG, JPEG, or WebP'); return; }
    if (file.size > 2 * 1024 * 1024) { setAvatarError('Image must be under 2 MB'); return; }
    setUploadingAvatar(true);
    setAvatarError('');
    try {
      const reader = new FileReader();
      const dataUri = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const resp = await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agent.id)}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUri }),
      });
      const result = await resp.json();
      if (!resp.ok || !result.success) { setAvatarError(result.error || 'Upload failed'); return; }
      setProfile(prev => prev ? { ...prev, avatar_url: result.avatar_url } : { agent_id: agent.role, avatar_url: result.avatar_url } as AgentProfile);
    } catch (err) {
      setAvatarError(`Upload error: ${(err as Error).message}`);
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  }, [agent]);

  useEffect(() => {
    if (!agentId) return;
    (async () => {
      setLoading(true);
      // Load agent + profile in parallel
      let agentRows = await apiCall<AgentRow[]>('/api/company_agents?role=' + encodeURIComponent(agentId));
      if (!agentRows || (Array.isArray(agentRows) && agentRows.length === 0)) {
        agentRows = await apiCall<AgentRow[]>('/api/company_agents?id=' + encodeURIComponent(agentId));
      }
      const agentData = Array.isArray(agentRows) ? agentRows[0] ?? null : agentRows;

      let profileData: AgentProfile | null = null;
      let briefData: AgentBrief | null = null;
      let reportsData: AgentRow[] = [];
      if (agentData) {
        const role = agentData.role;
        const [p, b, r] = await Promise.all([
          apiCall<AgentProfile[]>('/api/agent_profiles?agent_id=' + encodeURIComponent(role)),
          apiCall<AgentBrief[]>('/api/agent_briefs?agent_id=' + encodeURIComponent(role)),
          apiCall<AgentRow[]>('/api/company_agents?reports_to=' + encodeURIComponent(role) + '&order=created_at.asc'),
        ]);
        profileData = (Array.isArray(p) ? p[0] : p) as AgentProfile | null;
        briefData = (Array.isArray(b) ? b[0] : b) as AgentBrief | null ?? null;
        reportsData = (r as AgentRow[]) ?? [];
      }

      setAgent(agentData as AgentRow | null);
      setProfile(profileData);
      setBrief(briefData);
      setDirectReports(reportsData);
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
  const effectiveReportsTo = ROLE_MANAGER_OVERRIDES[agent.role] ?? agent.reports_to ?? null;
  const reportsToName = effectiveReportsTo
    ? DISPLAY_NAME_MAP[effectiveReportsTo] ?? effectiveReportsTo
    : agent.role === 'chief-of-staff' ? 'Kristina & Andrew (Founders)'
    : agent.role === 'ops' ? 'Kristina & Andrew (Founders)'
    : undefined;
  const daysSinceCreated = Math.max(1, Math.floor((Date.now() - new Date(agent.created_at).getTime()) / 86400000));

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'performance', label: 'Performance' },
    { key: 'memory', label: 'Memory' },
    { key: 'messages', label: 'Messages' },
    { key: 'skills', label: 'Skills' },
    { key: 'world-model', label: 'World Model' },
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
          <div className="group relative">
            <AgentAvatar role={agent.role} size={64} glow={agent.status === 'active'} avatarUrl={profile?.avatar_url} />
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
              title="Change profile image"
            >
              {uploadingAvatar ? (
                <svg className="h-5 w-5 animate-spin text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeLinecap="round" /></svg>
              ) : (
                <svg className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor"><path d="M4 5a2 2 0 00-2 2v6a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 7a2 2 0 100-4 2 2 0 000 4z" /></svg>
              )}
            </button>
            <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarUpload} className="hidden" />
          </div>
          {avatarError && <span className="text-xs text-prism-critical">{avatarError}</span>}
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
                : 'bg-prism-moderate/15 text-prism-moderate'
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${
                  agent.status === 'active' ? 'bg-tier-green' : agent.status === 'paused' ? 'bg-tier-yellow' : 'bg-prism-moderate'
                }`} />
                {agent.status}
              </span>
              <span className="text-[11px] text-txt-faint">·</span>
              <span className="text-[11px] text-txt-faint">·</span>
              <span className="font-mono text-[11px] text-txt-muted">{agent.status}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link to={`/chat/${agent.role}`} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-txt-secondary transition-colors hover:border-cyan hover:text-cyan">
            Chat
          </Link>
          {agent.status === 'active' ? (
            <button
              onClick={async () => {
                await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agent.id)}/pause`, { method: 'POST' });
                setAgent((prev) => prev ? { ...prev, status: 'paused' } : prev);
              }}
              className="rounded-lg border border-tier-yellow/30 bg-tier-yellow/10 px-4 py-2 text-sm font-medium text-tier-yellow hover:bg-tier-yellow/20 transition-colors"
            >
              Pause
            </button>
          ) : agent.status === 'paused' ? (
            <button
              onClick={async () => {
                await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agent.id)}/resume`, { method: 'POST' });
                setAgent((prev) => prev ? { ...prev, status: 'active' } : prev);
              }}
              className="rounded-lg border border-tier-green/30 bg-tier-green/10 px-4 py-2 text-sm font-medium text-tier-green hover:bg-tier-green/20 transition-colors"
            >
              Resume
            </button>
          ) : null}
          <button
            onClick={() => setShowDelete(true)}
            className="rounded-lg border border-tier-red/30 bg-tier-red/10 px-4 py-2 text-sm font-medium text-tier-red hover:bg-tier-red/20 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDelete && (
        <div className="rounded-lg border border-tier-red/30 bg-tier-red/5 p-4 space-y-3">
          <p className="text-sm text-txt-secondary">
            This will <strong className="text-tier-red">permanently delete</strong> {agent.display_name || agent.role}. This cannot be undone.
          </p>
          <label className="block text-sm text-txt-faint">
            Type <strong className="text-txt-secondary">{agent.role}</strong> to confirm:
          </label>
          <input
            type="text"
            value={deleteText}
            onChange={(e) => setDeleteText(e.target.value)}
            placeholder={agent.role}
            className="w-full max-w-xs rounded-lg border border-tier-red/30 bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-tier-red/60"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                setDeleting(true);
                try {
                  const resp = await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agent.id)}?hard=true`, { method: 'DELETE' });
                  if (resp.ok) {
                    navigate('/agents');
                  } else {
                    const body = await resp.text();
                    alert(`Delete failed (${resp.status}): ${body}`);
                  }
                } catch (err: unknown) {
                  alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
                } finally {
                  setDeleting(false);
                }
              }}
              disabled={deleteText !== agent.role || deleting}
              className="rounded-lg bg-tier-red px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40"
            >
              {deleting ? 'Deleting…' : 'Permanently Delete'}
            </button>
            <button
              onClick={() => { setShowDelete(false); setDeleteText(''); }}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-txt-secondary hover:text-txt-primary transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
      {tab === 'overview' && <OverviewTab agent={agent} profile={profile} brief={brief} directReports={directReports} />}
      {tab === 'performance' && <PerformanceTab agent={agent} />}
      {tab === 'memory' && <MemoryTab agent={agent} />}
      {tab === 'messages' && <MessagesTab agent={agent} />}
      {tab === 'skills' && <SkillsTab agent={agent} brief={brief} />}
      {tab === 'world-model' && <WorldModelTab agent={agent} />}
      {tab === 'settings' && <SettingsTab agent={agent} profile={profile} onUpdate={setAgent} />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   OVERVIEW TAB
   ════════════════════════════════════════════════════════════════ */
function OverviewTab({
  agent,
  profile,
  brief,
  directReports,
}: {
  agent: AgentRow;
  profile: AgentProfile | null;
  brief: AgentBrief | null;
  directReports: AgentRow[];
}) {
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const skills = (brief?.skills && brief.skills.length > 0) ? brief.skills : (AGENT_SKILLS[agent.role] ?? []);
  const tools = brief?.tools ?? [];
  const soul = AGENT_SOUL[agent.role];
  const tier = ROLE_TIER[agent.role] ?? 'Agent';
  const department = ROLE_DEPARTMENT[agent.role] ?? agent.department ?? '';
  const effectiveReportsTo = ROLE_MANAGER_OVERRIDES[agent.role] ?? agent.reports_to ?? null;

  useEffect(() => {
    apiCall('/api/activity_log?agent_role=' + encodeURIComponent(agent.role) + '&order=created_at.desc&limit=8')
      .then((data) => setActivity((data as unknown as ActivityRow[]) ?? []));
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
            <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Created</p>
            <p className="mt-1 text-sm text-txt-secondary">{new Date(agent.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Status</p>
            <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              agent.status === 'active' ? 'bg-tier-green/15 text-tier-green'
              : agent.status === 'paused' ? 'bg-tier-yellow/15 text-tier-yellow'
              : 'bg-prism-moderate/15 text-prism-moderate'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${
                agent.status === 'active' ? 'bg-tier-green' : agent.status === 'paused' ? 'bg-tier-yellow' : 'bg-prism-moderate'
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

      {/* Tools */}
      {tools.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">
            Tools ({tools.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {tools.map((t) => {
              const pm = getToolPlatformMeta(t);
              return (
                <span key={t} className={`inline-flex items-center gap-1.5 rounded-lg border ${pm.borderColor} ${pm.bgColor} px-3 py-1.5 font-mono text-[12px] ${pm.color} transition-colors hover:opacity-80`}>
                  <span className="rounded bg-black/20 px-1 py-px text-[9px] font-semibold uppercase tracking-wider opacity-70">{pm.label}</span>
                  {t}
                </span>
              );
            })}
          </div>
        </Card>
      )}

      {/* System Prompt */}
      {brief?.system_prompt && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">System Prompt</h3>
          <InnerCard>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-txt-secondary">
              {brief.system_prompt}
            </pre>
          </InnerCard>
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
          {effectiveReportsTo && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint mb-2">Reports To</p>
              <Link to={`/agents/${effectiveReportsTo}`} className="flex items-center gap-3 rounded-xl border border-primary/20 bg-black/25 backdrop-blur-[8px] px-3 py-2 transition-colors hover:border-cyan/30">
                <AgentAvatar role={effectiveReportsTo} size={28} />
                <div>
                  <p className="text-sm font-medium text-txt-primary">{DISPLAY_NAME_MAP[effectiveReportsTo] ?? effectiveReportsTo}</p>
                  <p className="text-[11px] text-txt-faint">{ROLE_TITLE[effectiveReportsTo] ?? effectiveReportsTo}</p>
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
                  <li key={m.id}>
                    <Link to={`/agents/${m.role}`} className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2 transition-colors hover:border-cyan/30">
                      <AgentAvatar role={m.role} size={28} />
                      <div>
                        <p className="text-sm font-medium text-txt-primary">{DISPLAY_NAME_MAP[m.role] ?? m.name ?? m.display_name ?? m.role}</p>
                        <p className="text-[11px] text-txt-faint">{ROLE_TITLE[m.role] ?? m.title ?? m.role}</p>
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
    apiCall('/api/agent_performance?agent_id=' + encodeURIComponent(agent.role) + '&date=gte.' + encodeURIComponent(since))
      .then((data) => {
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
      apiCall('/api/agent_performance?agent_id=' + encodeURIComponent(role) + '&order=date.asc&limit=30'),
      apiCall('/api/agent_growth?agent_id=' + encodeURIComponent(role)),
      apiCall('/api/agent_milestones?agent_id=' + encodeURIComponent(role) + '&order=created_at.desc&limit=10'),
      apiCall('/api/agent_peer_feedback?to_agent=' + encodeURIComponent(role) + '&order=created_at.desc&limit=10'),
      apiCall('/api/agent_reflections?agent_role=' + encodeURIComponent(role) + '&order=created_at.desc&limit=10'),
    ]).then(([perfRes, growthRes, mileRes, fbRes, reflRes]) => {
      setPerf((perfRes ?? []) as PerformanceDay[]);
      setGrowth((growthRes ?? []) as GrowthArea[]);
      setMilestones((mileRes ?? []) as Milestone[]);
      setFeedback((fbRes ?? []) as FeedbackRow[]);

      // Extract unique learnings from reflections
      const allLearnings: string[] = [];
      for (const r of (reflRes ?? []) as { what_went_well: string[]; what_could_improve: string[] }[]) {
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

  const milestoneIcon: Record<string, ReactNode> = {
    achievement: <MdEmojiEvents className="inline h-4 w-4 text-prism-elevated" />,
    incident: <MdLocalFireDepartment className="inline h-4 w-4 text-prism-critical" />,
    learning: <MdMenuBook className="inline h-4 w-4 text-prism-sky" />,
    first: <MdCelebration className="inline h-4 w-4 text-prism-violet" />,
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
                  <span className="mt-0.5">{milestoneIcon[m.type] ?? <MdPushPin className="inline h-4 w-4 text-txt-faint" />}</span>
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

      {/* Constitutional Gates */}
      <ConstitutionalGatesCard agentRole={agent.role} />

      {/* Peer Feedback */}
      <Card>
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-txt-primary">Peer Feedback</h3>
        <PeerFeedback data={feedback} />
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   CONSTITUTIONAL GATES CARD
   ════════════════════════════════════════════════════════════════ */

interface GateEvent {
  id: string;
  agent_role: string;
  tool_name: string;
  check_phase: string;
  result: string;
  violations: { principle_category?: string }[] | null;
  created_at: string;
}

function ConstitutionalGatesCard({ agentRole }: { agentRole: string }) {
  const [events, setEvents] = useState<GateEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    apiCall(
      '/api/constitutional_gate_events?agent_role=' + encodeURIComponent(agentRole) +
      '&created_at=gte.' + encodeURIComponent(since) +
      '&order=created_at.desc&limit=200',
    )
      .then(data => setEvents((data ?? []) as GateEvent[]))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [agentRole]);

  if (loading) return <Skeleton className="h-32" />;
  if (events.length === 0) {
    return (
      <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary flex items-center gap-2">
          <MdSecurity className="h-4 w-4" /> Constitutional Gates
        </h3>
        <p className="text-sm text-txt-faint">No constitutional gate events in the last 30 days</p>
      </Card>
    );
  }

  const total = events.length;
  const passed = events.filter(e => e.result === 'passed').length;
  const warned = events.filter(e => e.result === 'warned').length;
  const blocked = events.filter(e => e.result === 'blocked').length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '—';
  const blockRate = total > 0 ? ((blocked / total) * 100).toFixed(1) : '—';

  // Most common violation categories
  const catCounts: Record<string, number> = {};
  for (const e of events) {
    if (e.violations && Array.isArray(e.violations)) {
      for (const v of e.violations) {
        const cat = v.principle_category ?? 'unknown';
        catCounts[cat] = (catCounts[cat] ?? 0) + 1;
      }
    }
  }
  const topCategories = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Blocks per week trend
  const weekMap: Record<string, number> = {};
  for (const e of events) {
    if (e.result === 'blocked') {
      const d = new Date(e.created_at);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().split('T')[0];
      weekMap[key] = (weekMap[key] ?? 0) + 1;
    }
  }
  const weekTrend = Object.entries(weekMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, count]) => ({ week: new Date(week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), blocks: count }));

  return (
    <Card>
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-txt-primary flex items-center gap-2">
        <MdSecurity className="h-4 w-4" /> Constitutional Gates
      </h3>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5 mb-4">
        <div className="text-center">
          <p className="text-lg font-bold text-txt-primary">{total}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-txt-faint">Total Checks</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-tier-green">{passed}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-txt-faint">Passed</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-prism-elevated">{warned}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-txt-faint">Warned</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-prism-critical">{blocked}</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-txt-faint">Blocked</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-txt-primary">{passRate}%</p>
          <p className="text-[10px] font-medium uppercase tracking-wider text-txt-faint">Pass Rate</p>
        </div>
      </div>

      {/* Two-column: violation categories + block trend */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Top violation categories */}
        {topCategories.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-txt-secondary mb-2">Top Violation Categories</h4>
            <ul className="space-y-1.5">
              {topCategories.map(([cat, count]) => (
                <li key={cat} className="flex items-center justify-between text-sm">
                  <span className="text-txt-secondary">{cat.replace(/_/g, ' ')}</span>
                  <span className="rounded-full bg-prism-moderate/15 px-2 py-0.5 text-[10px] font-semibold text-prism-moderate">
                    {count}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Blocks per week trend */}
        {weekTrend.length > 1 && (
          <div>
            <h4 className="text-xs font-semibold text-txt-secondary mb-2">Blocks per Week</h4>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={weekTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} stroke="var(--color-txt-faint)" />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="var(--color-txt-faint)" />
                <Tooltip />
                <Bar dataKey="blocks" fill="var(--color-prism-critical, #ef4444)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Card>
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
    const data = await apiCall('/api/agent_memory?agent_role=' + encodeURIComponent(agent.role) + '&order=importance.desc&limit=30');
    setMemories((data as MemoryRow[]) ?? []);
    setLoading(false);
  }, [agent.role]);

  useEffect(() => { loadMemories(); }, [loadMemories]);

  if (loading) return <Skeleton className="h-48" />;

  const typeColor: Record<string, string> = {
    fact: 'bg-prism-fill-3/15 text-prism-sky',
    pattern: 'bg-prism-violet/15 text-prism-violet',
    learning: 'bg-tier-green/15 text-tier-green',
    observation: 'bg-prism-elevated/15 text-prism-elevated',
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
                <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${typeColor[m.memory_type] ?? 'bg-prism-moderate/15 text-prism-moderate'}`}>
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
      apiCall('/api/agent_messages?or=(from_agent.eq.' + encodeURIComponent(agent.role) + ',to_agent.eq.' + encodeURIComponent(agent.role) + ')&order=created_at.desc&limit=30'),
      apiCall('/api/agent_meetings?attendees=cs.' + encodeURIComponent(JSON.stringify([agent.role])) + '&order=created_at.desc&limit=15'),
    ]).then(([msgRes, mtgRes]) => {
      setMessages((msgRes as unknown as AgentMessage[]) ?? []);
      setMeetings((mtgRes as unknown as AgentMeeting[]) ?? []);
      setLoading(false);
    });
  }, [agent.role]);

  if (loading) return <Skeleton className="h-48" />;

  const received = messages.filter((m) => m.to_agent === agent.role);
  const sent = messages.filter((m) => m.from_agent === agent.role);
  const displayName = DISPLAY_NAME_MAP[agent.role] ?? agent.display_name;

  const typeColor: Record<string, string> = {
    request: 'bg-prism-fill-3/15 text-prism-sky',
    response: 'bg-tier-green/15 text-tier-green',
    info: 'bg-prism-moderate/15 text-prism-moderate',
    followup: 'bg-prism-violet/15 text-prism-violet',
  };

  const statusIcon: Record<string, ReactNode> = {
    scheduled: <MdCalendarToday className="inline h-4 w-4 text-prism-sky" />,
    in_progress: <MdHourglassEmpty className="inline h-4 w-4 text-prism-elevated" />,
    completed: <MdCheckCircle className="inline h-4 w-4 text-tier-green" />,
    cancelled: <MdCancel className="inline h-4 w-4 text-prism-critical" />,
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
                      <span className="rounded-full bg-prism-critical/15 px-1.5 py-0.5 text-[9px] font-bold text-prism-critical">!</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-txt-faint">
                      {isSent ? (
                        <span className="flex items-center gap-1"><span className="text-txt-secondary">{displayName}</span> <MdArrowForward className="text-[10px]" /> <span className="font-medium text-txt-secondary">{DISPLAY_NAME_MAP[otherAgent] ?? otherAgent}</span></span>
                      ) : (
                        <span className="flex items-center gap-1"><span className="font-medium text-txt-secondary">{DISPLAY_NAME_MAP[otherAgent] ?? otherAgent}</span> <MdArrowForward className="text-[10px]" /> <span className="text-txt-secondary">{displayName}</span></span>
                      )}
                      <span className="ml-2">{timeAgo(m.created_at)}</span>
                    </p>
                    <div className="mt-0.5 text-sm text-txt-secondary prose-chat"><Markdown>{m.message}</Markdown></div>
                  </div>
                  <span className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${
                    m.status === 'pending' ? 'bg-cyan' : m.status === 'read' ? 'bg-prism-moderate' : 'bg-tier-green'
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
                <span className="mt-0.5">{statusIcon[m.status] ?? <MdCalendarToday className="inline h-4 w-4 text-prism-sky" />}</span>
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
                    <div className="mt-1 text-sm text-txt-secondary line-clamp-2 prose-chat"><Markdown>{m.summary}</Markdown></div>
                  )}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  m.status === 'completed' ? 'bg-tier-green/15 text-tier-green'
                  : m.status === 'in_progress' ? 'bg-prism-elevated/15 text-prism-elevated'
                  : 'bg-prism-moderate/15 text-prism-moderate'
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
   SKILLS TAB
   ════════════════════════════════════════════════════════════════ */
interface AgentSkillRow {
  id: string;
  agent_role: string;
  skill_id: string;
  proficiency: string;
  times_used: number;
  successes: number;
  failures: number;
  last_used_at: string | null;
  learned_refinements: string[];
  failure_modes: string[];
  assigned_at: string;
  skills: { slug: string; name: string; category: string; description: string; tools_granted: string[] } | null;
}

interface SkillCatalogRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  tools_granted: string[];
}

const PROF_COLOR: Record<string, string> = {
  learning:  'bg-prism-moderate/15 text-prism-moderate border-prism-moderate/30',
  competent: 'bg-prism-fill-3/15 text-prism-sky border-prism-fill-3/30',
  expert:    'bg-cyan/15 text-cyan border-cyan/30',
  master:    'bg-prism-elevated/15 text-prism-elevated border-prism-elevated/30',
};

const CAT_COLOR: Record<string, string> = {
  finance: '#0369A1', engineering: '#2563EB', marketing: '#7C3AED',
  product: '#0891B2', 'customer-success': '#0E7490', sales: '#1D4ED8',
  design: '#DB2777', leadership: '#7C3AED', operations: '#EA580C', analytics: '#059669',
};

function SkillsTab({ agent, brief }: { agent: AgentRow; brief: AgentBrief | null }) {
  const [skills, setSkills] = useState<AgentSkillRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [agentSkillRows, skillCatalogRows] = await Promise.all([
        apiCall<AgentSkillRow[]>('/api/agent_skills?agent_role=' + encodeURIComponent(agent.role) + '&order=times_used.desc').catch(() => []),
        apiCall<SkillCatalogRow[]>('/api/skills').catch(() => []),
      ]);

      const skillById = new Map((skillCatalogRows ?? []).map((row) => [row.id, row]));
      const normalized = (agentSkillRows ?? []).map((row) => {
        const resolved = row.skills ?? skillById.get(row.skill_id) ?? null;
        return {
          ...row,
          skills: resolved
            ? {
                slug: resolved.slug,
                name: resolved.name,
                category: resolved.category,
                description: resolved.description,
                tools_granted: resolved.tools_granted ?? [],
              }
            : null,
        };
      });

      setSkills(normalized);
      setLoading(false);
    })();
  }, [agent.role]);

  if (loading) return <Skeleton className="h-48" />;

  const totalUsage = skills.reduce((s, sk) => s + sk.times_used, 0);
  const totalSuccesses = skills.reduce((s, sk) => s + sk.successes, 0);
  const overallRate = totalUsage > 0 ? ((totalSuccesses / totalUsage) * 100).toFixed(1) : '—';
  const profCounts = skills.reduce<Record<string, number>>((acc, sk) => {
    acc[sk.proficiency] = (acc[sk.proficiency] ?? 0) + 1;
    return acc;
  }, {});
  const fallbackSkills = (brief?.skills && brief.skills.length > 0) ? brief.skills : (AGENT_SKILLS[agent.role] ?? []);
  const fallbackTools = brief?.tools ?? [];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Skills', value: String(skills.length) },
          { label: 'Total Uses', value: String(totalUsage) },
          { label: 'Success Rate', value: overallRate !== '—' ? `${overallRate}%` : '—' },
          { label: 'Master-level', value: String(profCounts.master ?? 0) },
        ].map((s) => (
          <Card key={s.label} className="text-center py-3">
            <p className="text-xl font-bold text-txt-primary">{s.value}</p>
            <p className="text-[10px] font-medium uppercase tracking-wider text-txt-faint">{s.label}</p>
          </Card>
        ))}
      </div>

      {/* Skill list */}
      <Card>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">
          Assigned Skills ({skills.length})
        </h3>
        {skills.length > 0 ? (
          <div className="space-y-2">
            {skills.map((sk) => {
              const s = sk.skills;
              const rate = sk.times_used > 0 ? ((sk.successes / sk.times_used) * 100).toFixed(0) : null;
              const catColor = s ? CAT_COLOR[s.category] ?? '#666' : '#666';
              return (
                <Link
                  key={sk.id}
                  to={`/skills/${s?.slug ?? ''}`}
                  className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2.5 transition-colors hover:border-cyan/30"
                >
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ backgroundColor: `${catColor}15`, color: catColor }}
                  >
                    {s?.category ?? '?'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-txt-primary">{s?.name ?? sk.skill_id}</p>
                    <p className="text-[11px] text-txt-faint line-clamp-1">{s?.description ?? ''}</p>
                    <p className="text-[11px] text-txt-faint mt-0.5">
                      {sk.times_used > 0 ? `${sk.times_used} uses · ${rate}% success` : 'Not yet used'}
                      {sk.last_used_at ? ` · Last: ${timeAgo(sk.last_used_at)}` : ''}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${PROF_COLOR[sk.proficiency] ?? PROF_COLOR.learning}`}>
                    {sk.proficiency}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {fallbackSkills.length > 0 ? (
              <>
                <p className="text-xs text-txt-muted">No runtime skill telemetry yet. Showing configured capabilities.</p>
                <div className="flex flex-wrap gap-2">
                  {fallbackSkills.map((s) => (
                    <span key={s} className="rounded-lg border border-cyan/20 bg-cyan/5 px-3 py-1.5 font-mono text-[12px] text-cyan/80">
                      {s}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-txt-faint">No skills assigned to this agent.</p>
            )}

            {fallbackTools.length > 0 && (
              <div>
                <p className="mb-2 text-xs text-txt-muted">Configured tools</p>
                <div className="flex flex-wrap gap-2">
                  {fallbackTools.map((t) => {
                    const pm = getToolPlatformMeta(t);
                    return (
                      <span key={t} className={`inline-flex items-center gap-1.5 rounded-lg border ${pm.borderColor} ${pm.bgColor} px-3 py-1.5 font-mono text-[12px] ${pm.color}`}>
                        <span className="rounded bg-black/20 px-1 py-px text-[9px] font-semibold uppercase tracking-wider opacity-70">{pm.label}</span>
                        {t}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Refinements & Failure modes */}
      {skills.some((sk) => sk.learned_refinements.length > 0 || sk.failure_modes.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">Learned Refinements</h3>
            <ul className="space-y-1.5">
              {skills.flatMap((sk) =>
                sk.learned_refinements.map((r, i) => (
                  <li key={`${sk.id}-r-${i}`} className="flex items-start gap-2 text-sm text-txt-secondary">
                    <MdCheck className="mt-1 h-4 w-4 text-tier-green" />
                    <span><span className="text-txt-faint">[{sk.skills?.name}]</span> {r}</span>
                  </li>
                ))
              )}
            </ul>
          </Card>
          <Card>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-txt-primary">Failure Modes</h3>
            <ul className="space-y-1.5">
              {skills.flatMap((sk) =>
                sk.failure_modes.map((f, i) => (
                  <li key={`${sk.id}-f-${i}`} className="flex items-start gap-2 text-sm text-txt-secondary">
                    <MdWarning className="mt-1 h-4 w-4 text-tier-red" />
                    <span><span className="text-txt-faint">[{sk.skills?.name}]</span> {f}</span>
                  </li>
                ))
              )}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   WORLD MODEL TAB
   ════════════════════════════════════════════════════════════════ */

interface WorldModelRow {
  id: string;
  agent_role: string;
  updated_at: string;
  strengths: { dimension: string; evidence: string; confidence: number }[];
  weaknesses: { dimension: string; evidence: string; confidence: number }[];
  blindspots: string[];
  failure_patterns: { pattern: string; occurrences: number; lastSeen: string }[];
  task_type_scores: Record<string, { avgScore: number; count: number; trend: string }>;
  prediction_accuracy: number;
  improvement_goals: { dimension: string; currentScore: number; targetScore: number; strategy: string; progress: number }[];
}

interface RubricDimension {
  name: string;
  weight: number;
}

interface RubricRow {
  id: string;
  role: string;
  task_type: string;
  version: number;
  dimensions: RubricDimension[];
  passing_score: number;
  excellence_score: number;
}

const TREND_ICONS: Record<string, string> = { improving: '↑', declining: '↓', stable: '→' };

function wmScoreColor(score: number): string {
  if (score >= 4.2) return 'text-prism-teal';
  if (score >= 3.0) return 'text-tier-yellow';
  return 'text-prism-critical';
}

function WorldModelTab({ agent }: { agent: AgentRow }) {
  const [model, setModel] = useState<WorldModelRow | null>(null);
  const [rubrics, setRubrics] = useState<RubricRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [wmRows, rubricRows] = await Promise.all([
        apiCall('/api/agent_world_model?agent_role=' + encodeURIComponent(agent.role)),
        apiCall('/api/role_rubrics?or=(role.eq.' + encodeURIComponent(agent.role) + ',role.eq._default)&order=role.asc'),
      ]);
      setModel(Array.isArray(wmRows) ? (wmRows[0] as WorldModelRow ?? null) : wmRows as WorldModelRow | null);
      setRubrics((rubricRows as RubricRow[]) ?? []);
      setLoading(false);
    })();
  }, [agent.role]);

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-64" /><Skeleton className="h-48" /></div>;
  }

  if (!model) {
    return (
      <Card className="flex h-48 flex-col items-center justify-center gap-2 p-6">
        <MdPsychology className="text-3xl text-txt-faint" />
        <p className="text-sm text-txt-muted">No world model data yet for this agent.</p>
        <p className="text-xs text-txt-faint">World model data is built as the agent completes evaluated tasks.</p>
      </Card>
    );
  }

  // Radar data from task_type_scores
  const radarData = Object.entries(model.task_type_scores).map(([type, score]) => ({
    taskType: type.replace(/_/g, ' '),
    score: score.avgScore,
    fullMark: 5,
  }));

  // Goal progress data
  const goalData = model.improvement_goals.map(g => ({
    name: g.dimension,
    current: g.currentScore,
    target: g.targetScore,
  }));

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 text-center">
          <p className="text-xs text-txt-muted">Prediction Accuracy</p>
          <p className={`text-2xl font-bold ${wmScoreColor(model.prediction_accuracy * 5)}`}>
            {(model.prediction_accuracy * 100).toFixed(0)}%
          </p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-xs text-txt-muted">Strengths</p>
          <p className="text-2xl font-bold text-prism-teal">{model.strengths.length}</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-xs text-txt-muted">Failure Patterns</p>
          <p className="text-2xl font-bold text-prism-critical">{model.failure_patterns.length}</p>
        </Card>
      </div>

      {/* Task Performance Radar */}
      {radarData.length >= 3 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-txt-primary mb-3">Task Performance</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData}>
                <PolarGrid stroke="var(--color-border)" />
                <PolarAngleAxis dataKey="taskType" tick={{ fill: 'var(--color-txt-muted)', fontSize: 11 }} />
                <PolarRadiusAxis angle={30} domain={[0, 5]} tick={{ fill: 'var(--color-txt-faint)', fontSize: 9 }} />
                <Radar name="Score" dataKey="score" stroke="#818cf8" fill="#818cf8" fillOpacity={0.3} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Task Type Scores table (fallback when < 3 dimensions for radar) */}
      {radarData.length > 0 && radarData.length < 3 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-txt-primary mb-3">Task Performance</h3>
          {Object.entries(model.task_type_scores).map(([type, score]) => (
            <div key={type} className="flex items-center justify-between text-sm py-1">
              <span className="text-txt-muted">{type.replace(/_/g, ' ')}</span>
              <span className={`font-mono ${wmScoreColor(score.avgScore)}`}>
                {score.avgScore.toFixed(1)} {TREND_ICONS[score.trend] ?? ''} <span className="text-txt-faint text-xs">({score.count} runs)</span>
              </span>
            </div>
          ))}
        </Card>
      )}

      {/* Strengths & Weaknesses */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-prism-teal mb-3">Strengths</h3>
          {model.strengths.length === 0 ? (
            <p className="text-xs text-txt-faint">No strengths recorded yet</p>
          ) : (
            <ul className="space-y-2">
              {model.strengths.map((s, i) => (
                <li key={i} className="text-sm text-txt-secondary">
                  <span className="text-prism-teal mr-1">✓</span> {s.dimension}
                  <span className="text-txt-faint text-xs ml-1">({(s.confidence * 100).toFixed(0)}% confidence)</span>
                  {s.evidence && <p className="text-xs text-txt-faint mt-0.5 ml-4">{s.evidence}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-prism-elevated mb-3">Weaknesses</h3>
          {model.weaknesses.length === 0 ? (
            <p className="text-xs text-txt-faint">No weaknesses recorded yet</p>
          ) : (
            <ul className="space-y-2">
              {model.weaknesses.map((w, i) => (
                <li key={i} className="text-sm text-txt-secondary">
                  <span className="text-prism-elevated mr-1">⚠</span> {w.dimension}
                  <span className="text-txt-faint text-xs ml-1">({(w.confidence * 100).toFixed(0)}% confidence)</span>
                  {w.evidence && <p className="text-xs text-txt-faint mt-0.5 ml-4">{w.evidence}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Improvement Goals */}
      {model.improvement_goals.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-txt-primary mb-3">Improvement Goals</h3>
          <div className="h-48 mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={goalData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis type="number" domain={[0, 5]} tick={{ fill: 'var(--color-txt-faint)', fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fill: 'var(--color-txt-muted)', fontSize: 11 }} width={100} />
                <Tooltip contentStyle={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="current" fill="#818cf8" name="Current" radius={[0, 4, 4, 0]} />
                <Bar dataKey="target" fill="#818cf830" name="Target" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {model.improvement_goals.map((g, i) => (
            <div key={i} className="mb-3">
              <div className="flex justify-between text-sm text-txt-secondary">
                <span>{g.dimension}</span>
                <span className="font-mono text-xs">{g.currentScore.toFixed(1)} → {g.targetScore.toFixed(1)}</span>
              </div>
              <div className="w-full bg-raised rounded-full h-2 mt-1">
                <div
                  className="bg-prism-fill-4 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.round((g.currentScore / g.targetScore) * 100))}%` }}
                />
              </div>
              <p className="text-[11px] text-txt-faint mt-0.5">{g.strategy}</p>
            </div>
          ))}
        </Card>
      )}

      {/* Failure Patterns */}
      {model.failure_patterns.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-prism-critical mb-3">Failure Patterns</h3>
          <ul className="space-y-2">
            {model.failure_patterns.map((fp, i) => (
              <li key={i} className="text-sm text-txt-secondary">
                <span className="text-prism-critical mr-1">⚠</span> {fp.pattern}
                <span className="text-txt-faint text-xs ml-2">({fp.occurrences}x, last: {timeAgo(fp.lastSeen)})</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Blindspots */}
      {model.blindspots.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-prism-high mb-3">Blindspots</h3>
          <ul className="space-y-1">
            {model.blindspots.map((b, i) => (
              <li key={i} className="text-sm text-txt-muted">• {b}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* Rubric Dimensions */}
      {rubrics.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-txt-primary mb-3">Evaluation Rubric</h3>
          {rubrics.map(r => (
            <div key={r.id} className="mb-3">
              <p className="text-xs font-medium text-txt-muted mb-1">
                {r.role === '_default' ? 'Default' : r.role} / {r.task_type.replace(/_/g, ' ')}
                <span className="text-txt-faint ml-2">v{r.version} · pass: {r.passing_score} · excellence: {r.excellence_score}</span>
              </p>
              <div className="flex gap-1 flex-wrap">
                {r.dimensions.map((d, i) => (
                  <span key={i} className="text-[11px] bg-raised text-txt-muted px-2 py-0.5 rounded">
                    {d.name} ({(d.weight * 100).toFixed(0)}%)
                  </span>
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}

      <p className="text-[11px] text-txt-faint text-center">
        Last updated {timeAgo(model.updated_at)}
      </p>
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
  const navigate = useNavigate();
  const [model, setModel] = useState(agent.model ?? 'gemini-3-flash-preview');
  const [temperature, setTemperature] = useState(agent.temperature ?? 0.3);
  const [maxTurns, setMaxTurns] = useState(agent.max_turns ?? 10);
  const [thinkingEnabled, setThinkingEnabled] = useState(agent.thinking_enabled ?? true);
  const [budgetPerRun, setBudgetPerRun] = useState(agent.budget_per_run ?? 0.05);
  const [budgetDaily, setBudgetDaily] = useState(agent.budget_daily ?? 0.5);
  const [budgetMonthly, setBudgetMonthly] = useState(agent.budget_monthly ?? 15);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [codePrompt, setCodePrompt] = useState('');
  const [promptSource, setPromptSource] = useState<'code' | 'db'>('code');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savedPrompt, setSavedPrompt] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);

  // Reasoning config state
  const [reasoningEnabled, setReasoningEnabled] = useState(false);
  const [reasoningPassTypes, setReasoningPassTypes] = useState<string[]>([]);
  const [reasoningMinConfidence, setReasoningMinConfidence] = useState(0.7);
  const [reasoningMaxBudget, setReasoningMaxBudget] = useState(0.02);
  const [reasoningCrossModel, setReasoningCrossModel] = useState(false);
  const [reasoningValueGate, setReasoningValueGate] = useState(true);
  const [reasoningVerificationModels, setReasoningVerificationModels] = useState<string[]>([]);
  const [reasoningLoading, setReasoningLoading] = useState(true);
  const [savingReasoning, setSavingReasoning] = useState(false);
  const [savedReasoning, setSavedReasoning] = useState(false);

  const ALL_PASS_TYPES = ['self_critique', 'consistency_check', 'factual_verification', 'goal_alignment', 'cross_model', 'value_analysis'] as const;
  const ALL_VERIFICATION_MODELS = VERIFICATION_MODELS;

  useEffect(() => {
    // Load reasoning config
    (async () => {
      setReasoningLoading(true);
      const rcData = await apiCall('/api/agent_reasoning_config?agent_role=' + encodeURIComponent(agent.role));
      const rc = Array.isArray(rcData) ? rcData[0] : rcData;
      if (rc) {
        setReasoningEnabled(rc.enabled ?? false);
        setReasoningPassTypes((rc.pass_types as string[]) ?? []);
        setReasoningMinConfidence(rc.min_confidence ?? 0.7);
        setReasoningMaxBudget(rc.max_reasoning_budget ?? 0.02);
        setReasoningCrossModel(rc.cross_model_enabled ?? false);
        setReasoningValueGate(rc.value_gate_enabled ?? true);
        setReasoningVerificationModels((rc.verification_models as string[]) ?? []);
      }
      setReasoningLoading(false);
    })();
  }, [agent.role]);

  const handleSaveReasoning = async () => {
    setSavingReasoning(true);
    try {
      await apiCall('/api/agent_reasoning_config', { method: 'PUT', body: JSON.stringify({
        agent_role: agent.role,
        enabled: reasoningEnabled,
        pass_types: reasoningPassTypes,
        min_confidence: reasoningMinConfidence,
        max_reasoning_budget: reasoningMaxBudget,
        cross_model_enabled: reasoningCrossModel,
        value_gate_enabled: reasoningValueGate,
        verification_models: reasoningVerificationModels,
        updated_at: new Date().toISOString(),
      }) });
      // Invalidate reasoning config cache
      try {
        await fetch(`${SCHEDULER_URL}/cache/invalidate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefix: `reasoning:config:${agent.role}` }),
        });
      } catch { /* best-effort */ }
      setSavedReasoning(true);
      setTimeout(() => setSavedReasoning(false), 1200);
    } finally {
      setSavingReasoning(false);
    }
  };

  useEffect(() => {
    (async () => {
      // Load code-defined prompt from scheduler
      let codeDefinedPrompt = '';
      try {
        const promptRes = await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agent.role)}/system-prompt`);
        const promptData = await promptRes.json();
        if (promptData?.system_prompt) {
          codeDefinedPrompt = promptData.system_prompt;
        }
      } catch { /* prompt endpoint not available */ }
      setCodePrompt(codeDefinedPrompt);

      // Check for custom DB override
      const briefRows = await apiCall('/api/agent_briefs?agent_id=' + encodeURIComponent(agent.role));
      const brief = Array.isArray(briefRows) ? briefRows[0] : briefRows;
      if (brief?.system_prompt) {
        setSystemPrompt(brief.system_prompt);
        setPromptSource('db');
      } else {
        setSystemPrompt(codeDefinedPrompt);
        setPromptSource('code');
      }
    })();
  }, [agent.role]);

  const handleSavePrompt = async () => {
    setSavingPrompt(true);
    try {
      const resp = await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agent.role)}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_prompt: systemPrompt }),
      });
      if (resp.ok) {
        setPromptSource('db');
        setSavedPrompt(true);
        setTimeout(() => setSavedPrompt(false), 1200);
      }
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleResetPrompt = async () => {
    setSavingPrompt(true);
    try {
      const resp = await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agent.role)}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_prompt: null }),
      });
      if (resp.ok) {
        setSystemPrompt(codePrompt);
        setPromptSource('code');
        setSavedPrompt(true);
        setTimeout(() => setSavedPrompt(false), 1200);
      }
    } finally {
      setSavingPrompt(false);
    }
  };

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
              <InnerCard className="mt-1"><p className="text-sm text-txt-secondary">{profile.personality_summary}</p></InnerCard>
            </div>
          )}

          {profile.communication_traits && profile.communication_traits.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Communication Traits</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {profile.communication_traits.map((t, i) => (
                  <span key={i} className="rounded-full border border-primary/20 bg-black/25 backdrop-blur-[8px] px-3 py-1 text-[12px] text-txt-secondary">{t}</span>
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
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
              <InnerCard className="mt-1.5"><pre className="whitespace-pre-wrap text-sm leading-relaxed text-txt-secondary">{profile.voice_sample}</pre></InnerCard>
            </div>
          )}
        </Card>
      )}

      {/* System Prompt */}
      <Card>
        <button
          onClick={() => setPromptExpanded(!promptExpanded)}
          className="flex w-full items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-txt-primary">System Prompt</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              promptSource === 'db'
                ? 'bg-cyan/10 text-cyan'
                : 'bg-prism-moderate/15 text-prism-moderate'
            }`}>
              {promptSource === 'db' ? 'Custom' : 'Defined in code'}
            </span>
          </div>
          <span className={`text-txt-faint transition-transform ${promptExpanded ? 'rotate-90' : ''}`}>▸</span>
        </button>
        {promptExpanded && (
          <div className="mt-4 space-y-3">
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={12}
              placeholder="Enter a system prompt for this agent..."
              className="w-full rounded-lg border border-border bg-raised px-4 py-3 font-mono text-[12px] leading-relaxed text-txt-secondary outline-none focus:border-cyan/40"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-txt-faint">{systemPrompt.length.toLocaleString()} characters</span>
              <div className="flex items-center gap-2">
                {promptSource === 'db' && (
                  <button
                    onClick={handleResetPrompt}
                    disabled={savingPrompt}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-txt-secondary transition-colors hover:border-cyan hover:text-cyan disabled:opacity-40"
                  >
                    Reset to Default
                  </button>
                )}
                <button
                  onClick={handleSavePrompt}
                  disabled={savingPrompt}
                  className="rounded-lg bg-cyan/10 border border-cyan/40 px-5 py-2 text-sm font-semibold text-cyan transition-all hover:bg-cyan/20 disabled:opacity-40"
                >
                  {savedPrompt ? 'Saved!' : savingPrompt ? 'Saving…' : 'Save Prompt'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Card>

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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40">
              {(['gemini', 'openai', 'anthropic'] as const).map(provider => (
                <optgroup key={provider} label={PROVIDER_LABELS[provider]}>
                  {getModelsByProvider()[provider].map(m => (
                    <option key={m.value} value={m.value}>{m.label}{m.default ? ' (default)' : ''}</option>
                  ))}
                </optgroup>
              ))}
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
              <span className={`inline-flex h-5 w-9 items-center rounded-full transition-colors ${thinkingEnabled ? 'bg-cyan' : 'bg-prism-moderate'}`}>
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

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                  className="h-full rounded-full bg-cyan transition-all"
                  style={{ width: `${Math.min(100, (Number(agent.total_cost_usd) / Number(agent.budget_monthly)) * 100)}%` }}
                />
              </div>
              <span className="text-sm font-mono text-txt-secondary">
                ${Number(agent.total_cost_usd).toFixed(2)} / ${Number(agent.budget_monthly).toFixed(2)} ({Math.round((Number(agent.total_cost_usd) / Number(agent.budget_monthly)) * 100)}%)
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
          <button onClick={handleSave} disabled={saving} className="rounded-lg bg-cyan/10 border border-cyan/40 px-6 py-2 text-sm font-semibold text-cyan transition-all hover:bg-cyan/20 disabled:opacity-40">
            {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </Card>

      {/* Reasoning Engine Config */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MdPsychology className="text-lg text-cyan" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-txt-primary">Reasoning Engine</h3>
          </div>
          <button
            type="button"
            onClick={() => setReasoningEnabled(!reasoningEnabled)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              reasoningEnabled
                ? 'border-cyan/40 bg-cyan/10 text-cyan'
                : 'border-border bg-raised text-txt-faint'
            }`}
          >
            <span>{reasoningEnabled ? 'Enabled' : 'Disabled'}</span>
            <span className={`inline-flex h-5 w-9 items-center rounded-full transition-colors ${reasoningEnabled ? 'bg-cyan' : 'bg-prism-moderate'}`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${reasoningEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
            </span>
          </button>
        </div>

        {reasoningLoading ? (
          <Skeleton className="h-32" />
        ) : (
          <div className={`space-y-4 ${!reasoningEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
            {/* Pass Types */}
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">Verification Passes</p>
              <div className="flex flex-wrap gap-2">
                {ALL_PASS_TYPES.map((pt) => (
                  <button
                    key={pt}
                    type="button"
                    onClick={() =>
                      setReasoningPassTypes((prev) =>
                        prev.includes(pt) ? prev.filter((p) => p !== pt) : [...prev, pt],
                      )
                    }
                    className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                      reasoningPassTypes.includes(pt)
                        ? 'border-cyan/40 bg-cyan/10 text-cyan'
                        : 'border-border bg-raised text-txt-faint hover:text-txt-secondary'
                    }`}
                  >
                    {pt.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>

            {/* Sliders & toggles */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <label className="space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">
                  Min Confidence ({Math.round(reasoningMinConfidence * 100)}%)
                </span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={reasoningMinConfidence}
                  onChange={(e) => setReasoningMinConfidence(parseFloat(e.target.value))}
                  className="w-full accent-cyan"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Max Budget ($)</span>
                <input
                  type="number"
                  step="0.005"
                  min="0"
                  value={reasoningMaxBudget}
                  onChange={(e) => setReasoningMaxBudget(parseFloat(e.target.value))}
                  className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Cross-Model</span>
                <button
                  type="button"
                  onClick={() => setReasoningCrossModel(!reasoningCrossModel)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    reasoningCrossModel
                      ? 'border-cyan/40 bg-cyan/10 text-cyan'
                      : 'border-border bg-raised text-txt-faint'
                  }`}
                >
                  <span>{reasoningCrossModel ? 'Enabled' : 'Disabled'}</span>
                  <span className={`inline-flex h-5 w-9 items-center rounded-full transition-colors ${reasoningCrossModel ? 'bg-cyan' : 'bg-prism-moderate'}`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${reasoningCrossModel ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                  </span>
                </button>
              </label>

              <label className="space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Value Gate</span>
                <button
                  type="button"
                  onClick={() => setReasoningValueGate(!reasoningValueGate)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    reasoningValueGate
                      ? 'border-cyan/40 bg-cyan/10 text-cyan'
                      : 'border-border bg-raised text-txt-faint'
                  }`}
                >
                  <span>{reasoningValueGate ? 'Enabled' : 'Disabled'}</span>
                  <span className={`inline-flex h-5 w-9 items-center rounded-full transition-colors ${reasoningValueGate ? 'bg-cyan' : 'bg-prism-moderate'}`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${reasoningValueGate ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                  </span>
                </button>
              </label>
            </div>

            {/* Verification Models */}
            {reasoningCrossModel && (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">Verification Models</p>
                <div className="flex flex-wrap gap-2">
                  {ALL_VERIFICATION_MODELS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() =>
                        setReasoningVerificationModels((prev) =>
                          prev.includes(m) ? prev.filter((v) => v !== m) : [...prev, m],
                        )
                      }
                      className={`rounded-full border px-3 py-1 text-[11px] font-medium font-mono transition-colors ${
                        reasoningVerificationModels.includes(m)
                          ? 'border-cyan/40 bg-cyan/10 text-cyan'
                          : 'border-border bg-raised text-txt-faint hover:text-txt-secondary'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleSaveReasoning}
                disabled={savingReasoning}
                className="rounded-lg bg-cyan/10 border border-cyan/40 px-6 py-2 text-sm font-semibold text-cyan transition-all hover:bg-cyan/20 disabled:opacity-40"
              >
                {savedReasoning ? 'Saved!' : savingReasoning ? 'Saving…' : 'Save Reasoning Config'}
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Voice Examples */}
      {profile?.voice_examples && profile.voice_examples.length > 0 && (
        <Card>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-txt-primary">Voice Calibration Examples</h3>
          <div className="space-y-4">
            {profile.voice_examples.map((ex, i) => (
              <details key={i} className="group glass-raised glass-inner-card rounded-xl border border-primary/20 bg-black/25 backdrop-blur-[8px] overflow-hidden">
                <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-txt-primary hover:text-cyan transition-colors">
                  <span>{ex.situation}</span>
                  <span className="text-txt-faint transition-transform group-open:rotate-90">▸</span>
                </summary>
                <pre className="whitespace-pre-wrap border-t border-primary/10 px-4 py-3 text-sm leading-relaxed text-txt-secondary">{ex.response}</pre>
              </details>
            ))}
          </div>
        </Card>
      )}

      {/* Danger Zone */}
      <Card>
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-tier-red">Danger Zone</h3>
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="rounded-lg border border-tier-red/30 bg-tier-red/10 px-4 py-2 text-sm font-medium text-tier-red hover:bg-tier-red/20 transition-colors"
            >
              Delete Agent
            </button>
          ) : (
            <div className="space-y-3 rounded-lg border border-tier-red/30 bg-tier-red/5 p-4">
              <p className="text-sm text-txt-secondary">
                This will <strong className="text-tier-red">permanently delete</strong> {agent.display_name || agent.role} from the database, org chart, and Entra ID. This cannot be undone.
              </p>
              <label className="block text-sm text-txt-faint">
                Type <strong className="text-txt-secondary">{agent.role}</strong> to confirm:
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={agent.role}
                className="w-full rounded-lg border border-tier-red/30 bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-tier-red/60"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      const resp = await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agent.id)}?hard=true`, { method: 'DELETE' });
                      if (resp.ok) {
                        navigate('/agents');
                      } else {
                        const body = await resp.text();
                        alert(`Delete failed (${resp.status}): ${body}`);
                      }
                    } catch (err: unknown) {
                      alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  disabled={deleteConfirmText !== agent.role || deleting}
                  className="rounded-lg bg-tier-red px-5 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40"
                >
                  {deleting ? 'Deleting…' : 'Permanently Delete'}
                </button>
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-txt-secondary hover:text-txt-primary transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Card>
    </div>
  );
}
