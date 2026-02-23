import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { DISPLAY_NAME_MAP } from '../lib/types';
import { Card, SectionHeader, Skeleton, timeAgo } from '../components/ui';

/* ── Types ─────────────────────────────────────── */

type Priority = 'critical' | 'high' | 'medium' | 'low';
type DirectiveStatus = 'active' | 'paused' | 'completed' | 'cancelled';
type Category = 'revenue' | 'product' | 'engineering' | 'marketing' | 'sales' | 'customer_success' | 'operations' | 'general';

interface WorkAssignment {
  id: string;
  assigned_to: string;
  task_description: string;
  task_type: string;
  expected_output: string | null;
  priority: string;
  status: string;
  quality_score: number | null;
  evaluation: string | null;
  agent_output: string | null;
  dispatched_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface Directive {
  id: string;
  created_by: string;
  title: string;
  description: string;
  priority: Priority;
  category: Category;
  target_agents: string[];
  department: string | null;
  status: DirectiveStatus;
  due_date: string | null;
  progress_notes: string[];
  completion_summary: string | null;
  created_at: string;
  updated_at: string;
  work_assignments: WorkAssignment[];
}

/* ── Constants ─────────────────────────────────── */

const PRIORITY_CONFIG: Record<Priority, { label: string; dot: string; border: string; bg: string; text: string }> = {
  critical: { label: 'CRITICAL', dot: 'bg-red-500', border: 'border-red-500/30', bg: 'bg-red-500/10', text: 'text-red-400' },
  high:     { label: 'HIGH',     dot: 'bg-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-400' },
  medium:   { label: 'MEDIUM',   dot: 'bg-blue-400', border: 'border-blue-500/30', bg: 'bg-blue-500/10', text: 'text-blue-400' },
  low:      { label: 'LOW',      dot: 'bg-slate-400', border: 'border-slate-500/30', bg: 'bg-slate-500/10', text: 'text-slate-400' },
};

const CATEGORY_LABELS: Record<Category, string> = {
  revenue: 'Revenue', product: 'Product', engineering: 'Engineering',
  marketing: 'Marketing', sales: 'Sales', customer_success: 'Customer Success',
  operations: 'Operations', general: 'General',
};

const TARGET_AGENTS = [
  { role: 'cto', label: 'Marcus (CTO)' },
  { role: 'cfo', label: 'Nadia (CFO)' },
  { role: 'cpo', label: 'Elena (CPO)' },
  { role: 'cmo', label: 'Maya (CMO)' },
  { role: 'vp-customer-success', label: 'James (VP CS)' },
  { role: 'vp-sales', label: 'Rachel (VP Sales)' },
  { role: 'vp-design', label: 'Mia (VP Design)' },
];

/* ── Helpers ───────────────────────────────────── */

function assignmentStatusColor(status: string) {
  if (status === 'completed') return 'bg-emerald-400';
  if (status === 'failed' || status === 'blocked') return 'bg-red-400';
  if (status === 'dispatched' || status === 'in_progress') return 'bg-amber-400 animate-pulse';
  return 'bg-slate-400';
}

function progressPercent(assignments: WorkAssignment[]): number {
  if (assignments.length === 0) return 0;
  return Math.round((assignments.filter(a => a.status === 'completed').length / assignments.length) * 100);
}

/* ── Page ──────────────────────────────────────── */

export default function Directives() {
  const [directives, setDirectives] = useState<Directive[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from('founder_directives')
      .select(`
        *,
        work_assignments (*)
      `)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false });

