import { useEffect, useState, useCallback } from 'react';
import Markdown from 'react-markdown';
import { apiCall } from '../lib/firebase';
import { DISPLAY_NAME_MAP } from '../lib/types';
import { useAuth } from '../lib/auth';
import { Card, SectionHeader, Skeleton, timeAgo } from '../components/ui';
import { MdCheckCircle, MdEdit, MdCancel, MdChevronRight, MdDelete, MdBlock, MdVerifiedUser, MdWarning, MdRefresh, MdExpandMore } from 'react-icons/md';

/* ── Plan Verification Types ───────────────── */

interface PlanVerificationCheck {
  passed: boolean;
  issues: string[];
}

interface PlanVerification {
  id: string;
  directive_id: string;
  verdict: 'APPROVE' | 'WARN' | 'REVISE';
  overall_score: number;
  checks: {
    atomicity: PlanVerificationCheck;
    tool_coverage: PlanVerificationCheck;
    dependency_validity: PlanVerificationCheck;
    context_sufficiency: PlanVerificationCheck;
    workload_balance: PlanVerificationCheck;
  };
  suggestions: string[];
  assignment_count: number;
  llm_verified: boolean;
  created_at: string;
}

const VERDICT_CONFIG: Record<string, { label: string; dot: string; border: string; bg: string; text: string }> = {
  APPROVE: { label: 'APPROVED', dot: 'bg-tier-green', border: 'border-tier-green/30', bg: 'bg-tier-green/15', text: 'text-tier-green' },
  WARN:    { label: 'WARNING',  dot: 'bg-prism-elevated', border: 'border-prism-elevated/30', bg: 'bg-prism-elevated/15', text: 'text-prism-elevated' },
  REVISE:  { label: 'REVISE',   dot: 'bg-prism-critical', border: 'border-prism-critical/30', bg: 'bg-prism-critical/15', text: 'text-prism-critical' },
};

/* ── Types ─────────────────────────────────────── */

type Priority = 'critical' | 'high' | 'medium' | 'low';
type DirectiveStatus = 'proposed' | 'active' | 'paused' | 'completed' | 'cancelled' | 'rejected';
type Category = 'revenue' | 'product' | 'engineering' | 'marketing' | 'sales' | 'operations' | 'general' | 'strategy' | 'design';

interface WorkAssignment {
  id: string;
  assigned_to: string;
  assigned_by: string | null;
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
  assignment_type: string | null;
  parent_assignment_id: string | null;
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
  delegated_to: string | null;
  delegation_type: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  work_assignments: WorkAssignment[];
  source_directive?: { title: string } | null;
}

interface Initiative {
  id: string;
  proposed_by: string;
  title: string;
  justification: string;
  proposed_assignments: Array<{ agent_role: string; task_description: string }>;
  expected_outcome: string;
  priority: string;
  estimated_days: number | null;
  status: 'pending' | 'approved' | 'deferred' | 'rejected';
  evaluation_notes: string | null;
  evaluated_by: string | null;
  directive_id: string | null;
  created_at: string;
  evaluated_at: string | null;
}

/* ── Constants ─────────────────────────────────── */

const PRIORITY_CONFIG: Record<Priority, { label: string; dot: string; border: string; bg: string; text: string }> = {
  critical: { label: 'CRITICAL', dot: 'bg-prism-critical', border: 'border-prism-critical/30', bg: 'bg-prism-critical/10', text: 'text-prism-critical' },
  high:     { label: 'HIGH',     dot: 'bg-prism-high', border: 'border-prism-high/30', bg: 'bg-prism-high/10', text: 'text-prism-high' },
  medium:   { label: 'MEDIUM',   dot: 'bg-prism-fill-3', border: 'border-prism-fill-3/30', bg: 'bg-prism-fill-3/10', text: 'text-prism-sky' },
  low:      { label: 'LOW',      dot: 'bg-prism-moderate', border: 'border-prism-moderate/30', bg: 'bg-prism-moderate/10', text: 'text-prism-moderate' },
};

const CATEGORY_LABELS: Record<Category, string> = {
  revenue: 'Revenue', product: 'Product', engineering: 'Engineering',
  marketing: 'Marketing', sales: 'Sales',
  operations: 'Operations', general: 'General', strategy: 'Strategy', design: 'Design',
};

