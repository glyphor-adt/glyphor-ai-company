import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase, SCHEDULER_URL } from '../lib/supabase';
import { DISPLAY_NAME_MAP, AGENT_META } from '../lib/types';
import { Card, SectionHeader, AgentAvatar, Skeleton } from '../components/ui';

interface AgentDetail {
  id: string;
  role: string;
  codename: string;
  name: string | null;
  title: string | null;
  department: string | null;
  reports_to: string | null;
  status: string;
  model: string | null;
  temperature: number | null;
  max_turns: number | null;
  budget_per_run: number | null;
  budget_daily: number | null;
  budget_monthly: number | null;
  is_core: boolean | null;
  is_temporary: boolean | null;
  total_runs: number;
  total_cost_usd: number;
  performance_score: number | null;
  created_at: string;
}

interface AgentBrief {
  system_prompt: string;
  skills: string[];
  tools: string[];
}

export default function AgentSettings() {
  const { agentId } = useParams();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [brief, setBrief] = useState<AgentBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Form state
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.3);
  const [maxTurns, setMaxTurns] = useState(10);
  const [budgetPerRun, setBudgetPerRun] = useState(0.05);
  const [budgetDaily, setBudgetDaily] = useState(0.5);
  const [budgetMonthly, setBudgetMonthly] = useState(15);
  const [systemPrompt, setSystemPrompt] = useState('');

  useEffect(() => {
    if (!agentId) return;
    (async () => {
      setLoading(true);
      const [{ data: agentData }, { data: briefData }] = await Promise.all([
        supabase.from('company_agents').select('*').eq('id', agentId).single(),
        supabase.from('agent_briefs').select('*').eq('agent_id', agentId).single(),
      ]);
      if (agentData) {
        const a = agentData as unknown as AgentDetail;
        setAgent(a);
        setModel(a.model ?? 'gemini-3-flash-preview');
        setTemperature(a.temperature ?? 0.3);
        setMaxTurns(a.max_turns ?? 10);
        setBudgetPerRun(a.budget_per_run ?? 0.05);
        setBudgetDaily(a.budget_daily ?? 0.5);
        setBudgetMonthly(a.budget_monthly ?? 15);
      }
      if (briefData) {
        const b = briefData as unknown as AgentBrief;
        setBrief(b);
        setSystemPrompt(b.system_prompt ?? '');
      }
      setLoading(false);
    })();
  }, [agentId]);

  const handleSave = async () => {
    if (!agentId) return;
    setSaving(true);
    try {
      await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agentId)}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature,
          max_turns: maxTurns,
          budget_per_run: budgetPerRun,
          budget_daily: budgetDaily,
          budget_monthly: budgetMonthly,
          system_prompt: systemPrompt || undefined,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handlePause = async () => {
    if (!agentId) return;
    await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agentId)}/pause`, { method: 'POST' });
    setAgent((prev) => prev ? { ...prev, status: 'paused' } : prev);
  };

  const handleResume = async () => {
    if (!agentId) return;
    await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agentId)}/resume`, { method: 'POST' });
    setAgent((prev) => prev ? { ...prev, status: 'active' } : prev);
  };

  const handleRetire = async () => {
    if (!agentId || agent?.is_core) return;
    await fetch(`${SCHEDULER_URL}/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
    navigate('/workforce');
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-txt-faint">Agent not found</p>
      </div>
    );
  }

  const displayName = agent.name ?? DISPLAY_NAME_MAP[agent.role] ?? agent.codename;
  const meta = AGENT_META[agent.role];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <AgentAvatar role={agent.role} size={48} glow={agent.status === 'active'} />
          <div>
            <h1 className="text-2xl font-bold text-txt-primary">{displayName}</h1>
            <p className="text-sm text-txt-muted">
              {agent.title ?? agent.role} · {agent.department ?? ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${
              agent.status === 'active'
                ? 'border-tier-green/30 bg-tier-green/15 text-tier-green'
                : agent.status === 'paused'
                ? 'border-tier-yellow/30 bg-tier-yellow/15 text-tier-yellow'
                : 'border-slate-500/30 bg-slate-500/15 text-slate-400'
            }`}
          >
            {agent.status}
          </span>
          {agent.is_core && (
            <span className="inline-flex items-center rounded-full border border-cyan/30 bg-cyan/10 px-2 py-0.5 text-[10px] font-medium text-cyan">
              Core
            </span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Total Runs</p>
          <p className="mt-1 font-mono text-xl font-semibold text-txt-primary">{agent.total_runs}</p>
        </Card>
        <Card>
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Total Cost</p>
          <p className="mt-1 font-mono text-xl font-semibold text-txt-primary">${(agent.total_cost_usd ?? 0).toFixed(2)}</p>
        </Card>
        <Card>
          <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Score</p>
          <p className="mt-1 font-mono text-xl font-semibold text-txt-primary">
            {agent.performance_score != null ? `${Math.round(agent.performance_score * 100)}/100` : '—'}
          </p>
        </Card>
      </div>

      {/* Model Configuration */}
      <Card>
        <SectionHeader title="Model Configuration" />
        <div className="grid grid-cols-3 gap-4">
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Model</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40"
            >
              <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
              <option value="gemini-2.5-flash-preview-05-20">gemini-2.5-flash-preview</option>
              <option value="gemini-2.5-pro-preview-05-06">gemini-2.5-pro-preview</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Temperature</span>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Max Turns</span>
            <input
              type="number"
              min="1"
              max="50"
              value={maxTurns}
              onChange={(e) => setMaxTurns(parseInt(e.target.value, 10))}
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40"
            />
          </label>
        </div>
      </Card>

      {/* Budget Configuration */}
      <Card>
        <SectionHeader title="Budget Limits" />
        <div className="grid grid-cols-3 gap-4">
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Per Run ($)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={budgetPerRun}
              onChange={(e) => setBudgetPerRun(parseFloat(e.target.value))}
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Daily ($)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={budgetDaily}
              onChange={(e) => setBudgetDaily(parseFloat(e.target.value))}
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Monthly ($)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={budgetMonthly}
              onChange={(e) => setBudgetMonthly(parseFloat(e.target.value))}
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40"
            />
          </label>
        </div>
      </Card>

      {/* System Prompt (dynamic agents only) */}
      {!agent.is_core && (
        <Card>
          <SectionHeader title="System Prompt" />
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={8}
            placeholder="Custom system prompt for this agent..."
            className="w-full rounded-lg border border-border bg-raised px-4 py-3 text-sm text-txt-secondary placeholder-txt-faint outline-none focus:border-cyan/40 font-mono"
          />
        </Card>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {agent.status === 'active' ? (
            <button
              onClick={handlePause}
              className="rounded-lg border border-tier-yellow/30 bg-tier-yellow/10 px-4 py-2 text-sm font-medium text-tier-yellow hover:bg-tier-yellow/20 transition-colors"
            >
              Pause Agent
            </button>
          ) : agent.status === 'paused' ? (
            <button
              onClick={handleResume}
              className="rounded-lg border border-tier-green/30 bg-tier-green/10 px-4 py-2 text-sm font-medium text-tier-green hover:bg-tier-green/20 transition-colors"
            >
              Resume Agent
            </button>
          ) : null}
          {!agent.is_core && (
            <button
              onClick={handleRetire}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Retire Agent
            </button>
          )}
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-gradient-to-r from-cyan to-azure px-6 py-2 text-sm font-semibold text-[#0B0B0C] transition-all hover:shadow-[0_0_20px_rgba(0,224,255,0.4)] disabled:opacity-40"
        >
          {saved ? 'Saved!' : saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}
