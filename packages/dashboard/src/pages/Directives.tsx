import { useEffect, useState, useCallback } from 'react';
import Markdown from 'react-markdown';
import { apiCall } from '../lib/firebase';
import { DISPLAY_NAME_MAP } from '../lib/types';
import { useAuth } from '../lib/auth';
import { Card, SectionHeader, Skeleton, timeAgo } from '../components/ui';
import { MdCheckCircle, MdEdit, MdCancel, MdChevronRight, MdDelete, MdBlock } from 'react-icons/md';

/* ── Types ─────────────────────────────────────── */

type Priority = 'critical' | 'high' | 'medium' | 'low';
type DirectiveStatus = 'proposed' | 'active' | 'paused' | 'completed' | 'cancelled' | 'rejected';
type Category = 'revenue' | 'product' | 'engineering' | 'marketing' | 'sales' | 'customer_success' | 'operations' | 'general' | 'strategy' | 'design';

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
  need_type: string | null;
  blocker_reason: string | null;
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
  proposed_by: string | null;
  proposal_reason: string | null;
  source_directive_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  work_assignments: WorkAssignment[];
  source_directive?: { title: string } | null;
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
  operations: 'Operations', general: 'General', strategy: 'Strategy', design: 'Design',
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
  const [showRejected, setShowRejected] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    const data = await apiCall('/api/founder-directives?include=work_assignments,source_directive');

    setDirectives((data as Directive[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Real-time subscription removed (was PostgREST realtime)
  useEffect(() => {}, [refresh]);

  const proposed = directives.filter(d => d.status === 'proposed');
  const active = directives.filter(d => d.status === 'active' || d.status === 'paused');
  const completed = directives.filter(d => d.status === 'completed' || d.status === 'cancelled');
  const rejected = directives.filter(d => d.status === 'rejected');

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
      ) : active.length === 0 && completed.length === 0 && proposed.length === 0 ? (
        <Card>
          <p className="text-center text-sm text-txt-faint py-8">
            No directives yet. Create your first directive to start orchestrating agent work.
          </p>
        </Card>
      ) : (
        <>
          {/* Proposed Directives — needs founder attention */}
          {proposed.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="h-2 w-2 rounded-full bg-violet-500 animate-pulse" />
                <span className="text-xs font-semibold uppercase tracking-wider text-violet-400">
                  PROPOSED
                </span>
                <span className="text-[11px] text-txt-faint">({proposed.length})</span>
                <span className="ml-2 text-[10px] text-violet-400/70">Needs your approval</span>
              </div>
              <div className="space-y-3">
                {proposed.map(d => (
                  <ProposedDirectiveCard
                    key={d.id}
                    directive={d}
                    onAction={refresh}
                  />
                ))}
              </div>
            </div>
          )}

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
                      onAction={refresh}
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
                  <MdChevronRight />
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
                      onAction={refresh}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Rejected Section */}
          {rejected.length > 0 && (
            <div>
              <button
                onClick={() => setShowRejected(!showRejected)}
                className="flex items-center gap-2 text-xs font-semibold text-txt-secondary hover:text-txt-primary transition-colors"
              >
                <span className={`text-[10px] transition-transform duration-200 ${showRejected ? 'rotate-90' : ''}`}>
                  <MdChevronRight />
                </span>
                REJECTED ({rejected.length})
              </button>
              {showRejected && (
                <div className="mt-3 space-y-3">
                  {rejected.map(d => (
                    <DirectiveCard
                      key={d.id}
                      directive={d}
                      isExpanded={expanded === d.id}
                      onToggle={() => setExpanded(expanded === d.id ? null : d.id)}
                      onAction={refresh}
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
  onAction,
}: {
  directive: Directive;
  isExpanded: boolean;
  onToggle: () => void;
  onAction: () => void;
}) {
  const assignments = d.work_assignments ?? [];
  const pct = progressPercent(assignments);
  const completed = assignments.filter(a => a.status === 'completed').length;
  const total = assignments.length;
  const agentNames = [...new Set(assignments.map(a => DISPLAY_NAME_MAP[a.assigned_to] ?? a.assigned_to))];
  const lastNote = d.progress_notes?.length ? d.progress_notes[d.progress_notes.length - 1] : null;
  const cfg = PRIORITY_CONFIG[d.priority];
  const [acting, setActing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const canCancel = d.status === 'active' || d.status === 'paused';
  const canDelete = d.status !== 'completed';

  async function handleCancel() {
    setActing(true);
    try {
      await apiCall(`/api/founder-directives/${d.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
    } catch (err) {
      console.error('Failed to cancel directive:', err);
    }
    setActing(false);
    onAction();
  }

  async function handleDelete() {
    setActing(true);
    try {
      // Clean up related rows (no CASCADE on FK)
      await apiCall(`/api/agent-tool-grants/${d.id}`, { method: 'DELETE' });
      await apiCall(`/api/work-assignments/${d.id}`, { method: 'DELETE' });
      await apiCall(`/api/founder-directives/${d.id}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to delete directive:', err);
    }
    setActing(false);
    setConfirmDelete(false);
    onAction();
  }

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
                        <div className="mt-1 text-[11px] text-txt-muted leading-relaxed prose-chat border-t border-border pt-2">
                          <Markdown>{a.agent_output}</Markdown>
                        </div>
                      </details>
                    )}
                    {a.evaluation && (
                      <div className="mt-1 text-[10px] text-txt-faint italic prose-chat"><Markdown>{`Evaluation: ${a.evaluation}`}</Markdown></div>
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
                  <div key={i} className="text-[11px] text-txt-muted leading-relaxed prose-chat">
                    <Markdown>{note}</Markdown>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Completion Summary */}
          {d.completion_summary && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
              <p className="text-[11px] font-medium text-emerald-400 mb-1">Completion Summary</p>
              <div className="text-[12px] text-txt-secondary leading-relaxed prose-chat"><Markdown>{d.completion_summary}</Markdown></div>
            </div>
          )}

          {/* Cancel / Delete Actions */}
          {(canCancel || canDelete) && (
            <div className="flex items-center gap-2 border-t border-border pt-3">
              {canCancel && (
                <button
                  onClick={handleCancel}
                  disabled={acting}
                  className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[12px] font-medium text-amber-400 transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <MdBlock className="inline-block text-[14px] mr-1" /> Cancel
                </button>
              )}
              {canDelete && !confirmDelete && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={acting}
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] font-medium text-red-400 transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <MdDelete className="inline-block text-[14px] mr-1" /> Delete
                </button>
              )}
              {confirmDelete && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-red-400">Delete this directive and all its assignments?</span>
                  <button
                    onClick={handleDelete}
                    disabled={acting}
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={acting}
                    className="rounded-lg border border-border bg-raised px-3 py-1.5 text-[12px] font-medium text-txt-secondary transition-colors hover:text-txt-primary disabled:opacity-40"
                  >
                    No
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── Proposed Directive Card ────────────────────── */

function ProposedDirectiveCard({
  directive: d,
  onAction,
}: {
  directive: Directive;
  onAction: () => void;
}) {
  const { user } = useAuth();
  const [acting, setActing] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const cfg = PRIORITY_CONFIG[d.priority];
  const currentUser = user?.email?.split('@')[0] ?? 'founder';

  async function handleApprove() {
    setActing(true);
    try {
      await apiCall(`/api/founder-directives/${d.id}`, { method: 'PATCH', body: JSON.stringify({
        status: 'active',
        approved_by: currentUser,
        approved_at: new Date().toISOString(),
      }) });
    } catch (err) {
      console.error('Failed to approve directive:', err);
    }
    onAction();
  }

  async function handleReject() {
    setActing(true);
    try {
      await apiCall(`/api/founder-directives/${d.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected' }) });
    } catch (err) {
      console.error('Failed to reject directive:', err);
    }
    onAction();
  }

  return (
    <>
      <div className="rounded-xl border-l-4 border-violet-500/60 border border-violet-500/20 bg-violet-500/5 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-txt-primary">{d.title}</p>
            <p className="mt-0.5 text-[11px] text-violet-400">
              Proposed by Sarah · {timeAgo(d.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${cfg.border} ${cfg.bg} ${cfg.text}`}>
              {cfg.label}
            </span>
            <span className="rounded-md border border-border bg-raised px-1.5 py-0.5 text-[10px] font-medium text-txt-muted">
              {CATEGORY_LABELS[d.category]}
            </span>
          </div>
        </div>

        {/* Proposal reason — the key context */}
        {d.proposal_reason && (
          <div className="mt-3 rounded-lg border border-violet-500/15 bg-violet-500/5 px-3 py-2">
            <p className="text-[10px] font-medium text-violet-400 mb-0.5">Why this is needed</p>
            <p className="text-[12px] text-txt-secondary leading-relaxed">{d.proposal_reason}</p>
          </div>
        )}

        {/* Target agents */}
        {d.target_agents?.length > 0 && (
          <p className="mt-2 text-[11px] text-txt-muted">
            Scope: <span className="text-txt-secondary font-medium">
              {d.target_agents.map(r => DISPLAY_NAME_MAP[r] ?? r).join(', ')}
            </span>
          </p>
        )}

        {/* Source directive link */}
        {d.source_directive_id && d.source_directive && (
          <p className="mt-1 text-[11px] text-txt-faint">
            Follow-up from: <span className="text-cyan">{d.source_directive.title}</span>
          </p>
        )}

        {d.due_date && (
          <p className="mt-1 text-[11px] text-txt-faint">
            Suggested deadline: {new Date(d.due_date).toLocaleDateString()}
          </p>
        )}

        {/* Action buttons */}
        <div className="mt-3 flex items-center gap-2 border-t border-violet-500/10 pt-3">
          <button
            onClick={handleApprove}
            disabled={acting}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
                        <MdCheckCircle className="inline-block text-[14px] mr-1" /> Approve
          </button>
          <button
            onClick={() => setShowEdit(true)}
            disabled={acting}
            className="rounded-lg border border-border bg-raised px-3 py-1.5 text-[12px] font-medium text-txt-secondary transition-colors hover:text-txt-primary disabled:opacity-40"
          >
                        <MdEdit className="inline-block text-[14px] mr-1" /> Edit & Approve
          </button>
          <button
            onClick={handleReject}
            disabled={acting}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] font-medium text-red-400 transition-opacity hover:opacity-90 disabled:opacity-40"
          >
                        <MdCancel className="inline-block text-[14px] mr-1" /> Reject
          </button>
        </div>
      </div>

      {showEdit && (
        <EditApproveModal
          directive={d}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); onAction(); }}
        />
      )}
    </>
  );
}

/* ── Edit & Approve Modal ──────────────────────── */

function EditApproveModal({
  directive,
  onClose,
  onSaved,
}: {
  directive: Directive;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState(directive.title);
  const [description, setDescription] = useState(directive.description);
  const [priority, setPriority] = useState<Priority>(directive.priority);
  const [category, setCategory] = useState<Category>(directive.category);
  const [selectedAgents, setSelectedAgents] = useState<string[]>(directive.target_agents ?? []);
  const [dueDate, setDueDate] = useState(directive.due_date ? directive.due_date.split('T')[0] : '');
  const [saving, setSaving] = useState(false);
  const currentUser = user?.email?.split('@')[0] ?? 'founder';

  function toggleAgent(role: string) {
    setSelectedAgents(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  }

  async function handleSave() {
    if (!title.trim() || !description.trim()) return;
    setSaving(true);

    try {
      await apiCall(`/api/founder-directives/${directive.id}`, { method: 'PATCH', body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        priority,
        category,
        target_agents: selectedAgents,
        due_date: dueDate || null,
        status: 'active',
        approved_by: currentUser,
        approved_at: new Date().toISOString(),
      }) });
    } catch (err) {
      console.error('Failed to save directive:', err);
      setSaving(false);
      return;
    }

    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm p-4 pt-[12vh] overflow-y-auto">
      <div className="w-full max-w-lg rounded-xl border border-border bg-white dark:bg-[#111827] shadow-2xl mb-8">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-txt-primary">Edit & Approve Directive</h2>
          <button onClick={onClose} className="text-txt-muted hover:text-txt-primary transition-colors text-lg">
            ×
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="text-[11px] font-medium text-txt-muted mb-1 block">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-txt-muted mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none resize-none"
            />
          </div>
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
          <div>
            <label className="text-[11px] font-medium text-txt-muted mb-2 block">Target Agents</label>
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
          <div>
            <label className="text-[11px] font-medium text-txt-muted mb-1 block">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="rounded-lg border border-border bg-base px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none"
            />
          </div>

          {/* Show proposal reason as read-only context */}
          {directive.proposal_reason && (
            <div className="rounded-lg border border-violet-500/15 bg-violet-500/5 px-3 py-2">
              <p className="text-[10px] font-medium text-violet-400 mb-0.5">Sarah&apos;s reasoning</p>
              <p className="text-[11px] text-txt-muted leading-relaxed">{directive.proposal_reason}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-txt-muted transition-colors hover:text-txt-primary"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim() || !description.trim()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Approve Directive'}
          </button>
        </div>
      </div>
    </div>
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

    try {
      await apiCall('/api/founder-directives', { method: 'POST', body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        priority,
        category,
        target_agents: selectedAgents,
        due_date: dueDate || null,
        created_by: 'kristina',
      }) });
    } catch (error) {
      console.error('Failed to create directive:', error);
      setSaving(false);
      return;
    }

    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm p-4 pt-[12vh] overflow-y-auto">
      <div className="w-full max-w-lg rounded-xl border border-border bg-white dark:bg-[#111827] shadow-2xl mb-8">
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
