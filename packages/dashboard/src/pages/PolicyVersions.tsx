import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiCall, SCHEDULER_URL } from '../lib/firebase';
import { Card, SectionHeader, Skeleton, timeAgo, PageTabs } from '../components/ui';
import { MdPlayArrow, MdScience, MdCheck, MdWarning, MdFilterList } from 'react-icons/md';

/* ── Types ────────────────────────────────── */

interface PolicyVersion {
  id: string;
  policy_type: string;
  agent_role: string;
  version: number;
  status: 'draft' | 'candidate' | 'canary' | 'active' | 'archived' | 'rolled_back';
  eval_score: number | null;
  source: string | null;
  rollback_reason: string | null;
  promoted_at: string | null;
  created_at: string;
}

type Tab = 'active' | 'canary' | 'pipeline' | 'history' | 'controls';

const STATUS_COLORS: Record<string, { text: string; bg: string }> = {
  draft:       { text: 'text-prism-tertiary', bg: 'bg-prism-bg2' },
  candidate:   { text: 'text-prism-violet',   bg: 'bg-prism-violet/10' },
  canary:      { text: 'text-prism-high',     bg: 'bg-prism-high/10' },
  active:      { text: 'text-prism-teal',     bg: 'bg-prism-fill-2/10' },
  archived:    { text: 'text-prism-tertiary', bg: 'bg-prism-bg2' },
  rolled_back: { text: 'text-prism-critical', bg: 'bg-prism-critical/10' },
};

const PIPELINE_STAGES = ['draft', 'candidate', 'canary', 'active'] as const;

/* ── Page ─────────────────────────────────── */

