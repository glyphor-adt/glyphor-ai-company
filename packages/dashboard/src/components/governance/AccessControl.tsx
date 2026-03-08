import { useMemo, useState } from 'react';
import { Card, SectionHeader, Skeleton } from '../ui';
import {
  AccessPostureResponse,
  AGENT_ROLES,
  CollapsibleCard,
  EmptyState,
  GovernanceAction,
  IAMState,
  LeastPrivilegeGrant,
  PendingApproval,
  SecretRotation,
  SeverityBadge,
  ToolGrant,
  average,
  daysSince,
  daysUntil,
  formatDateTime,
  formatPercent,
  getAgentsByDepartment,
  getDisplayName,
  getPlatformLabel,
  getRoleTitle,
  normalizeSeverity,
  toHumanWords,
} from './shared';

interface AccessControlProps {
  loading: boolean;
  accessPosture: AccessPostureResponse | null;
  actionQueue: GovernanceAction[];
  leastPrivilege: LeastPrivilegeGrant[];
  iamState: IAMState[];
  secrets: SecretRotation[];
  grants: ToolGrant[];
  pendingApprovals: PendingApproval[];
  isAdmin: boolean;
  currentUserEmail: string | null;
  busyDecisionId?: string | null;
  onGrant: (input: { agentRole: string; toolName: string; reason: string; expiresAt: string | null }) => Promise<void>;
  onRevoke: (grant: ToolGrant) => Promise<void>;
  onResolveApproval: (id: string, approve: boolean) => Promise<void>;
}

function includesWriteAccess(value: Record<string, unknown> | null | undefined): boolean {
  const text = JSON.stringify(value ?? {}).toLowerCase();
  return /(write|admin|owner|developer|maintain|full|secretmanager|billing)/.test(text);
}

function classifyIamSeverity(item: IAMState) {
  if (item.in_sync) return 'good';
  if (includesWriteAccess(item.permissions) || includesWriteAccess(item.desired_permissions)) return 'high';
  return 'low';
}

function isAccessIssue(item: GovernanceAction): boolean {
  return /(access|grant|secret|iam|credential|least_privilege|least-privilege)/i.test(item.type);
}