    setDirectives((data as Directive[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel('directives-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'founder_directives' }, () => refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_assignments' }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [refresh]);

  const active = directives.filter(d => d.status === 'active' || d.status === 'paused');
  const completed = directives.filter(d => d.status === 'completed' || d.status === 'cancelled');

  // Group actives by priority
  const grouped = (['critical', 'high', 'medium', 'low'] as Priority[])
    .map(p => ({ priority: p, items: active.filter(d => d.priority === p) }))
    .filter(g => g.items.length > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-txt-primary">Directives</h1>
          <p className="mt-1 text-sm text-txt-muted">
            Strategic priorities driving agent work across the company
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-cyan px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
        >
          + New Directive
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : active.length === 0 && completed.length === 0 ? (
        <Card>
          <p className="text-center text-sm text-txt-faint py-8">
            No directives yet. Create your first directive to start orchestrating agent work.
          </p>
        </Card>
      ) : (
        <>
          {/* Active Directives by Priority */}
          {grouped.map(({ priority, items }) => {
            const cfg = PRIORITY_CONFIG[priority];
            return (
              <div key={priority}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                  <span className={`text-xs font-semibold uppercase tracking-wider ${cfg.text}`}>
                    {cfg.label}
                  </span>
                  <span className="text-[11px] text-txt-faint">({items.length})</span>
                </div>
                <div className="space-y-3">
                  {items.map(d => (
                    <DirectiveCard
                      key={d.id}
                      directive={d}
                      isExpanded={expanded === d.id}
                      onToggle={() => setExpanded(expanded === d.id ? null : d.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Completed Section */}
          {completed.length > 0 && (
            <div>
              <button
                onClick={() => setShowCompleted(!showCompleted)}
                className="flex items-center gap-2 text-xs font-semibold text-txt-secondary hover:text-txt-primary transition-colors"
              >
                <span className={`text-[10px] transition-transform duration-200 ${showCompleted ? 'rotate-90' : ''}`}>
                  ▶
                </span>
                COMPLETED ({completed.length})
              </button>
              {showCompleted && (
                <div className="mt-3 space-y-3">
                  {completed.map(d => (
                    <DirectiveCard
                      key={d.id}
                      directive={d}
                      isExpanded={expanded === d.id}
                      onToggle={() => setExpanded(expanded === d.id ? null : d.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* New Directive Modal */}
      {showForm && (
        <NewDirectiveModal
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); refresh(); }}
        />
      )}
    </div>
  );
}

/* ── Directive Card ────────────────────────────── */

function DirectiveCard({
  directive: d,
  isExpanded,
  onToggle,
}: {
  directive: Directive;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const assignments = d.work_assignments ?? [];
  const pct = progressPercent(assignments);
  const completed = assignments.filter(a => a.status === 'completed').length;
  const total = assignments.length;
  const agentNames = [...new Set(assignments.map(a => DISPLAY_NAME_MAP[a.assigned_to] ?? a.assigned_to))];
  const lastNote = d.progress_notes?.length ? d.progress_notes[d.progress_notes.length - 1] : null;
  const cfg = PRIORITY_CONFIG[d.priority];

  return (
    <Card>
      <button onClick={onToggle} className="flex w-full items-start justify-between text-left gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-semibold text-txt-primary truncate">{d.title}</p>
            {d.status === 'paused' && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                paused
              </span>
            )}
            {d.status === 'completed' && (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                completed
              </span>
            )}
          </div>

          {/* Assignment summary */}
          <p className="text-[12px] text-txt-muted">
            {total === 0
              ? 'No assignments yet — awaiting Sarah\'s orchestration'
              : `${completed}/${total} assignments complete`}
            {agentNames.length > 0 && (
              <span className="ml-2 text-txt-faint">· {agentNames.join(', ')}</span>
            )}
          </p>

          {/* Progress bar */}
          {total > 0 && (
            <div className="mt-2 flex items-center gap-3">
              <div className="h-1.5 flex-1 rounded-full bg-base overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    pct === 100 ? 'bg-emerald-400' : pct > 0 ? 'bg-cyan' : 'bg-transparent'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[11px] font-mono text-txt-faint w-8 text-right">{pct}%</span>
            </div>
          )}

          {/* Latest progress note */}
          {lastNote && (
            <p className="mt-2 text-[11px] text-txt-muted leading-relaxed truncate">
              {lastNote}
            </p>
          )}
        </div>

        <span className="text-[11px] text-txt-faint whitespace-nowrap">{timeAgo(d.created_at)}</span>
      </button>

      {/* Expanded Detail */}
      {isExpanded && (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          {/* Description */}
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-1">Description</p>
            <p className="text-sm text-txt-secondary leading-relaxed">{d.description}</p>
          </div>

          {/* Metadata */}
          <div className="flex flex-wrap gap-3 text-[11px] text-txt-faint">
            <span>Created by <span className="text-txt-secondary font-medium">{d.created_by}</span></span>
            <span>Category: <span className="text-txt-secondary font-medium">{CATEGORY_LABELS[d.category]}</span></span>
            {d.due_date && <span>Due: <span className="text-txt-secondary font-medium">{new Date(d.due_date).toLocaleDateString()}</span></span>}
            {d.target_agents?.length > 0 && (
              <span>
                Target: <span className="text-txt-secondary font-medium">
                  {d.target_agents.map(r => DISPLAY_NAME_MAP[r] ?? r).join(', ')}
                </span>
              </span>
            )}
          </div>

          {/* Work Assignments */}
          {assignments.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">
                Work Assignments
              </p>
              <div className="space-y-2">
                {assignments.map(a => (
                  <div key={a.id} className="rounded-lg border border-border bg-raised px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${assignmentStatusColor(a.status)}`} />
                      <span className="text-[12px] font-medium text-txt-primary">
                        {DISPLAY_NAME_MAP[a.assigned_to] ?? a.assigned_to}
                      </span>
                      <span className="text-[10px] text-txt-faint">({a.status})</span>
                      {a.quality_score != null && (
                        <span className={`ml-auto text-[10px] font-mono font-semibold ${
                          a.quality_score >= 70 ? 'text-emerald-400' : a.quality_score >= 40 ? 'text-amber-400' : 'text-red-400'
                        }`}>
                          {a.quality_score}/100
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-txt-muted leading-relaxed">{a.task_description}</p>
                    {a.agent_output && (
                      <details className="mt-2">
                        <summary className="text-[10px] font-medium text-cyan cursor-pointer">View Output</summary>
                        <p className="mt-1 text-[11px] text-txt-muted leading-relaxed whitespace-pre-wrap border-t border-border pt-2">
                          {a.agent_output}
                        </p>
                      </details>
                    )}
                    {a.evaluation && (
                      <p className="mt-1 text-[10px] text-txt-faint italic">Evaluation: {a.evaluation}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Progress Notes */}
          {d.progress_notes?.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">
                Progress Notes
              </p>
              <div className="space-y-1">
                {d.progress_notes.map((note, i) => (
                  <p key={i} className="text-[11px] text-txt-muted leading-relaxed">
                    {note}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Completion Summary */}
          {d.completion_summary && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
              <p className="text-[11px] font-medium text-emerald-400 mb-1">Completion Summary</p>
              <p className="text-[12px] text-txt-secondary leading-relaxed">{d.completion_summary}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── New Directive Modal ───────────────────────── */

function NewDirectiveModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('high');
  const [category, setCategory] = useState<Category>('general');
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  function toggleAgent(role: string) {
    setSelectedAgents(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  }

  async function handleCreate() {
    if (!title.trim() || !description.trim()) return;
    setSaving(true);

    const { error } = await (supabase.from('founder_directives') as any).insert({
      title: title.trim(),
      description: description.trim(),
      priority,
      category,
      target_agents: selectedAgents,
      due_date: dueDate || null,
      created_by: 'kristina',
    });

    if (error) {
      console.error('Failed to create directive:', error);
      setSaving(false);
      return;
    }

    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-white dark:bg-[#111827] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-txt-primary">New Directive</h2>
          <button onClick={onClose} className="text-txt-muted hover:text-txt-primary transition-colors text-lg">
            ×
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          {/* Title */}
          <div>
            <label className="text-[11px] font-medium text-txt-muted mb-1 block">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Launch Fuse marketing push"
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary placeholder:text-txt-faint focus:border-cyan focus:outline-none"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-[11px] font-medium text-txt-muted mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              placeholder="Full context. What do you want accomplished and why."
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary placeholder:text-txt-faint focus:border-cyan focus:outline-none resize-none"
            />
          </div>

          {/* Priority + Category row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-medium text-txt-muted mb-2 block">Priority</label>
              <div className="flex flex-wrap gap-2">
                {(['critical', 'high', 'medium', 'low'] as Priority[]).map(p => {
                  const cfg = PRIORITY_CONFIG[p];
                  return (
                    <button
                      key={p}
                      onClick={() => setPriority(p)}
                      className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        priority === p
                          ? `${cfg.border} ${cfg.bg} ${cfg.text}`
                          : 'border-border text-txt-muted hover:text-txt-secondary'
                      }`}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-medium text-txt-muted mb-1 block">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as Category)}
                className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none"
              >
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Target Agents */}
          <div>
            <label className="text-[11px] font-medium text-txt-muted mb-2 block">
              Target Agents <span className="text-txt-faint">(optional — leave empty for Sarah to decide)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {TARGET_AGENTS.map(({ role, label }) => (
                <button
                  key={role}
                  onClick={() => toggleAgent(role)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    selectedAgents.includes(role)
                      ? 'border-cyan/40 bg-cyan/15 text-cyan'
                      : 'border-border text-txt-muted hover:text-txt-secondary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Due Date */}
          <div>
            <label className="text-[11px] font-medium text-txt-muted mb-1 block">
              Due Date <span className="text-txt-faint">(optional)</span>
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-txt-muted transition-colors hover:text-txt-primary"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !title.trim() || !description.trim()}
            className="rounded-lg bg-cyan px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Creating…' : 'Create Directive'}
          </button>
        </div>
      </div>
    </div>
  );
}
