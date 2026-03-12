import { useMemo } from 'react';
import { Card, SectionHeader, Skeleton } from '../ui';
import {
  AmendmentProposal,
  CollapsibleCard,
  ComplianceHeatmapCell,
  EmptyState,
  PolicyImpactItem,
  PolicyVersion,
  SeverityBadge,
  average,
  daysSince,
  formatDateTime,
  formatMetricValue,
  formatPercent,
  getDisplayName,
  normalizeSeverity,
  toHumanWords,
} from './shared';

interface PolicyLabProps {
  loading: boolean;
  policyImpact: PolicyImpactItem[];
  complianceHeatmap: ComplianceHeatmapCell[];
  amendments: AmendmentProposal[];
  policyVersions: PolicyVersion[];
  collecting: boolean;
  evaluating: boolean;
  collectResult: string | null;
  evalResult: string | null;
  onCollect: () => Promise<void>;
  onEvaluate: () => Promise<void>;
}

function PolicyEffectivenessDash({
  policyImpact,
  complianceHeatmap,
  amendments,
  policyVersions,
}: {
  policyImpact: PolicyImpactItem[];
  complianceHeatmap: ComplianceHeatmapCell[];
  amendments: AmendmentProposal[];
  policyVersions: PolicyVersion[];
}) {
  const activePolicies = policyVersions.filter((policy) => policy.status === 'active');
  const canaries = policyVersions.filter((policy) => policy.status === 'canary');
  const canaryPassRate = canaries.length
    ? canaries.filter((policy) => (policy.eval_score ?? 0) >= 0.7).length / canaries.length
    : null;
  const avgEval = average(policyImpact.map((policy) => policy.evalScore).filter((value): value is number => value != null));
  const complianceAvg = average(complianceHeatmap.map((cell) => cell.avgScore));
  const recentPolicies = policyVersions.filter((policy) => (daysSince(policy.created_at) ?? 999) <= 30);
  const rollbackRate = recentPolicies.length
    ? recentPolicies.filter((policy) => policy.status === 'rolled_back').length / recentPolicies.length
    : null;
  const pendingAmendments = amendments.filter((amendment) => amendment.status === 'proposed' || amendment.status === 'pending');

  const cards = [
    { label: 'Active Policies', value: activePolicies.length.toString(), tone: 'text-prism-teal' },
    { label: 'Canary Pass Rate', value: formatPercent(canaryPassRate, 0), tone: 'text-prism-sky' },
    { label: 'Avg Eval Score', value: avgEval == null ? '—' : avgEval.toFixed(2), tone: 'text-prism-elevated' },
    { label: 'Rollback Rate', value: formatPercent(rollbackRate, 0), tone: 'text-prism-critical' },
    { label: 'Amendments', value: pendingAmendments.length.toString(), tone: 'text-prism-high' },
    { label: 'Constitutional Compliance', value: formatPercent(complianceAvg, 0), tone: 'text-prism-teal' },
  ];

  return (
    <Card>
      <SectionHeader
        title="Policy Effectiveness"
        subtitle="Outcome-oriented roll-up for active controls, canary quality, and constitutional performance."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-primary/20 bg-black/25 backdrop-blur-[8px] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-txt-muted">{card.label}</p>
            <p className={`mt-3 text-3xl font-semibold ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PolicyImpactCards({ items }: { items: PolicyImpactItem[] }) {
  if (!items.length) {
    return (
      <EmptyState
        title="Policy impact cards waiting on backend correlation"
        description="The frontend is wired to /api/governance/policy-impact and will render before/after outcome deltas once the query is available."
      />
    );
  }

  return (
    <Card>
      <SectionHeader
        title="Policy Impact Cards"
        subtitle="Before-and-after outcomes per policy, rather than lifecycle state alone."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-primary/20 bg-black/25 backdrop-blur-[8px] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-txt-primary">{toHumanWords(item.policyType)}</p>
                <p className="mt-1 text-[12px] text-txt-muted">
                  {item.agentRole ? `${getDisplayName(item.agentRole)} · ` : 'Org-wide · '}
                  {item.status}
                </p>
              </div>
              <SeverityBadge severity={normalizeSeverity(item.status === 'rolled_back' ? 'critical' : item.evalScore != null && item.evalScore >= 0.8 ? 'good' : 'medium')} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-primary/15 bg-black/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">Before</p>
                <p className="mt-2 text-lg font-semibold text-txt-primary">{formatMetricValue(item.beforeValue)}</p>
              </div>
              <div className="rounded-lg border border-primary/15 bg-black/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">After</p>
                <p className="mt-2 text-lg font-semibold text-txt-primary">{formatMetricValue(item.afterValue)}</p>
              </div>
              <div className="rounded-lg border border-primary/15 bg-black/20 px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.18em] text-txt-muted">Delta</p>
                <p className={`mt-2 text-lg font-semibold ${(item.deltaPct ?? 0) <= 0 ? 'text-prism-teal' : 'text-prism-critical'}`}>
                  {item.deltaPct == null ? '—' : `${item.deltaPct > 0 ? '+' : ''}${item.deltaPct.toFixed(0)}%`}
                </p>
              </div>
            </div>
            <p className="mt-3 text-[13px] text-txt-secondary">
              {item.impactSummary ?? `${item.metricLabel ?? 'Outcome'} changed from ${formatMetricValue(item.beforeValue)} to ${formatMetricValue(item.afterValue)}.`}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-txt-muted">
              <span>{item.metricLabel ?? 'Metric not yet labeled'}</span>
              <span>{formatDateTime(item.promotedAt ?? item.createdAt)}</span>
              {item.evalScore != null && <span>Eval {item.evalScore.toFixed(2)}</span>}
            </div>
            {item.rollbackReason && (
              <p className="mt-2 text-[12px] text-prism-critical">Rollback reason: {item.rollbackReason}</p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ComplianceHeatmap({ items }: { items: ComplianceHeatmapCell[] }) {
  if (!items.length) {
    return (
      <EmptyState
        title="Constitutional heatmap pending"
        description="The grid is wired to /api/governance/compliance-heatmap and will render by department × principle when data becomes available."
      />
    );
  }

  const principles = [...new Set(items.map((item) => item.principle))].sort();
  const departments = [...new Set(items.map((item) => item.department))].sort();
  const lookup = new Map(items.map((item) => [`${item.department}::${item.principle}`, item.avgScore]));

  const cellTone = (score: number | undefined) => {
    if (score == null) return 'bg-prism-card text-txt-muted';
    if (score >= 0.85) return 'bg-prism-teal/15 text-prism-teal';
    if (score >= 0.7) return 'bg-prism-elevated/15 text-prism-elevated';
    return 'bg-prism-critical/15 text-prism-critical';
  };

  return (
    <Card>
      <SectionHeader
        title="Constitutional Compliance Heatmap"
        subtitle="Department × principle matrix of recent constitutional adherence scores."
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-primary/20 text-txt-muted">
              <th className="pb-2 pr-3 font-medium">Department</th>
              {principles.map((principle) => (
                <th key={principle} className="pb-2 pr-3 font-medium">{toHumanWords(principle)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {departments.map((department) => (
              <tr key={department} className="border-b border-primary/15">
                <td className="py-2 pr-3 font-medium text-txt-primary">{department}</td>
                {principles.map((principle) => {
                  const score = lookup.get(`${department}::${principle}`);
                  return (
                    <td key={`${department}-${principle}`} className="py-2 pr-3">
                      <span className={`inline-flex min-w-[72px] justify-center rounded-lg px-2.5 py-1 ${cellTone(score)}`}>
                        {score == null ? '—' : formatPercent(score, 0)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AmendmentProposals({ items }: { items: AmendmentProposal[] }) {
  if (!items.length) {
    return (
      <EmptyState
        title="No pending constitutional amendments"
        description="Proposed constitutional amendments from /api/governance/amendments will appear here when agents submit them."
      />
    );
  }

  return (
    <Card>
      <SectionHeader
        title="Amendment Proposals"
        subtitle="Pending constitutional changes proposed by agents, with rationale and failure context."
      />
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-primary/20 bg-black/25 backdrop-blur-[8px] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-txt-primary">{getDisplayName(item.agentRole)} proposes to {item.action}</p>
                <p className="mt-2 text-[13px] text-txt-secondary">{item.principleText}</p>
                {item.rationale && <p className="mt-2 text-[12px] text-txt-muted">{item.rationale}</p>}
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-txt-muted">
                  <span>{formatDateTime(item.createdAt)}</span>
                  {item.failedEvalCount != null && <span>{item.failedEvalCount} failed evaluations in context</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {['Approve', 'Reject', 'Modify'].map((label) => (
                  <button
                    key={label}
                    type="button"
                    disabled
                    title="Backend action endpoints are shipping alongside the governance contract."
                    className="rounded-lg border border-primary/20 bg-black/20 px-3 py-1.5 text-[12px] font-medium text-txt-muted disabled:cursor-not-allowed"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PolicyPipeline({ versions }: { versions: PolicyVersion[] }) {
  const stages: Array<PolicyVersion['status']> = ['draft', 'candidate', 'canary', 'active'];
  const grouped = stages.map((stage) => ({
    stage,
    items: versions.filter((version) => version.status === stage).sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
  }));

  return (
    <Card>
      <SectionHeader
        title="Policy Pipeline"
        subtitle="Compact strip view of draft → candidate → canary → active, replacing the old monolithic policy tabs."
      />
      <div className="grid gap-4 xl:grid-cols-4">
        {grouped.map((group) => (
          <div key={group.stage} className="rounded-xl border border-primary/20 bg-black/25 backdrop-blur-[8px] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-txt-muted">{group.stage}</p>
              <span className="text-[12px] text-txt-secondary">{group.items.length}</span>
            </div>
            <div className="mt-3 space-y-3">
              {group.items.length === 0 && <p className="text-[12px] text-txt-muted">No policies in this stage.</p>}
              {group.items.slice(0, 6).map((item) => (
                <div key={item.id} className="rounded-lg border border-primary/15 bg-black/20 px-3 py-3">
                  <p className="text-[13px] font-medium text-txt-primary">{toHumanWords(item.policy_type)}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-txt-muted">
                    <span>v{item.version}</span>
                    {item.eval_score != null && <span>Eval {item.eval_score.toFixed(2)}</span>}
                    <span>{item.promoted_at ? formatDateTime(item.promoted_at) : formatDateTime(item.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ManualControls({
  versions,
  collecting,
  evaluating,
  collectResult,
  evalResult,
  onCollect,
  onEvaluate,
}: {
  versions: PolicyVersion[];
  collecting: boolean;
  evaluating: boolean;
  collectResult: string | null;
  evalResult: string | null;
  onCollect: () => Promise<void>;
  onEvaluate: () => Promise<void>;
}) {
  const lastCollected = [...versions]
    .filter((version) => version.status === 'draft' || version.status === 'candidate')
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0]?.created_at ?? null;
  const lastEvaluated = [...versions]
    .filter((version) => version.eval_score != null || version.promoted_at != null)
    .sort((left, right) => new Date((right.promoted_at ?? right.created_at)).getTime() - new Date((left.promoted_at ?? left.created_at)).getTime())[0];

  return (
    <CollapsibleCard
      title="Manual Controls"
      subtitle="Automation remains available, but the controls are tucked away beneath the decision surfaces."
      defaultOpen={false}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-primary/20 bg-black/25 backdrop-blur-[8px] p-4">
          <p className="text-sm font-semibold text-txt-primary">Collect Proposals</p>
          <p className="mt-2 text-[12px] text-txt-muted">
            Last run {formatDateTime(lastCollected)} · {versions.filter((version) => version.status === 'draft' || version.status === 'candidate').length} proposals ready
          </p>
          {collectResult && (
            <p className={`mt-2 text-[12px] ${collectResult === 'success' ? 'text-prism-teal' : 'text-prism-critical'}`}>
              {collectResult === 'success' ? 'Collection completed successfully.' : 'Collection failed — inspect scheduler logs.'}
            </p>
          )}
          <button
            type="button"
            disabled={collecting}
            onClick={onCollect}
            className="mt-4 rounded-lg bg-prism-sky/15 px-4 py-2 text-[13px] font-medium text-prism-sky transition-colors hover:bg-prism-sky/25 disabled:opacity-50"
          >
            {collecting ? 'Collecting…' : 'Collect Proposals'}
          </button>
        </div>

        <div className="rounded-xl border border-primary/20 bg-black/25 backdrop-blur-[8px] p-4">
          <p className="text-sm font-semibold text-txt-primary">Run Evaluation</p>
          <p className="mt-2 text-[12px] text-txt-muted">
            Last run {formatDateTime(lastEvaluated?.promoted_at ?? lastEvaluated?.created_at ?? null)} · {versions.filter((version) => version.eval_score != null).length} evaluated policies
          </p>
          {evalResult && (
            <p className={`mt-2 text-[12px] ${evalResult === 'success' ? 'text-prism-teal' : 'text-prism-critical'}`}>
              {evalResult === 'success' ? 'Evaluation completed successfully.' : 'Evaluation failed — inspect scheduler logs.'}
            </p>
          )}
          <button
            type="button"
            disabled={evaluating}
            onClick={onEvaluate}
            className="mt-4 rounded-lg bg-prism-elevated/15 px-4 py-2 text-[13px] font-medium text-prism-elevated transition-colors hover:bg-prism-elevated/25 disabled:opacity-50"
          >
            {evaluating ? 'Evaluating…' : 'Run Evaluation'}
          </button>
        </div>
      </div>
    </CollapsibleCard>
  );
}

export default function PolicyLab({
  loading,
  policyImpact,
  complianceHeatmap,
  amendments,
  policyVersions,
  collecting,
  evaluating,
  collectResult,
  evalResult,
  onCollect,
  onEvaluate,
}: PolicyLabProps) {
  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full" />
        <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PolicyEffectivenessDash
        policyImpact={policyImpact}
        complianceHeatmap={complianceHeatmap}
        amendments={amendments}
        policyVersions={policyVersions}
      />
      <div className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <PolicyImpactCards items={policyImpact} />
        <AmendmentProposals items={amendments} />
      </div>
      <ComplianceHeatmap items={complianceHeatmap} />
      <PolicyPipeline versions={policyVersions} />
      <ManualControls
        versions={policyVersions}
        collecting={collecting}
        evaluating={evaluating}
        collectResult={collectResult}
        evalResult={evalResult}
        onCollect={onCollect}
        onEvaluate={onEvaluate}
      />
    </div>
  );
}