const TARGET_AGENTS = [
  { role: 'cto', label: 'Marcus (CTO)' },
  { role: 'cfo', label: 'Nadia (CFO)' },
  { role: 'cpo', label: 'Elena (CPO)' },
  { role: 'cmo', label: 'Maya (CMO)' },
  { role: 'vp-sales', label: 'Rachel (VP Sales)' },
  { role: 'vp-design', label: 'Mia (VP Design)' },
];

/* ── Helpers ───────────────────────────────────── */

function assignmentStatusColor(status: string) {
  if (status === 'completed') return 'bg-prism-fill-2';
  if (status === 'failed' || status === 'blocked') return 'bg-prism-critical';
  if (status === 'dispatched' || status === 'in_progress') return 'bg-prism-elevated animate-pulse';
  return 'bg-prism-moderate';
}

function progressPercent(assignments: WorkAssignment[]): number {
  if (assignments.length === 0) return 0;
  return Math.round((assignments.filter(a => a.status === 'completed').length / assignments.length) * 100);
}

/* ── Page ──────────────────────────────────────── */

export default function Directives() {
  const [directives, setDirectives] = useState<Directive[]>([]);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showInitiatives, setShowInitiatives] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const refresh = useCallback(async () => {
    const [data, initData] = await Promise.all([
      apiCall('/api/founder-directives?include=work_assignments,source_directive'),
      apiCall('/api/proposed_initiatives').catch(() => []),
    ]);

    setDirectives((data as Directive[] | null) ?? []);
    setInitiatives((initData as Initiative[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Real-time subscription removed (was PostgREST realtime)
  useEffect(() => {}, [refresh]);

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll(ids: string[]) {
    setSelected(prev => {
      const next = new Set(prev);
      const allSelected = ids.every(id => next.has(id));
      if (allSelected) { ids.forEach(id => next.delete(id)); }
      else { ids.forEach(id => next.add(id)); }
      return next;
    });
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    setBulkDeleting(true);
    try {
      await apiCall('/api/founder-directives/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids: [...selected] }),
      });
      setSelected(new Set());
      setConfirmBulkDelete(false);
      await refresh();
    } catch (err) {
      console.error('Bulk delete failed:', err);
    }
    setBulkDeleting(false);
  }

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
        <div className="flex items-center gap-2">
          {directives.length > 0 && (
            <button
              onClick={() => selected.size > 0 ? setSelected(new Set()) : selectAll(directives.map(d => d.id))}
              className="rounded-lg border border-border bg-raised px-3 py-2 text-sm font-medium text-txt-secondary transition-colors hover:text-txt-primary"
            >
              {selected.size > 0 ? 'Deselect All' : 'Select All'}
            </button>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-cyan/10 border border-cyan/40 px-4 py-2 text-sm font-medium text-cyan transition-opacity hover:bg-cyan/20"
          >
            + New Directive
          </button>
        </div>
      </div>

      {/* Bulk Delete Bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-prism-critical/30 bg-prism-critical/10 px-4 py-2.5">
          <span className="text-sm font-medium text-prism-critical">
            {selected.size} directive{selected.size > 1 ? 's' : ''} selected
          </span>
          {!confirmBulkDelete ? (
            <button
              onClick={() => setConfirmBulkDelete(true)}
              disabled={bulkDeleting}
              className="ml-auto rounded-lg border border-prism-critical/30 bg-prism-critical/20 px-3 py-1.5 text-[12px] font-medium text-prism-critical transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <MdDelete className="inline-block text-[14px] mr-1" /> Delete Selected
            </button>
          ) : (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[12px] text-prism-critical">Delete {selected.size} directive{selected.size > 1 ? 's' : ''} and all assignments?</span>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="rounded-lg bg-prism-critical px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {bulkDeleting ? 'Deleting…' : 'Confirm'}
              </button>
              <button
                onClick={() => setConfirmBulkDelete(false)}
                disabled={bulkDeleting}
                className="rounded-lg border border-border bg-raised px-3 py-1.5 text-[12px] font-medium text-txt-secondary transition-colors hover:text-txt-primary disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

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
                <span className="h-2 w-2 rounded-full bg-prism-violet animate-pulse" />
                <span className="text-xs font-semibold uppercase tracking-wider text-prism-violet">
                  PROPOSED
                </span>
                <span className="text-[11px] text-txt-faint">({proposed.length})</span>
                <span className="ml-2 text-[10px] text-prism-violet/70">Needs your approval</span>
              </div>
              <div className="space-y-3">
                {proposed.map(d => (
                  <ProposedDirectiveCard
                    key={d.id}
                    directive={d}
                    onAction={refresh}
                    isSelected={selected.has(d.id)}
                    onToggleSelect={() => toggleSelect(d.id)}
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
                      isSelected={selected.has(d.id)}
                      onToggleSelect={() => toggleSelect(d.id)}
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
                      isSelected={selected.has(d.id)}
                      onToggleSelect={() => toggleSelect(d.id)}
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
                      isSelected={selected.has(d.id)}
                      onToggleSelect={() => toggleSelect(d.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Agent-Proposed Initiatives */}
          {initiatives.length > 0 && (
            <div>
              <button
                onClick={() => setShowInitiatives(!showInitiatives)}
                className="flex items-center gap-2 text-xs font-semibold text-txt-secondary hover:text-txt-primary transition-colors"
              >
                <span className={`text-[10px] transition-transform duration-200 ${showInitiatives ? 'rotate-90' : ''}`}>
                  <MdChevronRight />
                </span>
                AGENT INITIATIVES ({initiatives.filter(i => i.status === 'pending').length} pending, {initiatives.length} total)
              </button>
              {showInitiatives && (
                <div className="mt-3 space-y-3">
                  {initiatives
                    .sort((a, b) => (a.status === 'pending' ? -1 : 1) - (b.status === 'pending' ? -1 : 1) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .map(init => (
                    <Card key={init.id} className={`border ${init.status === 'pending' ? 'border-prism-violet/30' : 'border-border'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`h-2 w-2 rounded-full ${
                              init.status === 'pending' ? 'bg-prism-violet animate-pulse' :
                              init.status === 'approved' ? 'bg-prism-fill-2' :
                              init.status === 'deferred' ? 'bg-prism-elevated' :
                              'bg-prism-critical'
                            }`} />
                            <span className="text-sm font-medium text-txt-primary">{init.title}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                              PRIORITY_CONFIG[init.priority as Priority]?.bg ?? ''
                            } ${PRIORITY_CONFIG[init.priority as Priority]?.text ?? 'text-txt-faint'}`}>
                              {init.priority.toUpperCase()}
                            </span>
                            <span className="text-[10px] text-txt-faint uppercase">{init.status}</span>
                          </div>
                          <p className="mt-1 text-xs text-txt-muted">
                            Proposed by <span className="font-medium text-txt-secondary">{DISPLAY_NAME_MAP[init.proposed_by] ?? init.proposed_by}</span>
                            {' · '}{new Date(init.created_at).toLocaleDateString()}
                            {init.estimated_days && ` · Est. ${init.estimated_days} days`}
                          </p>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-txt-muted leading-relaxed">{init.justification}</p>
                      {init.proposed_assignments.length > 0 && (
                        <div className="mt-2">
                          <p className="text-[10px] font-medium text-txt-faint uppercase mb-1">Proposed Assignments</p>
                          <div className="space-y-1">
                            {init.proposed_assignments.map((a, i) => (
                              <div key={i} className="text-[11px] text-txt-muted">
                                <span className="font-medium text-txt-secondary">{DISPLAY_NAME_MAP[a.agent_role] ?? a.agent_role}</span>
                                {' — '}{a.task_description}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {init.expected_outcome && (
                        <p className="mt-2 text-[10px] text-txt-faint">
                          <span className="font-medium">Expected outcome:</span> {init.expected_outcome}
                        </p>
                      )}
                      {init.evaluation_notes && (
                        <div className="mt-2 rounded border border-border bg-raised px-2 py-1.5">
                          <p className="text-[10px] font-medium text-txt-faint">
                            Evaluation by {DISPLAY_NAME_MAP[init.evaluated_by ?? ''] ?? init.evaluated_by}:
                          </p>
                          <p className="text-[11px] text-txt-muted">{init.evaluation_notes}</p>
                        </div>
                      )}
                    </Card>
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
  isSelected,
  onToggleSelect,
}: {
  directive: Directive;
  isExpanded: boolean;
  onToggle: () => void;
  onAction: () => void;
  isSelected?: boolean;
  onToggleSelect?: () => void;
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
  const [verification, setVerification] = useState<PlanVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [showChecks, setShowChecks] = useState(false);

  // Fetch latest verification when expanded
  useEffect(() => {
    if (!isExpanded) return;
    apiCall<PlanVerification[]>(`/api/plan-verifications?directive_id=${d.id}&order=created_at.desc&limit=1`)
      .then(rows => setVerification(rows?.[0] ?? null))
      .catch(() => {});
  }, [isExpanded, d.id]);

  async function handleReVerify() {
    setVerifying(true);
    try {
      const result = await apiCall<PlanVerification>(`/plan-verify/${d.id}`, { method: 'POST' });
      // Re-fetch the persisted row to get full record with id/created_at
      const rows = await apiCall<PlanVerification[]>(`/api/plan-verifications?directive_id=${d.id}&order=created_at.desc&limit=1`);
      setVerification(rows?.[0] ?? { ...result, id: '', directive_id: d.id, assignment_count: 0, llm_verified: false, created_at: new Date().toISOString() } as PlanVerification);
    } catch (err) {
      console.error('Re-verify failed:', err);
    }
    setVerifying(false);
  }

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
      // Server-side cascade handles child rows (no CASCADE on FK)
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
      <div className="flex items-start gap-2">
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={!!isSelected}
            onChange={onToggleSelect}
            className="mt-1.5 h-4 w-4 shrink-0 rounded border-border accent-cyan cursor-pointer"
          />
        )}
      <button onClick={onToggle} className="flex w-full items-start justify-between text-left gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-semibold text-txt-primary truncate">{d.title}</p>
            {d.status === 'paused' && (
              <span className="rounded-full border border-prism-elevated/30 bg-prism-elevated/15 px-1.5 py-0.5 text-[10px] font-medium text-prism-elevated">
                paused
              </span>
            )}
            {d.status === 'completed' && (
              <span className="rounded-full border border-prism-fill-2/30 bg-prism-fill-2/15 px-1.5 py-0.5 text-[10px] font-medium text-prism-teal">
                completed
              </span>
            )}
            {d.delegated_to && (
              <span className="rounded-full border border-purple-500/30 bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-400">
                Delegated to {DISPLAY_NAME_MAP[d.delegated_to] ?? d.delegated_to}
              </span>
            )}
            {!d.delegated_to && d.delegation_type === 'cross-domain' && (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                Cross-domain
              </span>
            )}
            {!d.delegated_to && !d.delegation_type && d.status === 'active' && (
              <span className="rounded-full border border-sky-500/30 bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
                Self-orchestrated
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
                    pct === 100 ? 'bg-prism-fill-2' : pct > 0 ? 'bg-cyan' : 'bg-transparent'
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
      </div>

      {/* Expanded Detail */}
      {isExpanded && (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          {/* Description */}
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-1">Description</p>
            <div className="text-sm text-txt-secondary leading-relaxed prose-chat"><Markdown>{d.description}</Markdown></div>
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
            {d.delegated_to && (
              <span>Delegated to: <span className="text-purple-400 font-medium">{DISPLAY_NAME_MAP[d.delegated_to] ?? d.delegated_to}</span></span>
            )}
          </div>

          {/* Work Assignments — Two-Tier Tree View */}
          {assignments.length > 0 && (() => {
            // Separate top-level assignments (no parent) from sub-tasks
            const topLevel = assignments.filter(a => !a.parent_assignment_id);
            const subTasks = assignments.filter(a => a.parent_assignment_id);
            const childrenOf = (parentId: string) => subTasks.filter(s => s.parent_assignment_id === parentId);

            const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
              executive_outcome: { label: 'Exec Outcome', cls: 'bg-purple-500/15 text-purple-400' },
              team_task: { label: 'Team Task', cls: 'bg-blue-500/15 text-blue-400' },
              peer_request: { label: 'Peer Request', cls: 'bg-amber-500/15 text-amber-400' },
              standard: { label: 'Standard', cls: 'bg-neutral-500/15 text-neutral-400' },
            };

            const renderAssignment = (a: WorkAssignment, indent = false) => (
              <div key={a.id} className={`rounded-lg border border-border bg-raised px-3 py-2.5 ${indent ? 'ml-6 border-l-2 border-l-border' : ''}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`h-2 w-2 rounded-full ${assignmentStatusColor(a.status)}`} />
                  <span className="text-[12px] font-medium text-txt-primary">
                    {DISPLAY_NAME_MAP[a.assigned_to] ?? a.assigned_to}
                  </span>
                  <span className="text-[10px] text-txt-faint">({a.status})</span>
                  {a.assignment_type && a.assignment_type !== 'standard' && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${TYPE_BADGE[a.assignment_type]?.cls ?? ''}`}>
                      {TYPE_BADGE[a.assignment_type]?.label ?? a.assignment_type}
                    </span>
                  )}
                  {a.assigned_by && a.assigned_by !== 'chief-of-staff' && (
                    <span className="text-[9px] text-txt-faint">
                      via {DISPLAY_NAME_MAP[a.assigned_by] ?? a.assigned_by}
                    </span>
                  )}
                  {a.quality_score != null && (
                    <span className={`ml-auto text-[10px] font-mono font-semibold ${
                      a.quality_score >= 70 ? 'text-prism-teal' : a.quality_score >= 40 ? 'text-prism-elevated' : 'text-prism-critical'
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
            );

            return (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted mb-2">
                  Work Assignments
                </p>
                <div className="space-y-2">
                  {topLevel.map(a => (
                    <div key={a.id}>
                      {renderAssignment(a)}
                      {childrenOf(a.id).length > 0 && (
                        <div className="space-y-1.5 mt-1.5">
                          {childrenOf(a.id).map(child => renderAssignment(child, true))}
                        </div>
                      )}
                    </div>
                  ))}
                  {/* Orphan sub-tasks (parent not in this directive) */}
                  {subTasks.filter(s => !topLevel.some(t => t.id === s.parent_assignment_id)).map(a => renderAssignment(a))}
                </div>
            </div>
            );
          })()}

          {/* Plan Verification */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">
                Plan Verification
              </p>
              {verification && (() => {
                const vc = VERDICT_CONFIG[verification.verdict] ?? VERDICT_CONFIG.WARN;
                return (
                  <span className={`rounded-full border ${vc.border} ${vc.bg} px-1.5 py-0.5 text-[10px] font-medium ${vc.text}`}>
                    {vc.label}
                  </span>
                );
              })()}
              <button
                onClick={handleReVerify}
                disabled={verifying}
                className="ml-auto rounded-md border border-border bg-raised px-2 py-1 text-[10px] font-medium text-txt-secondary hover:bg-surface disabled:opacity-50 flex items-center gap-1"
              >
                <MdRefresh className={`text-[12px] ${verifying ? 'animate-spin' : ''}`} />
                {verifying ? 'Verifying…' : 'Re-verify'}
              </button>
            </div>

            {verification ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-[11px] text-txt-faint">
                  <span>Score: <span className="font-mono font-medium text-txt-secondary">{(verification.overall_score * 100).toFixed(0)}%</span></span>
                  <span>Assignments: <span className="font-medium text-txt-secondary">{verification.assignment_count}</span></span>
                  {verification.llm_verified && <span className="text-prism-violet">LLM verified</span>}
                  <span>{timeAgo(verification.created_at)}</span>
                </div>

                {/* Expandable checks */}
                <button
                  onClick={() => setShowChecks(!showChecks)}
                  className="flex items-center gap-1 text-[11px] text-cyan hover:underline"
                >
                  <MdExpandMore className={`text-[14px] transition-transform ${showChecks ? 'rotate-0' : '-rotate-90'}`} />
                  {showChecks ? 'Hide checks' : 'Show checks'}
                </button>

                {showChecks && (
                  <div className="space-y-1.5">
                    {Object.entries(verification.checks).map(([name, check]) => (
                      <div key={name} className="rounded-lg border border-border bg-raised px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${check.passed ? 'bg-tier-green' : 'bg-prism-critical'}`} />
                          <span className="text-[11px] font-medium text-txt-secondary">{name.replace(/_/g, ' ')}</span>
                        </div>
                        {check.issues.length > 0 && (
                          <ul className="mt-1 ml-4 list-disc space-y-0.5">
                            {check.issues.map((issue: string, i: number) => (
                              <li key={i} className="text-[10px] text-txt-muted">{issue}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}

                    {verification.suggestions.length > 0 && (
                      <div className="rounded-lg border border-prism-elevated/20 bg-prism-elevated/5 px-3 py-2">
                        <p className="text-[10px] font-medium text-prism-elevated mb-1">Suggestions</p>
                        <ul className="list-disc ml-4 space-y-0.5">
                          {verification.suggestions.map((s, i) => (
                            <li key={i} className="text-[10px] text-txt-muted">{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-txt-faint">No verification recorded yet. Click Re-verify to run checks.</p>
            )}
          </div>

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
            <div className="rounded-lg border border-prism-fill-2/20 bg-prism-tint-2 px-3 py-2">
              <p className="text-[11px] font-medium text-prism-teal mb-1">Completion Summary</p>
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
                  className="rounded-lg border border-prism-elevated/30 bg-prism-elevated/10 px-3 py-1.5 text-[12px] font-medium text-prism-elevated transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <MdBlock className="inline-block text-[14px] mr-1" /> Cancel
                </button>
              )}
              {canDelete && !confirmDelete && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={acting}
                  className="rounded-lg border border-prism-critical/30 bg-prism-critical/10 px-3 py-1.5 text-[12px] font-medium text-prism-critical transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <MdDelete className="inline-block text-[14px] mr-1" /> Delete
                </button>
              )}
              {confirmDelete && (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-prism-critical">Delete this directive and all its assignments?</span>
                  <button
                    onClick={handleDelete}
                    disabled={acting}
                    className="rounded-lg bg-prism-critical px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
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
  isSelected,
  onToggleSelect,
}: {
  directive: Directive;
  onAction: () => void;
  isSelected?: boolean;
  onToggleSelect?: () => void;
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
      <div className="rounded-xl border-l-4 border-prism-violet/60 border border-prism-violet/20 bg-prism-tint-5 p-4">
        <div className="flex items-start justify-between gap-4">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={!!isSelected}
              onChange={onToggleSelect}
              className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-cyan cursor-pointer"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-txt-primary">{d.title}</p>
              <p className="mt-0.5 text-[11px] text-prism-violet">
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
          <div className="mt-3 rounded-lg border border-prism-violet/15 bg-prism-tint-5 px-3 py-2">
            <p className="text-[10px] font-medium text-prism-violet mb-0.5">Why this is needed</p>
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
        <div className="mt-3 flex items-center gap-2 border-t border-prism-violet/10 pt-3">
          <button
            onClick={handleApprove}
            disabled={acting}
            className="rounded-lg bg-prism-fill-2 px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
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
            className="rounded-lg border border-prism-critical/30 bg-prism-critical/10 px-3 py-1.5 text-[12px] font-medium text-prism-critical transition-opacity hover:opacity-90 disabled:opacity-40"
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
    <div className="modal-shell items-start overflow-y-auto pt-[12vh]" onClick={onClose}>
      <div className="modal-panel mb-8 max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-prism-border px-6 py-4">
          <h2 className="text-lg font-semibold text-prism-primary">Edit & Approve Directive</h2>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <div className="rounded-lg border border-prism-violet/15 bg-prism-tint-5 px-3 py-2">
              <p className="text-[10px] font-medium text-prism-violet mb-0.5">Sarah&apos;s reasoning</p>
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
            className="rounded-lg bg-prism-fill-2 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
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
    <div className="modal-shell items-start overflow-y-auto pt-[12vh]" onClick={onClose}>
      <div className="modal-panel mb-8 max-w-lg" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-prism-border px-6 py-4">
          <h2 className="text-lg font-semibold text-prism-primary">New Directive</h2>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            className="rounded-lg bg-cyan/10 border border-cyan/40 px-4 py-2 text-sm font-medium text-cyan transition-opacity hover:bg-cyan/20 disabled:opacity-40"
          >
            {saving ? 'Creating…' : 'Create Directive'}
          </button>
        </div>
      </div>
    </div>
  );
}