export default function PolicyVersions() {
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('active');

  /* Filters for history tab */
  const [historyType, setHistoryType] = useState('');
  const [historyStatus, setHistoryStatus] = useState('');
  const [historyPage, setHistoryPage] = useState(0);
  const PAGE_SIZE = 20;

  /* Manual control state */
  const [collecting, setCollecting] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [collectResult, setCollectResult] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall<PolicyVersion[]>('/api/policy_versions');
      setVersions(data ?? []);
    } catch {
      setVersions([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /* ── Derived data ──────────────────────── */

  const activePolicies = useMemo(
    () => versions.filter(v => v.status === 'active'),
    [versions],
  );

  const canaryPolicies = useMemo(
    () => versions.filter(v => v.status === 'canary'),
    [versions],
  );

  const pipelineCounts = useMemo(() => {
    const counts: Record<string, PolicyVersion[]> = { draft: [], candidate: [], canary: [], active: [] };
    for (const v of versions) {
      if (counts[v.status]) counts[v.status].push(v);
    }
    return counts;
  }, [versions]);

  const policyTypes = useMemo(
    () => [...new Set(versions.map(v => v.policy_type))].sort(),
    [versions],
  );

  const historyFiltered = useMemo(() => {
    let list = [...versions].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (historyType) list = list.filter(v => v.policy_type === historyType);
    if (historyStatus) list = list.filter(v => v.status === historyStatus);
    return list;
  }, [versions, historyType, historyStatus]);

  const historyPaged = historyFiltered.slice(historyPage * PAGE_SIZE, (historyPage + 1) * PAGE_SIZE);
  const historyTotalPages = Math.max(1, Math.ceil(historyFiltered.length / PAGE_SIZE));

  /* ── Manual controls ───────────────────── */

  const collectProposals = useCallback(async () => {
    setCollecting(true);
    setCollectResult(null);
    try {
      await fetch(`${SCHEDULER_URL}/policy/collect`, { method: 'POST' });
      setCollectResult('success');
      await refresh();
    } catch {
      setCollectResult('error');
    }
    setCollecting(false);
  }, [refresh]);

  const runEvaluation = useCallback(async () => {
    setEvaluating(true);
    setEvalResult(null);
    try {
      await fetch(`${SCHEDULER_URL}/policy/evaluate`, { method: 'POST' });
      setEvalResult('success');
      await refresh();
    } catch {
      setEvalResult('error');
    }
    setEvaluating(false);
  }, [refresh]);

  /* ── Render ────────────────────────────── */

  if (loading) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Policy Versions" subtitle="Learning Governor policy lifecycle management" />
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Policy Versions"
        subtitle="Learning Governor policy lifecycle management"
        action={
          <button
            onClick={refresh}
            className="rounded-lg border border-primary/30 bg-black/20 px-3 py-1.5 text-[13px] font-medium text-txt-muted backdrop-blur-[8px] transition-colors hover:border-primary/55 hover:bg-black/30 hover:text-txt-primary"
          >
            Refresh
          </button>
        }
      />

      <PageTabs<Tab>
        tabs={[
          { key: 'active', label: `Active (${activePolicies.length})` },
          { key: 'canary', label: `Canary (${canaryPolicies.length})` },
          { key: 'pipeline', label: 'Pipeline' },
          { key: 'history', label: `History (${versions.length})` },
          { key: 'controls', label: 'Controls' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'active' && <ActiveSection policies={activePolicies} />}
      {tab === 'canary' && <CanarySection policies={canaryPolicies} />}
      {tab === 'pipeline' && <PipelineSection counts={pipelineCounts} />}
      {tab === 'history' && (
        <HistorySection
          rows={historyPaged}
          page={historyPage}
          totalPages={historyTotalPages}
          onPage={setHistoryPage}
          policyTypes={policyTypes}
          typeFilter={historyType}
          statusFilter={historyStatus}
          onTypeFilter={setHistoryType}
          onStatusFilter={setHistoryStatus}
        />
      )}
      {tab === 'controls' && (
        <ControlsSection
          collecting={collecting}
          evaluating={evaluating}
          collectResult={collectResult}
          evalResult={evalResult}
          onCollect={collectProposals}
          onEvaluate={runEvaluation}
        />
      )}
    </div>
  );
}

/* ── StatusBadge ──────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_COLORS[status] ?? STATUS_COLORS.draft;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cfg.text} ${cfg.bg}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

/* ── 1. Active Policies ──────────────────── */

function ActiveSection({ policies }: { policies: PolicyVersion[] }) {
  if (policies.length === 0) {
    return <Card><p className="text-sm text-txt-muted">No active policies found.</p></Card>;
  }
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-txt-muted">
              <th className="pb-2 pr-4 font-medium">Type</th>
              <th className="pb-2 pr-4 font-medium">Agent</th>
              <th className="pb-2 pr-4 font-medium">Version</th>
              <th className="pb-2 pr-4 font-medium">Promoted At</th>
              <th className="pb-2 font-medium">Eval Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {policies.map(p => (
              <tr key={p.id} className="text-txt-secondary">
                <td className="py-2 pr-4 font-medium text-txt-primary">{p.policy_type}</td>
                <td className="py-2 pr-4">{p.agent_role}</td>
                <td className="py-2 pr-4">v{p.version}</td>
                <td className="py-2 pr-4">{p.promoted_at ? timeAgo(p.promoted_at) : '—'}</td>
                <td className="py-2">
                  {p.eval_score != null ? (
                    <span className={p.eval_score >= 0.7 ? 'text-prism-teal' : p.eval_score >= 0.4 ? 'text-prism-high' : 'text-prism-critical'}>
                      {(p.eval_score * 100).toFixed(0)}%
                    </span>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ── 2. Canary Watch ─────────────────────── */

function CanarySection({ policies }: { policies: PolicyVersion[] }) {
  if (policies.length === 0) {
    return <Card><p className="text-sm text-txt-muted">No policies currently in canary.</p></Card>;
  }
  return (
    <div className="space-y-4">
      {policies.map(p => {
        const canaryDuration = p.promoted_at
          ? timeAgo(p.promoted_at)
          : timeAgo(p.created_at);

        return (
          <Card key={p.id} className="border-l-4 border-l-prism-high">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <MdWarning className="h-4 w-4 text-prism-high" />
                  <span className="text-sm font-semibold text-txt-primary">{p.policy_type}</span>
                  <StatusBadge status={p.status} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-[13px] text-txt-muted">
                  <span>Agent: <span className="text-txt-secondary">{p.agent_role}</span></span>
                  <span>Version: <span className="text-txt-secondary">v{p.version}</span></span>
                  <span>In canary: <span className="text-txt-secondary">{canaryDuration}</span></span>
                  <span>
                    Eval score:{' '}
                    {p.eval_score != null ? (
                      <span className={p.eval_score >= 0.7 ? 'text-prism-teal' : 'text-prism-high'}>
                        {(p.eval_score * 100).toFixed(0)}%
                      </span>
                    ) : <span className="text-txt-secondary">—</span>}
                  </span>
                </div>
              </div>
              {/* Progress indicator */}
              <div className="flex flex-col items-end gap-1">
                <span className="text-[11px] text-txt-muted">Canary progress</span>
                <div className="h-2 w-24 overflow-hidden rounded-full bg-prism-bg2">
                  <div
                    className="h-full rounded-full bg-prism-high transition-all"
                    style={{ width: p.eval_score != null ? `${Math.min(p.eval_score * 100, 100)}%` : '0%' }}
                  />
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ── 3. Pipeline View ────────────────────── */

function PipelineSection({ counts }: { counts: Record<string, PolicyVersion[]> }) {
  return (
    <div className="grid grid-cols-4 gap-4">
      {PIPELINE_STAGES.map(stage => {
        const items = counts[stage] ?? [];
        const cfg = STATUS_COLORS[stage] ?? STATUS_COLORS.draft;
        return (
          <Card key={stage}>
            <div className="mb-3 flex items-center justify-between">
              <span className={`text-sm font-semibold capitalize ${cfg.text}`}>{stage}</span>
              <span className="rounded-full bg-prism-bg2 px-2 py-0.5 text-[11px] font-bold text-txt-muted">
                {items.length}
              </span>
            </div>
            <div className="space-y-2">
              {items.length === 0 && (
                <p className="text-[12px] text-txt-muted italic">No entries</p>
              )}
              {items.slice(0, 5).map(v => (
                <div key={v.id} className="rounded-lg border border-primary/20 bg-black/25 p-2 backdrop-blur-[8px]">
                  <p className="text-[12px] font-medium text-txt-primary truncate">{v.policy_type}</p>
                  <p className="text-[11px] text-txt-muted">{v.agent_role} · v{v.version}</p>
                </div>
              ))}
              {items.length > 5 && (
                <p className="text-[11px] text-txt-muted">+{items.length - 5} more</p>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ── 4. History ──────────────────────────── */

function HistorySection({
  rows, page, totalPages, onPage, policyTypes, typeFilter, statusFilter, onTypeFilter, onStatusFilter,
}: {
  rows: PolicyVersion[];
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  policyTypes: string[];
  typeFilter: string;
  statusFilter: string;
  onTypeFilter: (v: string) => void;
  onStatusFilter: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <MdFilterList className="h-4 w-4 text-txt-muted" />
        <select
          value={typeFilter}
          onChange={e => { onTypeFilter(e.target.value); onPage(0); }}
          className="rounded-lg border border-primary/30 bg-black/25 px-3 py-1.5 text-[13px] text-txt-secondary outline-none backdrop-blur-[8px]"
        >
          <option value="">All types</option>
          {policyTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => { onStatusFilter(e.target.value); onPage(0); }}
          className="rounded-lg border border-primary/30 bg-black/25 px-3 py-1.5 text-[13px] text-txt-secondary outline-none backdrop-blur-[8px]"
        >
          <option value="">All statuses</option>
          {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-txt-muted">
                <th className="pb-2 pr-4 font-medium">Type</th>
                <th className="pb-2 pr-4 font-medium">Agent</th>
                <th className="pb-2 pr-4 font-medium">Version</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 pr-4 font-medium">Eval Score</th>
                <th className="pb-2 pr-4 font-medium">Source</th>
                <th className="pb-2 pr-4 font-medium">Created</th>
                <th className="pb-2 font-medium">Rollback Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && (
                <tr><td colSpan={8} className="py-4 text-center text-txt-muted">No policy versions found.</td></tr>
              )}
              {rows.map(p => (
                <tr key={p.id} className="text-txt-secondary">
                  <td className="py-2 pr-4 font-medium text-txt-primary">{p.policy_type}</td>
                  <td className="py-2 pr-4">{p.agent_role}</td>
                  <td className="py-2 pr-4">v{p.version}</td>
                  <td className="py-2 pr-4"><StatusBadge status={p.status} /></td>
                  <td className="py-2 pr-4">
                    {p.eval_score != null ? (
                      <span className={p.eval_score >= 0.7 ? 'text-prism-teal' : p.eval_score >= 0.4 ? 'text-prism-high' : 'text-prism-critical'}>
                        {(p.eval_score * 100).toFixed(0)}%
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-2 pr-4">{p.source ?? '—'}</td>
                  <td className="py-2 pr-4">{timeAgo(p.created_at)}</td>
                  <td className="py-2 text-[12px]">{p.rollback_reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
            <span className="text-[12px] text-txt-muted">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => onPage(page - 1)}
                className="rounded border border-primary/30 bg-black/20 px-3 py-1 text-[12px] text-txt-muted transition-colors hover:border-primary/55 hover:bg-black/30 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => onPage(page + 1)}
                className="rounded border border-primary/30 bg-black/20 px-3 py-1 text-[12px] text-txt-muted transition-colors hover:border-primary/55 hover:bg-black/30 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── 5. Manual Controls ──────────────────── */

function ControlsSection({
  collecting, evaluating, collectResult, evalResult, onCollect, onEvaluate,
}: {
  collecting: boolean;
  evaluating: boolean;
  collectResult: string | null;
  evalResult: string | null;
  onCollect: () => void;
  onEvaluate: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <h3 className="text-sm font-semibold text-txt-primary mb-2">Collect Proposals</h3>
        <p className="text-[12px] text-txt-muted mb-4">
          Trigger the learning governor to collect policy proposals from all agents.
        </p>
        <button
          onClick={onCollect}
          disabled={collecting}
          className="flex items-center gap-2 rounded-lg bg-cyan/15 px-4 py-2 text-[13px] font-medium text-cyan transition-colors hover:bg-cyan/25 disabled:opacity-50"
        >
          <MdPlayArrow className="h-4 w-4" />
          {collecting ? 'Collecting…' : 'Collect Proposals Now'}
        </button>
        {collectResult && (
          <div className={`mt-3 flex items-center gap-1.5 text-[12px] ${collectResult === 'success' ? 'text-prism-teal' : 'text-prism-critical'}`}>
            {collectResult === 'success' ? <MdCheck className="h-4 w-4" /> : <MdWarning className="h-4 w-4" />}
            {collectResult === 'success' ? 'Proposals collected successfully.' : 'Failed to collect proposals.'}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-txt-primary mb-2">Run Evaluation</h3>
        <p className="text-[12px] text-txt-muted mb-4">
          Evaluate candidate policies against the current baseline and score them.
        </p>
        <button
          onClick={onEvaluate}
          disabled={evaluating}
          className="flex items-center gap-2 rounded-lg bg-cyan/15 px-4 py-2 text-[13px] font-medium text-cyan transition-colors hover:bg-cyan/25 disabled:opacity-50"
        >
          <MdScience className="h-4 w-4" />
          {evaluating ? 'Evaluating…' : 'Run Evaluation'}
        </button>
        {evalResult && (
          <div className={`mt-3 flex items-center gap-1.5 text-[12px] ${evalResult === 'success' ? 'text-prism-teal' : 'text-prism-critical'}`}>
            {evalResult === 'success' ? <MdCheck className="h-4 w-4" /> : <MdWarning className="h-4 w-4" />}
            {evalResult === 'success' ? 'Evaluation completed successfully.' : 'Failed to run evaluation.'}
          </div>
        )}
      </Card>
    </div>
  );
}
