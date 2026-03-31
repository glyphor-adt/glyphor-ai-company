import { useEffect, useMemo, useState } from 'react';
import { ButtonOutlineSecondary, Card, GradientButton, SectionHeader, Skeleton } from '../ui';
import type { Agent } from '../../lib/types';
import {
  AgentCapacityConfig,
  CommitmentRegistryEntry,
  EmptyState,
  SeverityBadge,
  formatDateTime,
  getDisplayName,
  toHumanWords,
} from './shared';

type CapacityTier = AgentCapacityConfig['capacityTier'];

interface AuthorityControlProps {
  loading: boolean;
  agents: Agent[];
  selectedAgentId: string;
  capacityConfig: AgentCapacityConfig | null;
  pendingCommitments: CommitmentRegistryEntry[];
  pendingCommitmentTotal: number;
  agentCommitments: CommitmentRegistryEntry[];
  agentCommitmentTotal: number;
  isAdmin: boolean;
  savingCapacity: boolean;
  busyCommitmentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onSaveCapacity: (input: {
    capacityTier: CapacityTier;
    requiresHumanApprovalFor: string[];
    overrideByRoles: string[];
  }) => Promise<void>;
  onApproveCommitment: (id: string) => Promise<void>;
  onRejectCommitment: (id: string, reason: string) => Promise<void>;
  onReverseCommitment: (id: string, reason: string) => Promise<void>;
}

function splitListInput(value: string): string[] {
  return Array.from(new Set(value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean)));
}

function listToMultiline(value: string[]): string {
  return value.join('\n');
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString() : '—';
  if (typeof value === 'string') return value || '—';
  return '—';
}

function commitmentSeverity(status: CommitmentRegistryEntry['status']) {
  if (status === 'pending_approval') return 'warning';
  if (status === 'approved') return 'good';
  if (status === 'executed') return 'info';
  if (status === 'reversed') return 'medium';
  return 'high';
}