function AccessPostureScore({ posture }: { posture: AccessPostureResponse | null }) {
  if (!posture) {
    return (
      <EmptyState
        title="Access posture is waiting on /api/governance/access-posture"
        description="The layout is ready for the composite score, trend, and breakdown bars defined in the overhaul contract."
      />
    );
  }

  return (
    <Card>
      <SectionHeader
        title="Access Posture Score"
        subtitle={posture.summary ?? 'Composite health across IAM sync, secret hygiene, grant freshness, and least-privilege fit.'}
      />
      <div className="grid gap-6 lg:grid-cols-[260px,1fr]">
        <div className="rounded-2xl border border-border/70 bg-prism-card/70 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-txt-muted">Posture</p>
          <p className="mt-3 text-5xl font-semibold text-txt-primary">{posture.score == null ? '—' : Math.round(posture.score)}</p>
          <p className="mt-2 text-[12px] text-txt-muted">Trend {posture.trend == null ? '—' : formatPercent(posture.trend, 0)}</p>
        </div>
        <div className="space-y-4">
          {posture.breakdown.map((item) => (
            <div key={item.key}>
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="font-medium text-txt-primary">{item.label}</span>
                <span className="text-txt-muted">{formatPercent(item.score, 0)}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-prism-card">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-prism-sky via-prism-teal to-prism-fill-2"
                  style={{ width: `${Math.max(6, Math.min(100, (Math.abs(item.score) <= 1 ? item.score * 100 : item.score)))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function RiskRankedIssues({ items }: { items: GovernanceAction[] }) {
  if (!items.length) {
    return (
      <EmptyState
        title="No access risks returned"
        description="Risk-ranked access issues will appear here once the unified action queue starts returning IAM, grant, and secret lifecycle findings."
      />
    );
  }

  return (
    <Card>
      <SectionHeader
        title="Risk-Ranked Access Issues"
        subtitle="A prioritized view instead of raw IAM inventories. This surface is filtered directly from the governance action queue."
      />
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-xl border border-border/70 bg-prism-card/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={item.severity} />
                  <p className="text-sm font-semibold text-txt-primary">{item.title}</p>
                </div>
                <p className="mt-2 text-[13px] text-txt-secondary">{item.summary}</p>
              </div>
              <span className="text-[11px] text-txt-muted">{formatDateTime(item.createdAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function LeastPrivilegeMatrix({ items }: { items: LeastPrivilegeGrant[] }) {
  const grouped = useMemo(() => {
    const byDept = new Map<string, LeastPrivilegeGrant[]>();
    for (const item of items) {
      const list = byDept.get(item.department) ?? [];
      list.push(item);
      byDept.set(item.department, list);
    }
    return [...byDept.entries()];
  }, [items]);

  if (!items.length) {
    return (
      <EmptyState
        title="Least-privilege analysis pending"
        description="This matrix is wired to /api/governance/least-privilege and will highlight stale grants as soon as the backend query is available."
      />
    );
  }

  return (
    <Card>
      <SectionHeader
        title="Least Privilege Analysis"
        subtitle="Department-grouped grants with little or no usage in the last 30 days."
      />
      <div className="space-y-4">
        {grouped.map(([department, grants]) => (
          <div key={department} className="rounded-xl border border-border/70 bg-prism-card/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-txt-primary">{department}</p>
                <p className="mt-1 text-[12px] text-txt-muted">{grants.length} potential revocation candidate{grants.length === 1 ? '' : 's'}</p>
              </div>
              <span className="text-[12px] text-txt-muted">{formatPercent(average(grants.map((grant) => grant.usesLast30d > 0 ? 1 : 0)), 0)} active usage</span>
            </div>
            <div className="mt-3 space-y-3">
              {grants.map((grant) => {
                const tone = grant.usesLast30d === 0
                  ? 'border-prism-critical/25 bg-prism-critical/8 text-prism-critical'
                  : grant.usesLast30d < 3
                    ? 'border-prism-elevated/25 bg-prism-elevated/8 text-prism-elevated'
                    : 'border-prism-teal/25 bg-prism-teal/8 text-prism-teal';
                return (
                  <div key={grant.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-surface px-3 py-2">
                    <div>
                      <p className="text-[13px] font-medium text-txt-primary">{getDisplayName(grant.agentRole)}</p>
                      <p className="mt-1 text-[11px] text-txt-muted">{grant.agentRole}</p>
                    </div>
                    <div className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${tone}`}>
                      {toHumanWords(grant.toolName)} · {grant.usesLast30d} uses / 30d
                    </div>
                    <p className="text-[12px] text-txt-muted">
                      {grant.daysSinceUse == null ? 'No recent usage' : `${grant.daysSinceUse} days since use`}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function IAMDrillDown({ items }: { items: IAMState[] }) {
  const [materialOnly, setMaterialOnly] = useState(true);
  const grouped = useMemo(() => {
    const byPlatform = new Map<string, IAMState[]>();
    for (const item of items) {
      const list = byPlatform.get(item.platform) ?? [];
      list.push(item);
      byPlatform.set(item.platform, list);
    }
    return [...byPlatform.entries()];
  }, [items]);

  return (
    <CollapsibleCard
      title="IAM Detail"
      subtitle="Collapsed by default so the surface stays founder-first while retaining drill-down capability."
      defaultOpen={false}
      action={
        <label className="flex items-center gap-2 text-[12px] text-txt-muted">
          <input
            type="checkbox"
            checked={materialOnly}
            onChange={(event) => setMaterialOnly(event.target.checked)}
            className="rounded border-border bg-surface"
          />
          Show only material drift
        </label>
      }
    >
      <div className="space-y-5">
        {grouped.map(([platform, platformItems]) => {
          const rows = platformItems.filter((item) => !materialOnly || classifyIamSeverity(item) !== 'low' || !item.in_sync);
          const lastAudit = [...platformItems]
            .map((item) => item.last_synced)
            .filter((value): value is string => Boolean(value))
            .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;

          return (
            <div key={platform}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-txt-primary">{getPlatformLabel(platform)}</p>
                  <p className="mt-1 text-[12px] text-txt-muted">Last audit {formatDateTime(lastAudit)}</p>
                </div>
                <p className="text-[12px] text-txt-muted">{rows.length} visible identity entries</p>
              </div>
              <div className="mt-3 overflow-x-auto rounded-xl border border-border/70">
                <table className="w-full min-w-[720px] text-left text-[12px]">
                  <thead className="bg-prism-card/70 text-txt-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Credential</th>
                      <th className="px-3 py-2 font-medium">Agent</th>
                      <th className="px-3 py-2 font-medium">Severity</th>
                      <th className="px-3 py-2 font-medium">Days drifted</th>
                      <th className="px-3 py-2 font-medium">Last audit</th>
                      <th className="px-3 py-2 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => {
                      const severity = classifyIamSeverity(item);
                      return (
                        <tr key={item.id} className="border-t border-border/60">
                          <td className="px-3 py-2 text-txt-primary">{item.credential_id}</td>
                          <td className="px-3 py-2 text-txt-secondary">{getDisplayName(item.agent_role)}</td>
                          <td className="px-3 py-2"><SeverityBadge severity={normalizeSeverity(severity)} /></td>
                          <td className="px-3 py-2 text-txt-secondary">
                            {item.in_sync ? '—' : (daysSince(item.last_synced) ?? '—')}
                          </td>
                          <td className="px-3 py-2 text-txt-muted">{formatDateTime(item.last_synced)}</td>
                          <td className="px-3 py-2 text-txt-muted">{item.drift_details ?? (item.in_sync ? 'In sync' : 'Permissions drift detected')}</td>
                        </tr>
                      );
                    })}
                    {!rows.length && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-txt-muted">
                          No IAM drift items match the current filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleCard>
  );
}

function SecretLifecycleTimeline({ items }: { items: SecretRotation[] }) {
  if (!items.length) {
    return (
      <EmptyState
        title="Secret lifecycle timeline is empty"
        description="The existing platform secret rotation feed is still connected; secret cards will appear here when records exist."
      />
    );
  }

  const sorted = [...items].sort((left, right) => {
    const leftDays = daysUntil(left.expires_at) ?? 9999;
    const rightDays = daysUntil(right.expires_at) ?? 9999;
    return leftDays - rightDays;
  });

  return (
    <Card>
      <SectionHeader
        title="Secret Lifecycle Timeline"
        subtitle="Lifecycle bars replace the old raw table to keep access hygiene visual and action-oriented."
      />
      <div className="space-y-3">
        {sorted.map((item) => {
          const remainingDays = daysUntil(item.expires_at);
          const severity = item.status === 'expired'
            ? 'critical'
            : remainingDays != null && remainingDays <= 7
              ? 'high'
              : remainingDays != null && remainingDays <= 30
                ? 'medium'
                : 'good';
          const progress = remainingDays == null ? 25 : Math.max(10, Math.min(100, 100 - (Math.min(Math.max(remainingDays, 0), 90) / 90) * 100));
          const barTone = severity === 'critical'
            ? 'bg-prism-critical'
            : severity === 'high'
              ? 'bg-prism-high'
              : severity === 'medium'
                ? 'bg-prism-elevated'
                : 'bg-prism-teal';
          return (
            <div key={item.id} className="rounded-xl border border-border/70 bg-prism-card/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-txt-primary">{item.secret_name}</p>
                  <p className="mt-1 text-[11px] text-txt-muted">{getPlatformLabel(item.platform)}</p>
                </div>
                <SeverityBadge severity={normalizeSeverity(severity)} />
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-prism-card">
                <div className={`h-full rounded-full ${barTone}`} style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-[12px] text-txt-muted">
                {remainingDays == null
                  ? `${item.status} · created ${formatDateTime(item.created_at)}`
                  : remainingDays < 0
                    ? `Expired ${Math.abs(remainingDays)} day${Math.abs(remainingDays) === 1 ? '' : 's'} ago`
                    : `Expires in ${remainingDays} day${remainingDays === 1 ? '' : 's'}`}
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

type GrantInventoryStatus = 'active' | 'expiring-soon' | 'expires-this-month' | 'expired' | 'inactive' | 'no-expiry';

interface GrantInventoryItem extends ToolGrant {
  department: string;
  displayName: string;
  roleTitle: string;
  expiresInDays: number | null;
  inventoryStatus: GrantInventoryStatus;
  searchText: string;
}

function getGrantInventoryStatus(grant: ToolGrant): GrantInventoryStatus {
  if (!grant.is_active) return 'inactive';
  const expiresInDays = daysUntil(grant.expires_at);
  if (expiresInDays == null) return 'no-expiry';
  if (expiresInDays < 0) return 'expired';
  if (expiresInDays <= 7) return 'expiring-soon';
  if (expiresInDays <= 30) return 'expires-this-month';
  return 'active';
}

function getGrantInventorySeverity(status: GrantInventoryStatus) {
  if (status === 'expired') return 'critical';
  if (status === 'expiring-soon') return 'high';
  if (status === 'expires-this-month') return 'medium';
  if (status === 'active') return 'good';
  if (status === 'no-expiry') return 'info';
  return 'warning';
}

function getGrantInventoryLabel(status: GrantInventoryStatus) {
  if (status === 'expiring-soon') return 'Expiring ≤7d';
  if (status === 'expires-this-month') return 'Expiring ≤30d';
  if (status === 'no-expiry') return 'No expiry';
  return toHumanWords(status);
}

function AccessGrantManager({
  grants,
  pendingApprovals,
  isAdmin,
  currentUserEmail,
  busyDecisionId,
  onGrant,
  onRevoke,
  onResolveApproval,
}: {
  grants: ToolGrant[];
  pendingApprovals: PendingApproval[];
  isAdmin: boolean;
  currentUserEmail: string | null;
  busyDecisionId?: string | null;
  onGrant: (input: { agentRole: string; toolName: string; reason: string; expiresAt: string | null }) => Promise<void>;
  onRevoke: (grant: ToolGrant) => Promise<void>;
  onResolveApproval: (id: string, approve: boolean) => Promise<void>;
}) {
  const [agentRole, setAgentRole] = useState(AGENT_ROLES[0] ?? 'chief-of-staff');
  const [toolName, setToolName] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [toolFilter, setToolFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const departmentByRole = useMemo(() => {
    const entries = getAgentsByDepartment().flatMap((group) => group.roles.map((role) => [role, group.dept] as const));
    return new Map(entries);
  }, []);

  const inventory = useMemo<GrantInventoryItem[]>(() => {
    return [...grants]
      .map((grant) => {
        const displayName = getDisplayName(grant.agent_role);
        const roleTitle = getRoleTitle(grant.agent_role);
        const department = departmentByRole.get(grant.agent_role) ?? 'Other';
        const expiresInDays = daysUntil(grant.expires_at);
        const inventoryStatus = getGrantInventoryStatus(grant);
        return {
          ...grant,
          displayName,
          roleTitle,
          department,
          expiresInDays,
          inventoryStatus,
          searchText: [
            grant.agent_role,
            displayName,
            roleTitle,
            department,
            grant.tool_name,
            grant.granted_by,
            grant.reason,
            grant.scope,
            inventoryStatus,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase(),
        };
      })
      .sort((left, right) => {
        const statusPriority: Record<GrantInventoryStatus, number> = {
          expired: 0,
          'expiring-soon': 1,
          'expires-this-month': 2,
          active: 3,
          'no-expiry': 4,
          inactive: 5,
        };
        return statusPriority[left.inventoryStatus] - statusPriority[right.inventoryStatus]
          || left.displayName.localeCompare(right.displayName)
          || left.tool_name.localeCompare(right.tool_name);
      });
  }, [departmentByRole, grants]);

  const departmentOptions = useMemo(
    () => [...new Set(inventory.map((grant) => grant.department))].sort((left, right) => left.localeCompare(right)),
    [inventory],
  );
  const agentOptions = useMemo(
    () => [...new Map(inventory.map((grant) => [grant.agent_role, grant.displayName])).entries()].sort((left, right) => left[1].localeCompare(right[1])),
    [inventory],
  );
  const toolOptions = useMemo(
    () => [...new Set(inventory.map((grant) => grant.tool_name))].sort((left, right) => left.localeCompare(right)),
    [inventory],
  );

  const filteredInventory = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return inventory.filter((grant) => {
      if (departmentFilter !== 'all' && grant.department !== departmentFilter) return false;
      if (agentFilter !== 'all' && grant.agent_role !== agentFilter) return false;
      if (toolFilter !== 'all' && grant.tool_name !== toolFilter) return false;
      if (statusFilter !== 'all' && grant.inventoryStatus !== statusFilter) return false;
      if (normalizedSearch && !grant.searchText.includes(normalizedSearch)) return false;
      return true;
    });
  }, [agentFilter, departmentFilter, inventory, search, statusFilter, toolFilter]);

  const filteredSummary = useMemo(() => {
    return {
      agents: new Set(filteredInventory.map((grant) => grant.agent_role)).size,
      tools: new Set(filteredInventory.map((grant) => grant.tool_name)).size,
      departments: new Set(filteredInventory.map((grant) => grant.department)).size,
      expiringSoon: filteredInventory.filter((grant) => grant.inventoryStatus === 'expiring-soon').length,
      inactiveOrExpired: filteredInventory.filter((grant) => grant.inventoryStatus === 'inactive' || grant.inventoryStatus === 'expired').length,
    };
  }, [filteredInventory]);

  const filteredGrouped = useMemo(() => {
    const activeByDept = new Map<string, GrantInventoryItem[]>();
    for (const grant of filteredInventory) {
      if (!grant.is_active) continue;
      const current = activeByDept.get(grant.department) ?? [];
      current.push(grant);
      activeByDept.set(grant.department, current);
    }

    return getAgentsByDepartment()
      .map((group) => ({
        dept: group.dept,
        grants: (activeByDept.get(group.dept) ?? []).sort((left, right) => left.displayName.localeCompare(right.displayName) || left.tool_name.localeCompare(right.tool_name)),
      }))
      .filter((group) => group.grants.length > 0);
  }, [filteredInventory]);

  const resetFilters = () => {
    setSearch('');
    setDepartmentFilter('all');
    setAgentFilter('all');
    setToolFilter('all');
    setStatusFilter('all');
  };

  const handleSubmit = async () => {
    if (!toolName.trim()) return;
    setSubmitting(true);
    try {
      const parsedExpiry = expiresAt ? new Date(expiresAt) : null;
      await onGrant({
        agentRole,
        toolName: toolName.trim(),
        reason: reason.trim(),
        expiresAt: parsedExpiry && !Number.isNaN(parsedExpiry.getTime()) ? parsedExpiry.toISOString() : null,
      });
      setToolName('');
      setReason('');
      setExpiresAt('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {pendingApprovals.length > 0 && (
        <Card>
          <SectionHeader
            title="Pending Founder Approvals"
            subtitle="Decision objects from the existing approval queue remain visible inside Access Control."
          />
          <div className="space-y-3">
            {pendingApprovals.map((approval) => (
              <div key={approval.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border/70 bg-prism-card/60 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-txt-primary">{approval.title}</p>
                  <p className="mt-2 text-[13px] text-txt-secondary">{approval.summary}</p>
                  <p className="mt-2 text-[11px] text-txt-muted">Requested by {getDisplayName(approval.proposed_by)} · {formatDateTime(approval.created_at)}</p>
                </div>
                {isAdmin && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyDecisionId === approval.id}
                      onClick={() => onResolveApproval(approval.id, true)}
                      className="rounded-lg border border-prism-teal/30 bg-prism-teal/10 px-3 py-1.5 text-[12px] font-medium text-prism-teal transition-colors hover:bg-prism-teal/20 disabled:opacity-50"
                    >
                      {busyDecisionId === approval.id ? 'Saving…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      disabled={busyDecisionId === approval.id}
                      onClick={() => onResolveApproval(approval.id, false)}
                      className="rounded-lg border border-prism-critical/30 bg-prism-critical/10 px-3 py-1.5 text-[12px] font-medium text-prism-critical transition-colors hover:bg-prism-critical/20 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <SectionHeader
          title="Grant Management"
          subtitle={isAdmin ? `Signed in as ${currentUserEmail ?? 'founder'}` : 'Read-only access posture view'}
        />
        {isAdmin && (
          <div className="grid gap-3 rounded-xl border border-border/70 bg-prism-card/60 p-4 md:grid-cols-[1.1fr,1fr,1fr,0.95fr,auto]">
            <select
              value={agentRole}
              onChange={(event) => setAgentRole(event.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-txt-primary"
            >
              {getAgentsByDepartment().map((group) => (
                <optgroup key={group.dept} label={group.dept}>
                  {group.roles.map((role) => (
                    <option key={role} value={role}>{getDisplayName(role)}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <input
              value={toolName}
              onChange={(event) => setToolName(event.target.value)}
              placeholder="Tool name, e.g. upload_to_sharepoint"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-txt-primary placeholder:text-txt-muted"
            />
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason for grant"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-txt-primary placeholder:text-txt-muted"
            />
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-txt-primary"
            />
            <button
              type="button"
              disabled={submitting || !toolName.trim()}
              onClick={handleSubmit}
              className="rounded-lg bg-prism-sky/15 px-4 py-2 text-[13px] font-medium text-prism-sky transition-colors hover:bg-prism-sky/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Granting…' : 'Grant'}
            </button>
          </div>
        )}

        <div className="mt-4 space-y-4">
          {grouped.length === 0 ? (
            <p className="text-[13px] text-txt-muted">No active grants found.</p>
          ) : (
            grouped.map((group) => (
              <div key={group.dept}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-txt-muted">{group.dept}</p>
                <div className="mt-3 space-y-2">
                  {group.grants.map((grant) => {
                    const expiry = daysUntil(grant.expires_at);
                    const tone = expiry != null && expiry <= 7
                      ? 'border-prism-elevated/30 bg-prism-elevated/10'
                      : 'border-border/70 bg-surface';
                    return (
                      <div key={grant.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 ${tone}`}>
                        <div>
                          <p className="text-[13px] font-medium text-txt-primary">{getDisplayName(grant.agent_role)}</p>
                          <p className="mt-1 text-[11px] text-txt-muted">{toHumanWords(grant.tool_name)} · granted by {grant.granted_by}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {expiry != null && (
                            <span className="rounded-full border border-border/70 bg-prism-card px-2 py-0.5 text-[11px] text-txt-muted">
                              {expiry < 0 ? 'Expired' : `Expires in ${expiry}d`}
                            </span>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => onRevoke(grant)}
                              className="rounded-lg border border-prism-critical/30 bg-prism-critical/10 px-3 py-1.5 text-[12px] font-medium text-prism-critical transition-colors hover:bg-prism-critical/20"
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

export default function AccessControl({
  loading,
  accessPosture,
  actionQueue,
  leastPrivilege,
  iamState,
  secrets,
  grants,
  pendingApprovals,
  isAdmin,
  currentUserEmail,
  busyDecisionId,
  onGrant,
  onRevoke,
  onResolveApproval,
}: AccessControlProps) {
  const accessIssues = useMemo(() => actionQueue.filter(isAccessIssue), [actionQueue]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-52 w-full" />
        <div className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AccessPostureScore posture={accessPosture} />
      <div className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
        <RiskRankedIssues items={accessIssues} />
        <LeastPrivilegeMatrix items={leastPrivilege} />
      </div>
      <IAMDrillDown items={iamState} />
      <SecretLifecycleTimeline items={secrets} />
      <AccessGrantManager
        grants={grants}
        pendingApprovals={pendingApprovals}
        isAdmin={isAdmin}
        currentUserEmail={currentUserEmail}
        busyDecisionId={busyDecisionId}
        onGrant={onGrant}
        onRevoke={onRevoke}
        onResolveApproval={onResolveApproval}
      />
    </div>
  );
}
