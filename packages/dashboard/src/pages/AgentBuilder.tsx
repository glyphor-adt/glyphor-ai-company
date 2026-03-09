import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SCHEDULER_URL } from '../lib/firebase';
import { Card, SectionHeader } from '../components/ui';
import { MODELS, DEFAULT_MODEL } from '../lib/models';

const DEPARTMENTS = [
  'Engineering', 'Product', 'Finance', 'Marketing',
  'Sales', 'Design & Frontend', 'Operations',
];

export default function AgentBuilder() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Form fields
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [reportsTo, setReportsTo] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [temperature, setTemperature] = useState(0.3);
  const [maxTurns, setMaxTurns] = useState(10);
  const [budgetPerRun, setBudgetPerRun] = useState(0.05);
  const [budgetDaily, setBudgetDaily] = useState(0.5);
  const [budgetMonthly, setBudgetMonthly] = useState(15);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [cronExpression, setCronExpression] = useState('');
  const [isTemporary, setIsTemporary] = useState(false);
  const [ttlDays, setTtlDays] = useState(7);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setError('');
    setCreating(true);

    try {
      const res = await fetch(`${SCHEDULER_URL}/agents/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          title: title.trim() || undefined,
          department: department || undefined,
          reports_to: reportsTo || undefined,
          model,
          temperature,
          max_turns: maxTurns,
          budget_per_run: budgetPerRun,
          budget_daily: budgetDaily,
          budget_monthly: budgetMonthly,
          system_prompt: systemPrompt.trim() || undefined,
          cron_expression: cronExpression.trim() || undefined,
          is_temporary: isTemporary,
          ttl_days: isTemporary ? ttlDays : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Failed to create agent');
        return;
      }

      navigate(`/agents/${data.agent.id}/settings`);
    } catch {
      setError('Could not reach scheduler. Is it running?');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-txt-primary">Create New Agent</h1>
        <p className="mt-1 text-sm text-txt-muted">
          Define a new AI agent with custom capabilities and budget
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-prism-critical/30 bg-prism-critical/10 px-4 py-3 text-sm text-prism-critical">
          {error}
        </div>
      )}

      {/* Identity */}
      <Card>
        <SectionHeader title="Identity" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Name *</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Data Pipeline Monitor"
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary placeholder-txt-faint outline-none focus:border-cyan/40"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Data Engineer"
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary placeholder-txt-faint outline-none focus:border-cyan/40"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Department</span>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40"
            >
              <option value="">Select department...</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Reports To</span>
            <input
              type="text"
              value={reportsTo}
              onChange={(e) => setReportsTo(e.target.value)}
              placeholder="e.g. cto"
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary placeholder-txt-faint outline-none focus:border-cyan/40"
            />
          </label>
        </div>
      </Card>

      {/* Model Configuration */}
      <Card>
        <SectionHeader title="Model Configuration" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Model</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary outline-none focus:border-cyan/40"
            >
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
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

      {/* Budget */}
      <Card>
        <SectionHeader title="Budget Limits" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

      {/* System Prompt */}
      <Card>
        <SectionHeader title="System Prompt" />
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={8}
          placeholder="Define this agent's personality, responsibilities, and instructions..."
          className="w-full rounded-lg border border-border bg-raised px-4 py-3 text-sm text-txt-secondary placeholder-txt-faint outline-none focus:border-cyan/40 font-mono"
        />
      </Card>

      {/* Schedule */}
      <Card>
        <SectionHeader title="Schedule (Optional)" />
        <label className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Cron Expression (UTC)</span>
          <input
            type="text"
            value={cronExpression}
            onChange={(e) => setCronExpression(e.target.value)}
            placeholder="e.g. 0 12 * * *  (daily at noon UTC)"
            className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-secondary placeholder-txt-faint outline-none focus:border-cyan/40 font-mono"
          />
        </label>
        <p className="mt-2 text-[11px] text-txt-faint">
          Standard 5-field cron: minute hour day-of-month month day-of-week
        </p>
      </Card>

      {/* Temporary Agent */}
      <Card>
        <SectionHeader title="Lifecycle" />
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isTemporary}
              onChange={(e) => setIsTemporary(e.target.checked)}
              className="rounded border-border bg-raised accent-cyan"
            />
            <span className="text-sm text-txt-secondary">Temporary agent (auto-expires)</span>
          </label>
          {isTemporary && (
            <label className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">TTL (days)</span>
              <input
                type="number"
                min="1"
                max="90"
                value={ttlDays}
                onChange={(e) => setTtlDays(parseInt(e.target.value, 10))}
                className="w-20 rounded-lg border border-border bg-raised px-2 py-1 text-sm text-txt-secondary outline-none focus:border-cyan/40"
              />
            </label>
          )}
        </div>
      </Card>

      {/* Submit */}
      <div className="flex justify-end gap-3 pb-8">
        <button
          onClick={() => navigate('/workforce')}
          className="rounded-lg border border-border px-5 py-2 text-sm font-medium text-txt-muted hover:border-border-hover hover:text-txt-secondary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          disabled={creating || !name.trim()}
          className="rounded-lg bg-cyan px-6 py-2 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40"
        >
          {creating ? 'Creating...' : 'Create Agent'}
        </button>
      </div>
    </div>
  );
}
