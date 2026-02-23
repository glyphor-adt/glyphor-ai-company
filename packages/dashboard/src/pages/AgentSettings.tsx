import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase, SCHEDULER_URL } from '../lib/supabase';
import {
  DISPLAY_NAME_MAP,
  AGENT_META,
  AGENT_SOUL,
  AGENT_SKILLS,
  ROLE_TIER,
  ROLE_DEPARTMENT,
  ROLE_TITLE,
  SUB_TEAM,
} from '../lib/types';
import { Card, AgentAvatar, Skeleton, timeAgo } from '../components/ui';

interface AgentRow {
  id: string;
  role: string;
  display_name: string;
  codename?: string;
  name?: string | null;
  title?: string | null;
  department?: string | null;
  reports_to?: string | null;
  status: string;
  model: string | null;
  temperature?: number | null;
  max_turns?: number | null;
  budget_per_run?: number | null;
  budget_daily?: number | null;
  budget_monthly?: number | null;
  is_core?: boolean | null;
  is_temporary?: boolean | null;
  total_runs: number;
  total_cost_usd: number;
  performance_score?: number | null;
  tier?: string;
  last_run_at?: string | null;
  created_at: string;
}

export default function AgentSettings() {
  const { agentId } = useParams(); // can be UUID or role slug
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);

  // Settings form state
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.3);
  const [maxTurns, setMaxTurns] = useState(10);
  const [budgetPerRun, setBudgetPerRun] = useState(0.05);
  const [budgetDaily, setBudgetDaily] = useState(0.5);
  const [budgetMonthly, setBudgetMonthly] = useState(15);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    (async () => {
      setLoading(true);
      // Try matching by role first (human-readable slug), then by UUID id
      let { data } = await supabase.from('company_agents').select('*').eq('role', agentId).single();
      if (!data) {
        ({ data } = await supabase.from('company_agents').select('*').eq('id', agentId).single());
      }
      if (data) {
        const a = data as unknown as AgentRow;
        setAgent(a);
        setModel(a.model ?? 'gemini-3-flash-preview');
        setTemperature(a.temperature ?? 0.3);
        setMaxTurns(a.max_turns ?? 10);
        setBudgetPerRun(a.budget_per_run ?? 0.05);
        setBudgetDaily(a.budget_daily ?? 0.5);
        setBudgetMonthly(a.budget_monthly ?? 15);
      }
      setLoading(false);
    })();
  }, [agentId]);

  const handleSave = async () => {
    if (!agent) return;
    setSaving(true);
    try {
      await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agent.id)}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature, max_turns: maxTurns, budget_per_run: budgetPerRun, budget_daily: budgetDaily, budget_monthly: budgetMonthly }),
      });
      setAgent((prev) => prev ? { ...prev, model, temperature, max_turns: maxTurns, budget_per_run: budgetPerRun, budget_daily: budgetDaily, budget_monthly: budgetMonthly } : prev);
      setSaved(true);
      setTimeout(() => { setSaved(false); setEditMode(false); }, 1200);
    } finally {
      setSaving(false);
    }
  };

  const handlePause = async () => {
    if (!agent) return;
    await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agent.id)}/pause`, { method: 'POST' });
    setAgent((prev) => prev ? { ...prev, status: 'paused' } : prev);
  };

  const handleResume = async () => {
    if (!agent) return;
    await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agent.id)}/resume`, { method: 'POST' });
    setAgent((prev) => prev ? { ...prev, status: 'active' } : prev);
  };

  const handleRetire = async () => {
    if (!agent || agent.is_core) return;
    await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agent.id)}`, { method: 'DELETE' });
    navigate('/agents');
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
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
  const meta = AGENT_META[agent.role];
  const soul = AGENT_SOUL[agent.role];
  const skills = AGENT_SKILLS[agent.role] ?? [];
  const department = ROLE_DEPARTMENT[agent.role] ?? agent.department ?? '';
  const tier = ROLE_TIER[agent.role] ?? 'Agent';
  const directReports = SUB_TEAM.filter((m) => m.reportsTo === agent.role);
  const reportsToName = agent.reports_to
    ? DISPLAY_NAME_MAP[agent.reports_to] ?? agent.reports_to
    : agent.role === 'chief-of-staff' ? 'Kristina & Andrew (Founders)' : undefined;

  return (
    <div className="space-y-6">
      {/* ── Breadcrumb ── */}
      <Link to="/agents" className="inline-flex items-center gap-1 text-sm text-txt-muted transition-colors hover:text-cyan">
        <span>‹</span> All Agents
      </Link>

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <AgentAvatar role={agent.role} size={64} glow={agent.status === 'active'} />
          <div>
            <h1 className="text-2xl font-bold text-txt-primary">{displayName}</h1>
            <p className="text-sm text-txt-muted">{titleText}</p>
            <div className="mt-1.5 flex items-center gap-2">
              {/* Status badge */}
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                agent.status === 'active'
                  ? 'bg-tier-green/15 text-tier-green'
                  : agent.status === 'paused'
                  ? 'bg-tier-yellow/15 text-tier-yellow'
                  : 'bg-slate-500/15 text-slate-400'
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${
                  agent.status === 'active' ? 'bg-tier-green' : agent.status === 'paused' ? 'bg-tier-yellow' : 'bg-slate-500'
                }`} />
                {agent.status}
              </span>
              {/* Model badge */}
              <span className="text-[11px] text-txt-faint">·</span>
              <span className="font-mono text-[11px] text-txt-muted">{agent.model ?? 'gemini-3-flash-preview'}</span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <Link
            to={`/chat/${agent.role}`}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-txt-secondary transition-colors hover:border-cyan hover:text-cyan"
          >
            Chat
          </Link>
          <button
            onClick={() => setEditMode(!editMode)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              editMode
                ? 'border border-cyan/40 bg-cyan/10 text-cyan'
                : 'border border-border text-txt-secondary hover:border-cyan hover:text-cyan'
            }`}
          >
            {editMode ? 'Close Settings' : 'Edit Settings'}
          </button>
        </div>
      </div>

      {/* ── Settings Panel (toggled) ── */}
      {editMode && (
        <Card className="border-cyan/20">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-txt-primary">Agent Settings</h2>
            <div className="flex items-center gap-2">
              {agent.status === 'active' ? (
                <button onClick={handlePause} className="rounded-lg border border-tier-yellow/30 bg-tier-yellow/10 px-3 py-1.5 text-xs font-medium text-tier-yellow hover:bg-tier-yellow/20 transition-colors">
                  Pause
                </button>
              ) : agent.status === 'paused' ? (
                <button onClick={handleResume} className="rounded-lg border border-tier-green/30 bg-tier-green/10 px-3 py-1.5 text-xs font-medium text-tier-green hover:bg-tier-green/20 transition-colors">
                  Resume
                </button>
              ) : null}
              {!agent.is_core && (
                <button onClick={handleRetire} className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors">
                  Retire
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <label className="space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Model</span>
              <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40">
                <optgroup label="Google Gemini">
                  <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview</option>
                  <option value="gemini-3-flash-preview">gemini-3-flash-preview (default)</option>
                  <option value="gemini-3-pro-preview">gemini-3-pro-preview</option>
                  <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                  <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                </optgroup>
                <optgroup label="OpenAI">
                  <option value="gpt-5.2">gpt-5.2</option>
                  <option value="gpt-5.2-pro">gpt-5.2-pro</option>
                  <option value="gpt-5">gpt-5</option>
                  <option value="gpt-5-mini">gpt-5-mini</option>
                  <option value="gpt-5-nano">gpt-5-nano</option>
                  <option value="gpt-4.1">gpt-4.1</option>
                </optgroup>
                <optgroup label="Anthropic">
                  <option value="claude-opus-4-6">claude-opus-4-6</option>
                  <option value="claude-sonnet-4-6">claude-sonnet-4-6</option>
                  <option value="claude-haiku-4-5">claude-haiku-4-5</option>
                </optgroup>
              </select>
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

          <div className="mt-4 flex justify-end">
            <button onClick={handleSave} disabled={saving} className="rounded-lg bg-gradient-to-r from-cyan to-azure px-6 py-2 text-sm font-semibold text-white dark:text-gray-900 transition-all hover:shadow-[0_0_20px_rgba(34,211,238,0.4)] disabled:opacity-40">
              {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </Card>
      )}

      {/* ── Soul + Configuration (two-column) ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* SOUL */}
        {soul && (
          <Card>
            <div className="mb-4 flex items-center gap-2">
              <SoulIcon />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-txt-primary">Soul</h2>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Mission</p>
                <p className="mt-1 text-sm leading-relaxed text-txt-secondary">{soul.mission}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Persona</p>
                <p className="mt-1 text-sm leading-relaxed text-txt-secondary">{soul.persona}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Tone</p>
                <p className="mt-1 text-sm text-txt-secondary">{soul.tone}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Ethics</p>
                <p className="mt-1 text-sm leading-relaxed text-txt-secondary">{soul.ethics}</p>
              </div>
            </div>
          </Card>
        )}

        {/* CONFIGURATION */}
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <ConfigIcon />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-txt-primary">Configuration</h2>
          </div>

          <div className="space-y-3">
            <ConfigRow label="Agent ID" value={agent.role} mono />
            <ConfigRow label="Type" value={titleText} />
            <ConfigRow label="Tier" value={tier} />
            <ConfigRow label="Office" value={department} />
            <ConfigRow label="Model" value={agent.model ?? 'gemini-3-flash-preview'} mono />
            <ConfigRow label="Score" value={agent.performance_score != null ? `${Math.round(Number(agent.performance_score) * 100)}/100` : '—'} />
            <ConfigRow label="Total Runs" value={String(agent.total_runs ?? 0)} />
            <ConfigRow label="Total Cost" value={`$${(agent.total_cost_usd ?? 0).toFixed(2)}`} mono />
            <ConfigRow label="Last Run" value={timeAgo(agent.last_run_at ?? null)} />
            <ConfigRow label="Created" value={new Date(agent.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' })} />
          </div>
        </Card>
      </div>

      {/* ── Skills + Org Structure (two-column) ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* SKILLS */}
        {skills.length > 0 && (
          <Card>
            <div className="mb-4 flex items-center gap-2">
              <SkillsIcon />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-txt-primary">Skills</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {skills.map((s) => (
                <span
                  key={s}
                  className="rounded-lg border border-border bg-raised px-3 py-1.5 font-mono text-[12px] text-txt-secondary"
                >
                  {s}
                </span>
              ))}
            </div>
          </Card>
        )}

        {/* ORG STRUCTURE */}
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <OrgIcon />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-txt-primary">Org Structure</h2>
          </div>

          {reportsToName && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Reports To</p>
              <p className="mt-1 text-sm text-txt-secondary">{reportsToName}</p>
            </div>
          )}

          {directReports.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">
                Direct Reports ({directReports.length})
              </p>
              <ul className="mt-2 space-y-2">
                {directReports.map((m) => (
                  <li key={m.name} className="flex items-center gap-3">
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
                  </li>
                ))}
              </ul>
            </div>
          )}

          {directReports.length === 0 && !reportsToName && (
            <p className="text-sm text-txt-faint">No org structure data available.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ── Config row helper ── */
function ConfigRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border/50 pb-2 last:border-0 last:pb-0">
      <span className="text-[12px] text-txt-muted">{label}</span>
      <span className={`text-[13px] text-txt-primary ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

/* ── Section Icons ── */
function SoulIcon() {
  return (
    <svg className="h-4 w-4 text-txt-muted" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 2" />
    </svg>
  );
}

function ConfigIcon() {
  return (
    <svg className="h-4 w-4 text-txt-muted" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" />
    </svg>
  );
}

function SkillsIcon() {
  return (
    <svg className="h-4 w-4 text-txt-muted" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M5 8l2 2 4-4" />
    </svg>
  );
}

function OrgIcon() {
  return (
    <svg className="h-4 w-4 text-txt-muted" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="3.5" r="2" />
      <circle cx="4" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <path d="M8 5.5v3M5.5 10.5L8 8.5M10.5 10.5L8 8.5" />
    </svg>
  );
}
