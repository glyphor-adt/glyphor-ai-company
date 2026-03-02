import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { apiCall } from '../lib/firebase';
import { useAuth } from '../lib/auth';
import { Card, Skeleton, timeAgo } from '../components/ui';
import { DISPLAY_NAME_MAP } from '../lib/types';
import type { DashboardChangeRequest } from '../lib/types';
import { MdAdd, MdClose, MdOpenInNew, MdCode, MdBugReport, MdAutoFixHigh, MdBuild, MdCheck, MdBlock } from 'react-icons/md';

/* ── Constants ─────────────────────────────────── */

type Priority = DashboardChangeRequest['priority'];
type RequestType = DashboardChangeRequest['request_type'];
type Status = DashboardChangeRequest['status'];

const PRIORITY_CONFIG: Record<Priority, { label: string; dot: string; text: string; bg: string }> = {
  critical: { label: 'CRITICAL', dot: 'bg-prism-critical', text: 'text-prism-critical', bg: 'bg-prism-critical/10' },
  high:     { label: 'HIGH',     dot: 'bg-prism-high', text: 'text-prism-high', bg: 'bg-prism-high/10' },
  medium:   { label: 'MEDIUM',   dot: 'bg-prism-fill-3', text: 'text-prism-sky', bg: 'bg-prism-fill-3/10' },
  low:      { label: 'LOW',      dot: 'bg-prism-moderate', text: 'text-prism-moderate', bg: 'bg-prism-moderate/10' },
};

const STATUS_CONFIG: Record<Status, { label: string; color: string; bg: string }> = {
  pending_approval: { label: 'Pending Approval', color: 'text-prism-high',      bg: 'bg-prism-high/10' },
  submitted:   { label: 'Submitted',   color: 'text-prism-moderate',  bg: 'bg-prism-moderate/10' },
  triaged:     { label: 'Triaged',     color: 'text-prism-violet',    bg: 'bg-prism-violet/10' },
  in_progress: { label: 'In Progress', color: 'text-prism-elevated',  bg: 'bg-prism-elevated/10' },
  review:      { label: 'In Review',   color: 'text-cyan',            bg: 'bg-cyan/10' },
  deployed:    { label: 'Deployed',    color: 'text-prism-teal',      bg: 'bg-prism-fill-2/10' },
  rejected:    { label: 'Rejected',    color: 'text-prism-critical',  bg: 'bg-prism-critical/10' },
};

const TYPE_CONFIG: Record<RequestType, { label: string; icon: typeof MdCode }> = {
  feature:     { label: 'Feature',     icon: MdAutoFixHigh },
  fix:         { label: 'Bug Fix',     icon: MdBugReport },
  improvement: { label: 'Improvement', icon: MdBuild },
  refactor:    { label: 'Refactor',    icon: MdCode },
};

const AREA_OPTIONS = [
  'dashboard', 'directives', 'workforce', 'comms', 'approvals',
  'financials', 'operations', 'strategy', 'knowledge', 'capabilities',
  'builder', 'governance', 'settings', 'chat', 'other',
] as const;

// Requests from these emails require Kristina's approval before proceeding
const APPROVAL_REQUIRED_EMAILS = ['andrew@glyphor.ai', 'andrew.zwelling@gmail.com'];
const APPROVER_EMAIL = 'kristina@glyphor.ai';

const IT_AGENTS = [
  { role: 'frontend-engineer', label: 'Ava Chen (Frontend Engineer)' },
  { role: 'devops-engineer', label: 'Jordan Hayes (DevOps Engineer)' },
  { role: 'platform-engineer', label: 'Alex Park (Platform Engineer)' },
  { role: 'ui-ux-designer', label: 'Leo Vargas (UI/UX Designer)' },
  { role: 'quality-engineer', label: 'Sam DeLuca (Quality Engineer)' },
];

/* ── Page ──────────────────────────────────────── */