function CommitmentRow({
  commitment,
  reason,
  isAdmin,
  busy,
  allowApprove,
  allowReverse,
  onReasonChange,
  onApprove,
  onReject,
  onReverse,
}: {
  commitment: CommitmentRegistryEntry;
  reason: string;
  isAdmin: boolean;
  busy: boolean;
  allowApprove: boolean;
  allowReverse: boolean;
  onReasonChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onReverse: () => void;
}) {
  return (
    <div className="rounded-xl theme-glass-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={commitmentSeverity(commitment.status)} />
            <p className="text-sm font-semibold text-txt-primary">{commitment.actionDescription}</p>
          </div>
          <p className="mt-2 text-[12px] text-txt-muted">
            {getDisplayName(commitment.agentId)} · {toHumanWords(commitment.actionType)} · {toHumanWords(commitment.toolCalled)}
          </p>
          <div className="mt-3 grid gap-2 text-[12px] text-txt-secondary md:grid-cols-2">
            <p>Counterparty: <span className="text-txt-primary">{commitment.externalCounterparty ?? '—'}</span></p>
            <p>Value: <span className="text-txt-primary">{commitment.commitmentValue ?? '—'}</span></p>
            <p>Created: <span className="text-txt-primary">{formatDateTime(commitment.createdAt)}</span></p>
            <p>Approved By: <span className="text-txt-primary">{commitment.approvedByHumanId ?? (commitment.autoApproved ? 'Auto-approved' : '—')}</span></p>
            <p>Approved At: <span className="text-txt-primary">{formatDateTime(commitment.approvedAt)}</span></p>
            <p>Executed At: <span className="text-txt-primary">{formatDateTime(commitment.executedAt)}</span></p>
          </div>
        </div>
        {commitment.autoApproved && (
          <span className="badge badge-teal">Auto</span>
        )}
      </div>

      {isAdmin && (allowApprove || allowReverse) && (
        <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
          {(commitment.status === 'pending_approval' || allowReverse) && (
            <textarea
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              rows={2}
              placeholder={allowApprove ? 'Reason required for rejection' : 'Reason required for reversal'}
              className="w-full rounded-xl border border-border bg-transparent px-3 py-2 text-[12px] text-txt-primary outline-none transition-colors focus:border-prism-sky/50"
            />
          )}
          <div className="flex flex-wrap gap-2">
            {allowApprove && (
              <GradientButton onClick={onApprove} disabled={busy} variant="approve" size="sm" className="disabled:opacity-50">
                {busy ? 'Working…' : 'Approve'}
              </GradientButton>
            )}
            {allowApprove && (
              <ButtonOutlineSecondary onClick={onReject} disabled={busy || reason.trim().length === 0} size="sm" className="disabled:opacity-50">
                Reject
              </ButtonOutlineSecondary>
            )}
            {allowReverse && (
              <ButtonOutlineSecondary onClick={onReverse} disabled={busy || reason.trim().length === 0} size="sm" className="disabled:opacity-50">
                Reverse
              </ButtonOutlineSecondary>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AuthorityControl({
  loading,
  agents,
  selectedAgentId,
  capacityConfig,
  pendingCommitments,
  pendingCommitmentTotal,
  agentCommitments,
  agentCommitmentTotal,
  isAdmin,
  savingCapacity,
  busyCommitmentId,
  onSelectAgent,
  onSaveCapacity,
  onApproveCommitment,
  onRejectCommitment,
  onReverseCommitment,
}: AuthorityControlProps) {
  const [capacityTier, setCapacityTier] = useState<CapacityTier>('execute');
  const [requiresApprovalText, setRequiresApprovalText] = useState('');
  const [overrideRolesText, setOverrideRolesText] = useState('');
  const [actionReasons, setActionReasons] = useState<Record<string, string>>({});

  const sortedAgents = useMemo(
    () => [...agents].sort((left, right) => {
      const leftName = left.display_name || left.name || getDisplayName(left.role);
      const rightName = right.display_name || right.name || getDisplayName(right.role);
      return leftName.localeCompare(rightName);
    }),
    [agents],
  );

  const selectedAgent = useMemo(
    () => sortedAgents.find((agent) => agent.role === selectedAgentId || agent.id === selectedAgentId) ?? null,
    [selectedAgentId, sortedAgents],
  );

  useEffect(() => {
    if (!capacityConfig) return;
    setCapacityTier(capacityConfig.capacityTier);
    setRequiresApprovalText(listToMultiline(capacityConfig.requiresHumanApprovalFor));
    setOverrideRolesText(listToMultiline(capacityConfig.overrideByRoles));
  }, [capacityConfig]);

  if (!sortedAgents.length) {
    return (
      <EmptyState
        title="No agents available for authority management"
        description="The authority surface needs at least one company agent record before capacity policies can be edited."
      />
    );
  }

  const selectedMetadata = capacityConfig?.metadata ?? {};

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Card>
          <SectionHeader
            title="Authority Profile"
            subtitle="Set the legal operating tier for each agent and define which action families still require human sign-off."
          />

          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-[12px] text-txt-muted">
              <span className="mb-2 block font-medium text-txt-secondary">Agent</span>
              <select
                value={selectedAgentId}
                onChange={(event) => onSelectAgent(event.target.value)}
                className="w-full rounded-xl border border-border bg-transparent px-3 py-2 text-[13px] text-txt-primary outline-none transition-colors focus:border-prism-sky/50"
              >
                {sortedAgents.map((agent) => {
                  const agentKey = agent.role || agent.id;
                  const agentName = agent.display_name || agent.name || getDisplayName(agent.role);
                  return (
                    <option key={agentKey} value={agentKey}>
                      {agentName}
                    </option>
                  );
                })}
              </select>
            </label>

            <div className="rounded-xl theme-glass-panel p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-txt-muted">Selected Agent</p>
              <p className="mt-2 text-lg font-semibold text-txt-primary">
                {selectedAgent?.display_name || selectedAgent?.name || getDisplayName(selectedAgent?.role)}
              </p>
              <p className="mt-1 text-[12px] text-txt-muted">
                {selectedAgent?.title ?? 'No title'} · {selectedAgent?.department ?? 'No department'}
              </p>
              <p className="mt-1 text-[12px] text-txt-muted">Role key: {selectedAgent?.role ?? selectedAgentId}</p>
            </div>
          </div>

          {loading ? (
            <div className="mt-5 space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : !capacityConfig ? (
            <div className="mt-5">
              <EmptyState
                title="No capacity config returned"
                description="The scheduler did not return a capacity policy for the selected agent."
              />
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <label className="block text-[12px] text-txt-muted">
                <span className="mb-2 block font-medium text-txt-secondary">Capacity Tier</span>
                <select
                  value={capacityTier}
                  onChange={(event) => setCapacityTier(event.target.value as CapacityTier)}
                  disabled={!isAdmin || savingCapacity}
                  className="w-full rounded-xl border border-border bg-transparent px-3 py-2 text-[13px] text-txt-primary outline-none transition-colors focus:border-prism-sky/50 disabled:opacity-60"
                >
                  <option value="observe">Observe</option>
                  <option value="draft">Draft</option>
                  <option value="execute">Execute</option>
                  <option value="commit">Commit</option>
                </select>
              </label>

              <label className="block text-[12px] text-txt-muted">
                <span className="mb-2 block font-medium text-txt-secondary">Requires Human Approval For</span>
                <textarea
                  value={requiresApprovalText}
                  onChange={(event) => setRequiresApprovalText(event.target.value)}
                  rows={5}
                  disabled={!isAdmin || savingCapacity}
                  placeholder="One action per line, for example: production_deploy"
                  className="w-full rounded-xl border border-border bg-transparent px-3 py-2 text-[13px] text-txt-primary outline-none transition-colors focus:border-prism-sky/50 disabled:opacity-60"
                />
              </label>

              <label className="block text-[12px] text-txt-muted">
                <span className="mb-2 block font-medium text-txt-secondary">Override By Roles</span>
                <textarea
                  value={overrideRolesText}
                  onChange={(event) => setOverrideRolesText(event.target.value)}
                  rows={4}
                  disabled={!isAdmin || savingCapacity}
                  placeholder="One role key per line, for example: founder"
                  className="w-full rounded-xl border border-border bg-transparent px-3 py-2 text-[13px] text-txt-primary outline-none transition-colors focus:border-prism-sky/50 disabled:opacity-60"
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl theme-glass-panel p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-txt-muted">Role Category</p>
                  <p className="mt-2 text-sm font-semibold text-txt-primary">{formatMetadataValue(selectedMetadata.role_category)}</p>
                </div>
                <div className="rounded-xl theme-glass-panel p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-txt-muted">Spend Threshold</p>
                  <p className="mt-2 text-sm font-semibold text-txt-primary">{formatMetadataValue(selectedMetadata.commit_value_threshold)}</p>
                </div>
                <div className="rounded-xl theme-glass-panel p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-txt-muted">Dual Approval</p>
                  <p className="mt-2 text-sm font-semibold text-txt-primary">{formatMetadataValue(selectedMetadata.commit_requires_dual_approval)}</p>
                </div>
                <div className="rounded-xl theme-glass-panel p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-txt-muted">Updated</p>
                  <p className="mt-2 text-sm font-semibold text-txt-primary">{formatDateTime(capacityConfig.updatedAt)}</p>
                  <p className="mt-1 text-[11px] text-txt-muted">by {capacityConfig.updatedBy}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <GradientButton
                  onClick={() => onSaveCapacity({
                    capacityTier,
                    requiresHumanApprovalFor: splitListInput(requiresApprovalText),
                    overrideByRoles: splitListInput(overrideRolesText),
                  })}
                  disabled={!isAdmin || savingCapacity}
                  size="md"
                  className="disabled:opacity-50"
                >
                  {savingCapacity ? 'Saving…' : 'Save Capacity Policy'}
                </GradientButton>
                <ButtonOutlineSecondary
                  onClick={() => {
                    setCapacityTier(capacityConfig.capacityTier);
                    setRequiresApprovalText(listToMultiline(capacityConfig.requiresHumanApprovalFor));
                    setOverrideRolesText(listToMultiline(capacityConfig.overrideByRoles));
                  }}
                  disabled={savingCapacity}
                >
                  Reset
                </ButtonOutlineSecondary>
              </div>
              {!isAdmin && (
                <p className="text-[12px] text-txt-muted">This surface is read-only for non-admin users.</p>
              )}
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader
            title="Commitment Pressure"
            subtitle="Global pending approvals and the recent commitment history for the selected agent."
          />
          <div className="space-y-4">
            <div className="rounded-xl theme-glass-panel p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-txt-muted">Pending Approvals</p>
              <p className="mt-2 text-3xl font-semibold text-txt-primary">{pendingCommitmentTotal}</p>
              <p className="mt-1 text-[12px] text-txt-muted">Awaiting explicit human approval before execution.</p>
            </div>
            <div className="rounded-xl theme-glass-panel p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-txt-muted">Selected Agent History</p>
              <p className="mt-2 text-3xl font-semibold text-txt-primary">{agentCommitmentTotal}</p>
              <p className="mt-1 text-[12px] text-txt-muted">Most recent registry entries for {selectedAgent?.display_name || selectedAgent?.name || getDisplayName(selectedAgent?.role)}.</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <SectionHeader
            title="Pending Commitments"
            subtitle="Approve or reject binding actions before they clear the execution gate."
          />
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : pendingCommitments.length === 0 ? (
            <EmptyState
              title="No commitments waiting on approval"
              description="The registry is clear right now. New binding actions will appear here automatically."
            />
          ) : (
            <div className="space-y-3">
              {pendingCommitments.map((commitment) => (
                <CommitmentRow
                  key={commitment.id}
                  commitment={commitment}
                  reason={actionReasons[commitment.id] ?? ''}
                  isAdmin={isAdmin}
                  busy={busyCommitmentId === commitment.id}
                  allowApprove={commitment.status === 'pending_approval'}
                  allowReverse={false}
                  onReasonChange={(value) => setActionReasons((current) => ({ ...current, [commitment.id]: value }))}
                  onApprove={() => onApproveCommitment(commitment.id)}
                  onReject={() => onRejectCommitment(commitment.id, actionReasons[commitment.id] ?? '')}
                  onReverse={() => undefined}
                />
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader
            title="Selected Agent Registry"
            subtitle="Recent commitment lifecycle entries for the selected agent, including reversals for executed work."
          />
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : agentCommitments.length === 0 ? (
            <EmptyState
              title="No commitments recorded yet"
              description="Once this agent attempts a binding external action, its registry history will appear here."
            />
          ) : (
            <div className="space-y-3">
              {agentCommitments.map((commitment) => {
                const allowReverse = commitment.status === 'approved' || commitment.status === 'executed';
                return (
                  <CommitmentRow
                    key={commitment.id}
                    commitment={commitment}
                    reason={actionReasons[commitment.id] ?? ''}
                    isAdmin={isAdmin}
                    busy={busyCommitmentId === commitment.id}
                    allowApprove={false}
                    allowReverse={allowReverse}
                    onReasonChange={(value) => setActionReasons((current) => ({ ...current, [commitment.id]: value }))}
                    onApprove={() => undefined}
                    onReject={() => undefined}
                    onReverse={() => onReverseCommitment(commitment.id, actionReasons[commitment.id] ?? '')}
                  />
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}