export default function ChangeRequests() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<DashboardChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('open');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall<DashboardChangeRequest[]>('/api/dashboard-change-requests');
      setRequests(data ?? []);
    } catch {
      setRequests([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Real-time not available after Firebase migration
  useEffect(() => {}, [refresh]);

  const filtered = requests.filter(r => {
    if (filter === 'open') return !['deployed', 'rejected'].includes(r.status);
    if (filter === 'done') return ['deployed', 'rejected'].includes(r.status);
    return true;
  });

  const openCount = requests.filter(r => !['deployed', 'rejected'].includes(r.status)).length;
  const doneCount = requests.filter(r => ['deployed', 'rejected'].includes(r.status)).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-txt-primary">Change Requests</h1>
          <p className="mt-1 text-sm text-txt-muted">
            Submit feature requests and bug fixes — IT agents will implement them via GitHub
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 rounded-lg bg-cyan px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90"
        >
          <MdAdd className="text-base" />
          New Request
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-1 rounded-lg bg-raised p-1 w-fit border border-border">
        {([
          { key: 'open' as const, label: `Open (${openCount})` },
          { key: 'done' as const, label: `Done (${doneCount})` },
          { key: 'all' as const, label: `All (${requests.length})` },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`rounded-md px-4 py-1.5 text-[13px] font-medium transition-colors ${
              filter === tab.key
                ? 'bg-cyan/15 text-cyan'
                : 'text-txt-muted hover:text-txt-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <p className="text-center text-sm text-txt-faint py-8">
            {filter === 'open'
              ? 'No open requests. Submit one to get the team working on it!'
              : 'No requests found.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(req => (
            <RequestCard key={req.id} request={req} />
          ))}
        </div>
      )}

      {/* New Request Modal */}
      {showForm && (
        <NewRequestModal
          userEmail={user?.email ?? ''}
          onClose={() => setShowForm(false)}
          onSubmitted={() => { setShowForm(false); refresh(); }}
        />
      )}
    </div>
  );
}

/* ── Request Card ──────────────────────────────── */

function RequestCard({ request: r }: { request: DashboardChangeRequest }) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_CONFIG[r.status];
  const priority = PRIORITY_CONFIG[r.priority];
  const type = TYPE_CONFIG[r.request_type];
  const TypeIcon = type.icon;

  const isApprover = user?.email?.toLowerCase() === APPROVER_EMAIL;
  const showApprovalActions = r.status === 'pending_approval' && isApprover;

  const handleApprove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await apiCall(`/api/dashboard-change-requests/${r.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'submitted',
        approved_by: user?.email ?? null,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
  };

  const handleReject = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const reason = prompt('Rejection reason (optional):');
    await apiCall(`/api/dashboard-change-requests/${r.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'rejected',
        rejection_reason: reason || 'Rejected by approver',
        updated_at: new Date().toISOString(),
      }),
    });
  };

  return (
    <Card className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
      <div className="flex items-start gap-4">
        {/* Type icon */}
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-txt-muted">
          <TypeIcon className="text-lg" />
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-txt-primary">{r.title}</h3>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.bg} ${status.color}`}>
              {status.label}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${priority.bg} ${priority.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${priority.dot}`} />
              {priority.label}
            </span>
            <span className="rounded-full bg-raised px-2 py-0.5 text-[10px] font-medium text-txt-muted">
              {type.label}
            </span>
          </div>

          <p className="mt-1 text-xs text-txt-muted line-clamp-2">{r.description}</p>

          <div className="mt-2 flex items-center gap-4 text-[11px] text-txt-faint">
            <span>by {r.submitted_by.split('@')[0]}</span>
            <span>{timeAgo(r.created_at)}</span>
            {r.affected_area && (
              <span className="rounded bg-raised px-1.5 py-0.5 text-[10px]">{r.affected_area}</span>
            )}
            {r.assigned_to && (
              <span>→ {r.assigned_to === 'copilot' ? 'GitHub Copilot' : (DISPLAY_NAME_MAP[r.assigned_to] ?? r.assigned_to)}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {showApprovalActions && (
            <>
              <button
                onClick={handleApprove}
                className="flex items-center gap-1 rounded-lg bg-prism-fill-2/10 px-2.5 py-1.5 text-[11px] font-medium text-prism-teal hover:bg-prism-fill-2/20 transition-colors"
              >
                <MdCheck className="text-sm" />
                Approve
              </button>
              <button
                onClick={handleReject}
                className="flex items-center gap-1 rounded-lg bg-prism-critical/10 px-2.5 py-1.5 text-[11px] font-medium text-prism-critical hover:bg-prism-critical/20 transition-colors"
              >
                <MdBlock className="text-sm" />
                Reject
              </button>
            </>
          )}
          {r.github_issue_url && (
            <a
              href={r.github_issue_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 rounded-lg bg-raised px-2.5 py-1.5 text-[11px] font-medium text-txt-secondary hover:bg-prism-violet/10 hover:text-prism-violet transition-colors"
            >
              <MdOpenInNew className="text-sm" />
              Issue
            </a>
          )}
          {r.github_pr_url && (
            <a
              href={r.github_pr_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 rounded-lg bg-raised px-2.5 py-1.5 text-[11px] font-medium text-cyan hover:bg-cyan/10 transition-colors"
            >
              <MdOpenInNew className="text-sm" />
              PR
            </a>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-4 border-t border-border pt-4 space-y-3">
          {r.status === 'pending_approval' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-prism-high/10 px-2.5 py-1 text-[11px] font-medium text-prism-high">
                Awaiting approval from Kristina
              </span>
            </div>
          )}
          {r.approved_by && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-txt-faint w-20">Approved:</span>
              <span className="text-prism-teal">{r.approved_by.split('@')[0]}</span>
              {r.approved_at && <span className="text-txt-faint">— {new Date(r.approved_at).toLocaleString()}</span>}
            </div>
          )}
          {r.assigned_to === 'copilot' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-prism-violet/10 px-2.5 py-1 text-[11px] font-medium text-prism-violet">
                <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM5.78 8.75a9.64 9.64 0 0 0 1.363 4.177c.255.426.542.832.857 1.215.245-.296.551-.705.857-1.215A9.64 9.64 0 0 0 10.22 8.75Zm4.44-1.5a9.64 9.64 0 0 0-1.363-4.177c-.307-.51-.612-.919-.857-1.215a9.927 9.927 0 0 0-.857 1.215A9.64 9.64 0 0 0 5.78 7.25Z"/></svg>
                Assigned to GitHub Copilot
              </span>
            </div>
          )}
          {r.github_issue_url && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-txt-faint w-20">Issue:</span>
              <a href={r.github_issue_url} target="_blank" rel="noopener noreferrer"
                className="text-cyan hover:underline font-mono text-[11px]">
                #{r.github_issue_number}
              </a>
            </div>
          )}
          {r.github_branch && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-txt-faint w-20">Branch:</span>
              <code className="rounded bg-raised px-2 py-0.5 text-[11px] text-txt-secondary font-mono">{r.github_branch}</code>
            </div>
          )}
          {r.commit_sha && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-txt-faint w-20">Commit:</span>
              <code className="rounded bg-raised px-2 py-0.5 text-[11px] text-txt-secondary font-mono">{r.commit_sha.slice(0, 8)}</code>
            </div>
          )}
          {r.agent_notes && (
            <div className="text-xs">
              <span className="text-txt-faint">Agent Notes:</span>
              <p className="mt-1 text-txt-secondary whitespace-pre-wrap rounded bg-raised p-3 text-[12px]">{r.agent_notes}</p>
            </div>
          )}
          {r.rejection_reason && (
            <div className="text-xs">
              <span className="text-prism-critical">Rejection Reason:</span>
              <p className="mt-1 text-txt-secondary">{r.rejection_reason}</p>
            </div>
          )}
          {r.started_at && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-txt-faint w-20">Started:</span>
              <span className="text-txt-secondary">{new Date(r.started_at).toLocaleString()}</span>
            </div>
          )}
          {r.completed_at && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-txt-faint w-20">Completed:</span>
              <span className="text-txt-secondary">{new Date(r.completed_at).toLocaleString()}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── New Request Modal ─────────────────────────── */

function NewRequestModal({
  userEmail,
  onClose,
  onSubmitted,
}: {
  userEmail: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requestType, setRequestType] = useState<RequestType>('feature');
  const [priority, setPriority] = useState<Priority>('medium');
  const [affectedArea, setAffectedArea] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    setSubmitting(true);
    const needsApproval = APPROVAL_REQUIRED_EMAILS.includes(userEmail.toLowerCase()) && requestType !== 'fix';
    await apiCall('/api/dashboard-change-requests', {
      method: 'POST',
      body: JSON.stringify({
        submitted_by: userEmail,
        title: title.trim(),
        description: description.trim(),
        request_type: requestType,
        priority,
        affected_area: affectedArea || null,
        ...(needsApproval ? { status: 'pending_approval' } : {}),
      }),
    });
    setSubmitting(false);
    onSubmitted();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-prism-lg"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-txt-primary">New Change Request</h2>
          <button onClick={onClose} className="text-txt-muted hover:text-txt-primary transition-colors">
            <MdClose className="text-xl" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-txt-secondary mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Add dark mode toggle to settings page"
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-primary placeholder:text-txt-faint focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan/30"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-txt-secondary mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe what you want changed, where it should be, and any specific details..."
              rows={4}
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-primary placeholder:text-txt-faint focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan/30 resize-none"
              required
            />
          </div>

          {/* Type + Priority row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-txt-secondary mb-1">Type</label>
              <select
                value={requestType}
                onChange={e => setRequestType(e.target.value as RequestType)}
                className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan/30"
              >
                <option value="feature">Feature</option>
                <option value="fix">Bug Fix</option>
                <option value="improvement">Improvement</option>
                <option value="refactor">Refactor</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-txt-secondary mb-1">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value as Priority)}
                className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan/30"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          {/* Affected Area */}
          <div>
            <label className="block text-xs font-medium text-txt-secondary mb-1">Affected Area</label>
            <select
              value={affectedArea}
              onChange={e => setAffectedArea(e.target.value)}
              className="w-full rounded-lg border border-border bg-raised px-3 py-2 text-sm text-txt-primary focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan/30"
            >
              <option value="">Select area (optional)</option>
              {AREA_OPTIONS.map(a => (
                <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>
              ))}
            </select>
          </div>

          {/* Info callout */}
          <div className="rounded-lg border border-cyan/20 bg-cyan/5 px-3 py-2.5 text-[12px] text-txt-muted">
            Your request will be triaged by the engineering team and assigned to an IT agent
            (like Ava Chen or Jordan Hayes) who will create a branch, implement the changes,
            and open a PR for review.
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-txt-muted hover:text-txt-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim() || !description.trim()}
              className="rounded-lg bg-cyan px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
