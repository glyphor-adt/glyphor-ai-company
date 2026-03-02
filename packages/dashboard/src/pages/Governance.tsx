import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiCall, SCHEDULER_URL } from '../lib/firebase';
import { useAuth } from '../lib/auth';
import { DISPLAY_NAME_MAP } from '../lib/types';
import { Card, SectionHeader, Skeleton, timeAgo, PageTabs } from '../components/ui';
import {
  MdExpandMore, MdChevronRight, MdCheck, MdWarning,
  MdLock, MdVpnKey, MdBarChart, MdClose,
  MdShield, MdPersonAdd, MdRemoveCircle, MdSearch,
  MdAdminPanelSettings, MdPending, MdCheckCircle,
} from 'react-icons/md';

/* ── Types ────────────────────────────────── */

interface IAMState {
  id: string;
  platform: string;
  credential_id: string;
  agent_role: string | null;
  permissions: Record<string, unknown>;
  desired_permissions: Record<string, unknown> | null;
  in_sync: boolean;
  drift_details: string | null;
  last_synced: string;
}

interface AuditEntry {
  id: string;
  agent_role: string;
  platform: string;
  action: string;
  resource: string | null;
  response_code: number | null;
  response_summary: string | null;
  cost_estimate: number | null;
  timestamp: string;
}

interface SecretRotation {
  id: string;
  platform: string;
  secret_name: string;
  created_at: string;
  expires_at: string | null;
  status: string;
}

type Platform = 'gcp' | 'm365' | 'github' | 'stripe' | 'vercel';

type GovernanceTab = 'platform' | 'admin';

/* ── Admin-only access gate ───────────────── */
const ADMIN_EMAILS = ['kristina@glyphor.ai', 'devops@glyphor.ai'];

interface ToolGrant {
  id: string;
  agent_role: string;
  tool_name: string;
  granted_by: string;
  reason: string | null;
  scope: string;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PendingApproval {
  id: string;
  tier: string;
  status: string;
  title: string;
  summary: string;
  proposed_by: string;
  data: Record<string, unknown> | null;
  created_at: string;
}

/* ── All agent roles for the grant dropdown ── */
const AGENT_ROLES = Object.keys(DISPLAY_NAME_MAP).sort();

/* ── Constants ────────────────────────────── */

const PLATFORM_LABELS: Record<Platform, string> = {
  gcp: 'Google Cloud Platform',
  m365: 'Microsoft 365 / Entra ID',
  github: 'GitHub',
  stripe: 'Stripe',
  vercel: 'Vercel',
};

const PLATFORM_COLORS: Record<Platform, string> = {
  gcp: '#4285F4',
  m365: '#0078D4',
  github: '#171515',
  stripe: '#635BFF',
  vercel: '#000000',
};

/* ── Collapsible Section ──────────────────── */

function CollapsibleSection({ title, color, children, defaultOpen = true }: {
  title: string;
  color: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 text-left"
      >
        <span
          className="flex h-6 w-6 items-center justify-center rounded text-white"
          style={{ backgroundColor: color }}
        >
          {open ? <MdExpandMore className="text-[14px]" /> : <MdChevronRight className="text-[14px]" />}
        </span>
        <h3 className="text-sm font-semibold text-txt-primary">{title}</h3>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </Card>
  );
}

/* ── Platform Tables ──────────────────────── */

function GCPTable({ items }: { items: IAMState[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-txt-muted">
            <th className="pb-2 pr-4 font-medium">Service Account</th>
            <th className="pb-2 pr-4 font-medium">Agent</th>
            <th className="pb-2 pr-4 font-medium">Roles</th>
            <th className="pb-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const roles = (item.permissions as { roles?: string[] })?.roles ?? [];
            return (
              <tr key={item.id} className="border-b border-border/50">
                <td className="py-2.5 pr-4">
                  <code className="rounded bg-prism-bg2 px-1.5 py-0.5 text-[12px]">
                    {item.credential_id.split('@')[0]}
                  </code>
                </td>
                <td className="py-2.5 pr-4 text-txt-primary">
                  {item.agent_role
                    ? DISPLAY_NAME_MAP[item.agent_role] ?? item.agent_role
                    : <span className="text-txt-muted italic">(gated)</span>}
                </td>
                <td className="py-2.5 pr-4">
                  <span className="text-txt-muted">{roles.length} role{roles.length !== 1 ? 's' : ''}</span>
                </td>
                <td className="py-2.5">
                  <SyncBadge inSync={item.in_sync} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function M365Table({ items }: { items: IAMState[] }) {
  // Map credential → agents
  const agentsByCredential: Record<string, string[]> = {
    'glyphor-teams-channels': ['All (17)'],
    'glyphor-teams-bot': ['chief-of-staff', 'ops'],
    'glyphor-mail': ['chief-of-staff', 'onboarding-specialist', 'support-triage', 'vp-sales'],
    'glyphor-files': ['cfo'],
    'glyphor-users': ['cmo'],
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-txt-muted">
            <th className="pb-2 pr-4 font-medium">App Registration</th>
            <th className="pb-2 pr-4 font-medium">Scopes</th>
            <th className="pb-2 font-medium">Agents Using</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const scopes = (item.permissions as { scopes?: string[] })?.scopes ?? [];
            const agents = agentsByCredential[item.credential_id] ?? [];
            return (
              <tr key={item.id} className="border-b border-border/50">
                <td className="py-2.5 pr-4 text-txt-primary font-medium">
                  {formatCredentialName(item.credential_id)}
                </td>
                <td className="py-2.5 pr-4">
                  {scopes.map((s) => (
                    <span key={s} className="mr-1.5 inline-block rounded bg-prism-tint-3 px-1.5 py-0.5 text-[11px] font-medium text-prism-sky">
                      {s}
                    </span>
                  ))}
                </td>
                <td className="py-2.5 text-txt-muted text-[12px]">
                  {agents.map((a) => DISPLAY_NAME_MAP[a] ?? a).join(', ')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GitHubTable({ items }: { items: IAMState[] }) {
  // Show per-agent scoping from the config
  const agentScopes = [
    { role: 'cto', repos: 'fuse, pulse, runtime', perms: 'contents: write, PRs: write, actions: write' },
    { role: 'platform-engineer', repos: 'fuse, pulse', perms: 'contents: read' },
    { role: 'quality-engineer', repos: 'fuse, pulse', perms: 'contents: write (test/*)' },
    { role: 'devops-engineer', repos: 'fuse, pulse', perms: 'actions: write' },
    { role: 'competitive-intel', repos: '(public only)', perms: 'contents: read' },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-txt-muted">
            <th className="pb-2 pr-4 font-medium">Agent</th>
            <th className="pb-2 pr-4 font-medium">Repos</th>
            <th className="pb-2 font-medium">Permissions</th>
          </tr>
        </thead>
        <tbody>
          {agentScopes.map((s) => (
            <tr key={s.role} className="border-b border-border/50">
              <td className="py-2.5 pr-4 text-txt-primary font-medium">
                {DISPLAY_NAME_MAP[s.role] ?? s.role}
              </td>
              <td className="py-2.5 pr-4 text-txt-muted">{s.repos}</td>
              <td className="py-2.5 text-txt-muted text-[12px]">{s.perms}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StripeTable({ items }: { items: IAMState[] }) {
  const keyAgents: Record<string, string> = {
    'restricted-key-finance': 'Nadia Okafor',
    'restricted-key-reporting': 'Anna Park, Omar Hassan',
    'restricted-key-cs': 'James Turner, David Santos',
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-txt-muted">
            <th className="pb-2 pr-4 font-medium">Key</th>
            <th className="pb-2 pr-4 font-medium">Agents</th>
            <th className="pb-2 font-medium">Resources</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const resources = (item.permissions as { resources?: string[] })?.resources ?? [];
            return (
              <tr key={item.id} className="border-b border-border/50">
                <td className="py-2.5 pr-4 text-txt-primary font-medium">{item.credential_id}</td>
                <td className="py-2.5 pr-4 text-txt-muted">{keyAgents[item.credential_id] ?? '—'}</td>
                <td className="py-2.5">
                  {resources.map((r) => (
                    <span key={r} className="mr-1.5 inline-block rounded bg-prism-tint-5 px-1.5 py-0.5 text-[11px] font-medium text-prism-violet">
                      {r}
                    </span>
                  ))}
                  <SyncBadge inSync={item.in_sync} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function VercelTable({ items }: { items: IAMState[] }) {
  const tokenAgents: Record<string, string> = {
    'token-deploy': 'Marcus Reeves',
    'token-monitoring': 'Alex Park, Jordan Hayes',
    'token-billing': 'Omar Hassan, Nadia Okafor',
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-txt-muted">
            <th className="pb-2 pr-4 font-medium">Token</th>
            <th className="pb-2 pr-4 font-medium">Agents</th>
            <th className="pb-2 font-medium">Scopes</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const scopes = (item.permissions as { scopes?: string[] })?.scopes ?? [];
            return (
              <tr key={item.id} className="border-b border-border/50">
                <td className="py-2.5 pr-4 text-txt-primary font-medium">{item.credential_id}</td>
                <td className="py-2.5 pr-4 text-txt-muted">{tokenAgents[item.credential_id] ?? '—'}</td>
                <td className="py-2.5">
                  {scopes.map((s) => (
                    <span key={s} className="mr-1.5 inline-block rounded bg-prism-bg2 px-1.5 py-0.5 text-[11px] font-medium text-prism-secondary">
                      {s}
                    </span>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Helpers ──────────────────────────────── */

function SyncBadge({ inSync }: { inSync: boolean }) {
  return inSync ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-prism-tint-2 px-2 py-0.5 text-[11px] font-medium text-prism-teal">
      <MdCheck className="text-[13px]" /> Synced
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-prism-elevated/15 px-2 py-0.5 text-[11px] font-medium text-prism-elevated">
      <MdWarning className="text-[13px]" /> Drift
    </span>
  );
}

function formatCredentialName(id: string): string {
  return id
    .replace('glyphor-', 'Glyphor – ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (86400 * 1000));
}

function ExpiryBadge({ expiresAt, status }: { expiresAt: string | null; status: string }) {
  if (!expiresAt) {
    return <span className="text-[11px] text-txt-muted">never</span>;
  }
  const days = daysUntil(expiresAt);
  if (days === null) return null;

  if (status === 'expired' || days <= 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-prism-critical/15 px-2 py-0.5 text-[11px] font-medium text-prism-critical">
        Expired
      </span>
    );
  }
  if (days <= 90) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-prism-elevated/15 px-2 py-0.5 text-[11px] font-medium text-prism-elevated">
        <MdWarning className="text-[13px]" /> {days}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-prism-tint-2 px-2 py-0.5 text-[11px] font-medium text-prism-teal">
      <MdCheck className="text-[13px]" /> {days}d
    </span>
  );
}

/* ── Admin & Access Panel ─────────────────── */

function AdminAccessPanel({ isAdmin }: { isAdmin: boolean }) {
  const [grants, setGrants] = useState<ToolGrant[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterGrantedBy, setFilterGrantedBy] = useState('all');

  // Grant form
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [grantRole, setGrantRole] = useState('');
  const [grantTool, setGrantTool] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [grantScope, setGrantScope] = useState<'full' | 'read_only'>('full');
  const [grantExpiry, setGrantExpiry] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadGrants = useCallback(async () => {
    setLoading(true);
    try {
      const [grantsData, approvalsData] = await Promise.all([
        apiCall<ToolGrant[]>('/api/agent-tool-grants?order=agent_role.asc,tool_name.asc'),
        apiCall<PendingApproval[]>('/api/decisions?status=pending&order=created_at.desc&limit=20'),
      ]);
      setGrants(grantsData ?? []);
      setPendingApprovals(
        (approvalsData ?? []).filter((d) =>
          d.title?.toLowerCase().includes('tool') ||
          d.title?.toLowerCase().includes('grant') ||
          d.title?.toLowerCase().includes('admin') ||
          d.summary?.toLowerCase().includes('tool access')
        ),
      );
    } catch {
      setGrants([]);
      setPendingApprovals([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadGrants(); }, [loadGrants]);

  const handleGrant = async () => {
    if (!grantRole || !grantTool || !grantReason) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        agent_role: grantRole,
        tool_name: grantTool,
        granted_by: 'kristina',
        reason: grantReason,
        scope: grantScope,
        is_active: true,
      };
      if (grantExpiry) {
        body.expires_at = new Date(grantExpiry).toISOString();
      }
      await apiCall('/api/agent-tool-grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setShowGrantForm(false);
      setGrantRole('');
      setGrantTool('');
      setGrantReason('');
      setGrantScope('full');
      setGrantExpiry('');
      await loadGrants();
    } catch { /* handled by apiCall */ }
    setSubmitting(false);
  };

  const handleRevoke = async (grant: ToolGrant) => {
    if (!confirm(`Revoke "${grant.tool_name}" from ${DISPLAY_NAME_MAP[grant.agent_role] ?? grant.agent_role}?`)) return;
    try {
      await apiCall(`/api/agent-tool-grants/${grant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: false }),
      });
      await loadGrants();
    } catch { /* handled by apiCall */ }
  };

  const handleApproval = async (id: string, approve: boolean) => {
    try {
      await apiCall(`/api/decisions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: approve ? 'approved' : 'rejected',
          resolved_by: 'kristina',
          resolved_at: new Date().toISOString(),
        }),
      });
      await loadGrants();
    } catch { /* handled by apiCall */ }
  };

  // Filtered/searched grants
  const activeGrants = useMemo(() => grants.filter((g) => g.is_active), [grants]);
  const grantedByOptions = useMemo(
    () => [...new Set(activeGrants.map((g) => g.granted_by))].sort(),
    [activeGrants],
  );
  const filteredGrants = useMemo(() => {
    return activeGrants.filter((g) => {
      if (filterRole !== 'all' && g.agent_role !== filterRole) return false;
      if (filterGrantedBy !== 'all' && g.granted_by !== filterGrantedBy) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          g.agent_role.includes(term) ||
          g.tool_name.includes(term) ||
          (DISPLAY_NAME_MAP[g.agent_role] ?? '').toLowerCase().includes(term) ||
          (g.reason ?? '').toLowerCase().includes(term)
        );
      }
      return true;
    });
  }, [activeGrants, filterRole, filterGrantedBy, searchTerm]);

  // Group by agent for the matrix view
  const grantsByAgent = useMemo(() => {
    const map: Record<string, ToolGrant[]> = {};
    for (const g of filteredGrants) {
      (map[g.agent_role] ??= []).push(g);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredGrants]);

  // Stats
  const totalAgents = new Set(activeGrants.map((g) => g.agent_role)).size;
  const totalTools = new Set(activeGrants.map((g) => g.tool_name)).size;
  const expiringGrants = activeGrants.filter((g) => {
    if (!g.expires_at) return false;
    const days = (new Date(g.expires_at).getTime() - Date.now()) / (86400 * 1000);
    return days > 0 && days <= 7;
  });

  if (loading) {
    return <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full" />)}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Agents with Grants', value: totalAgents, icon: <MdPersonAdd className="text-prism-sky" /> },
          { label: 'Active Grants', value: activeGrants.length, icon: <MdShield className="text-prism-teal" /> },
          { label: 'Unique Tools', value: totalTools, icon: <MdAdminPanelSettings className="text-prism-violet" /> },
          { label: 'Pending Approvals', value: pendingApprovals.length, icon: <MdPending className="text-prism-elevated" /> },
        ].map((s) => (
          <Card key={s.label} className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-prism-card text-lg">{s.icon}</span>
            <div>
              <p className="text-2xl font-bold text-txt-primary">{s.value}</p>
              <p className="text-[12px] text-txt-muted">{s.label}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Expiring Grants Warning */}
      {expiringGrants.length > 0 && (
        <Card className="border-prism-elevated/30">
          <div className="flex items-start gap-3">
            <MdWarning className="mt-0.5 text-prism-elevated" />
            <div>
              <p className="text-[13px] font-medium text-prism-primary">
                {expiringGrants.length} grant{expiringGrants.length !== 1 ? 's' : ''} expiring within 7 days
              </p>
              <div className="mt-2 space-y-1">
                {expiringGrants.map((g) => (
                  <p key={g.id} className="text-[12px] text-txt-muted">
                    <span className="font-medium text-txt-secondary">{DISPLAY_NAME_MAP[g.agent_role] ?? g.agent_role}</span>
                    {' '}&rarr; <code className="rounded bg-prism-bg2 px-1 text-[11px]">{g.tool_name}</code>
                    {' '}expires {timeAgo(g.expires_at)}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Pending Approvals */}
      {pendingApprovals.length > 0 && isAdmin && (
        <Card>
          <SectionHeader title="Pending Tool/Admin Approvals" />
          <div className="space-y-3">
            {pendingApprovals.map((d) => (
              <div
                key={d.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-prism-elevated/20 bg-prism-elevated/5 p-3"
              >
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-txt-primary">{d.title}</p>
                  <p className="mt-0.5 text-[12px] text-txt-muted">{d.summary}</p>
                  <p className="mt-1 text-[11px] text-txt-muted">
                    Proposed by <span className="font-medium">{DISPLAY_NAME_MAP[d.proposed_by] ?? d.proposed_by}</span>
                    {' '}&middot; {timeAgo(d.created_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApproval(d.id, true)}
                    className="rounded border border-prism-teal/30 bg-prism-teal/10 px-3 py-1 text-[11px] font-medium text-prism-teal transition-colors hover:bg-prism-teal/20"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleApproval(d.id, false)}
                    className="rounded border border-prism-critical/30 bg-prism-critical/10 px-3 py-1 text-[11px] font-medium text-prism-critical transition-colors hover:bg-prism-critical/20"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Toolbar: Search + Filters + Grant Button */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-txt-muted" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search agents, tools, or reasons…"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-[13px] text-txt-primary placeholder:text-txt-muted focus:border-prism-sky focus:outline-none"
          />
        </div>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-txt-primary"
        >
          <option value="all">All agents</option>
          {AGENT_ROLES.map((r) => (
            <option key={r} value={r}>{DISPLAY_NAME_MAP[r] ?? r}</option>
          ))}
        </select>
        <select
          value={filterGrantedBy}
          onChange={(e) => setFilterGrantedBy(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-txt-primary"
        >
          <option value="all">All grantors</option>
          {grantedByOptions.map((g) => (
            <option key={g} value={g}>{DISPLAY_NAME_MAP[g] ?? g}</option>
          ))}
        </select>
        {isAdmin && (
          <button
            onClick={() => setShowGrantForm(!showGrantForm)}
            className="flex items-center gap-1.5 rounded-lg bg-prism-sky/15 px-4 py-2 text-[13px] font-medium text-prism-sky transition-colors hover:bg-prism-sky/25"
          >
            <MdPersonAdd className="text-[16px]" />
            Grant Access
          </button>
        )}
      </div>

      {/* Grant Form (Kristina only) */}
      {showGrantForm && isAdmin && (
        <Card className="border-prism-sky/30">
          <SectionHeader title="Grant Tool Access" />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-txt-muted">Agent</label>
              <select
                value={grantRole}
                onChange={(e) => setGrantRole(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-txt-primary"
              >
                <option value="">Select agent…</option>
                {AGENT_ROLES.map((r) => (
                  <option key={r} value={r}>{DISPLAY_NAME_MAP[r] ?? r} ({r})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-txt-muted">Tool Name</label>
              <input
                type="text"
                value={grantTool}
                onChange={(e) => setGrantTool(e.target.value)}
                placeholder="e.g. send_email, query_stripe_revenue"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-txt-primary placeholder:text-txt-muted"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-[12px] font-medium text-txt-muted">Reason</label>
              <input
                type="text"
                value={grantReason}
                onChange={(e) => setGrantReason(e.target.value)}
                placeholder="Why is this grant needed?"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-txt-primary placeholder:text-txt-muted"
              />
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-txt-muted">Scope</label>
              <select
                value={grantScope}
                onChange={(e) => setGrantScope(e.target.value as 'full' | 'read_only')}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-txt-primary"
              >
                <option value="full">Full Access</option>
                <option value="read_only">Read Only</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[12px] font-medium text-txt-muted">Expires (optional)</label>
              <input
                type="datetime-local"
                value={grantExpiry}
                onChange={(e) => setGrantExpiry(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-txt-primary"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setShowGrantForm(false)}
              className="rounded-lg border border-border px-4 py-1.5 text-[13px] text-txt-muted hover:text-txt-primary"
            >
              Cancel
            </button>
            <button
              onClick={handleGrant}
              disabled={!grantRole || !grantTool || !grantReason || submitting}
              className="rounded-lg bg-prism-sky px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
            >
              {submitting ? 'Granting…' : 'Grant'}
            </button>
          </div>
        </Card>
      )}

      {/* Access Matrix — grouped by agent */}
      <Card>
        <SectionHeader
          title="Agent Access Matrix"
          subtitle={`${filteredGrants.length} active grant${filteredGrants.length !== 1 ? 's' : ''} across ${grantsByAgent.length} agent${grantsByAgent.length !== 1 ? 's' : ''}`}
        />
        {grantsByAgent.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-txt-muted">No grants match your filters</p>
        ) : (
          <div className="space-y-4">
            {grantsByAgent.map(([role, agentGrants]) => (
              <div key={role} className="rounded-lg border border-border/50 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-txt-primary">
                    {DISPLAY_NAME_MAP[role] ?? role}
                  </span>
                  <span className="rounded bg-prism-bg2 px-1.5 py-0.5 text-[11px] text-txt-muted">{role}</span>
                  <span className="ml-auto text-[12px] text-txt-muted">
                    {agentGrants.length} tool{agentGrants.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {agentGrants.map((g) => (
                    <span
                      key={g.id}
                      className="group relative inline-flex items-center gap-1 rounded-full border border-border/50 bg-prism-card px-2.5 py-1 text-[12px] text-txt-secondary"
                      title={`Granted by ${DISPLAY_NAME_MAP[g.granted_by] ?? g.granted_by}${g.reason ? ` — ${g.reason}` : ''}${g.scope === 'read_only' ? ' (read only)' : ''}`}
                    >
                      {g.scope === 'read_only' && (
                        <MdSearch className="text-[12px] text-prism-sky" />
                      )}
                      {g.tool_name}
                      {g.expires_at && (
                        <span className="text-[10px] text-prism-elevated">
                          &middot; exp {new Date(g.expires_at).toLocaleDateString()}
                        </span>
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => handleRevoke(g)}
                          className="ml-0.5 hidden text-prism-critical transition-colors hover:text-prism-critical/80 group-hover:inline-flex"
                          title="Revoke"
                        >
                          <MdRemoveCircle className="text-[13px]" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Revocation History */}
      {grants.filter((g) => !g.is_active).length > 0 && (
        <Card>
          <SectionHeader
            title="Revocation History"
            subtitle="Previously revoked grants"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-txt-muted">
                  <th className="pb-2 pr-4 font-medium">Agent</th>
                  <th className="pb-2 pr-4 font-medium">Tool</th>
                  <th className="pb-2 pr-4 font-medium">Granted By</th>
                  <th className="pb-2 pr-4 font-medium">Reason</th>
                  <th className="pb-2 font-medium">Revoked</th>
                </tr>
              </thead>
              <tbody>
                {grants
                  .filter((g) => !g.is_active)
                  .slice(0, 20)
                  .map((g) => (
                    <tr key={g.id} className="border-b border-border/50 opacity-60">
                      <td className="py-2 pr-4 text-txt-primary">{DISPLAY_NAME_MAP[g.agent_role] ?? g.agent_role}</td>
                      <td className="py-2 pr-4"><code className="rounded bg-prism-bg2 px-1 text-[12px]">{g.tool_name}</code></td>
                      <td className="py-2 pr-4 text-txt-muted">{DISPLAY_NAME_MAP[g.granted_by] ?? g.granted_by}</td>
                      <td className="py-2 pr-4 text-txt-muted text-[12px]">{g.reason ?? '—'}</td>
                      <td className="py-2 text-[12px] text-txt-muted">{timeAgo(g.updated_at)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ── Page ─────────────────────────────────── */

export default function Governance() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<GovernanceTab>('platform');
  const isAdmin = ADMIN_EMAILS.includes(user?.email?.toLowerCase() ?? '');

  const [iamState, setIamState] = useState<IAMState[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [secrets, setSecrets] = useState<SecretRotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditing, setAuditing] = useState(false);

  // Audit log filters
  const [filterPlatform, setFilterPlatform] = useState<string>('all');
  const [filterAgent, setFilterAgent] = useState<string>('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [iamData, auditData, secretsData] = await Promise.all([
        apiCall<IAMState[]>('/api/platform-iam-state'),
        apiCall<AuditEntry[]>('/api/platform-audit-log?limit=50'),
        apiCall<SecretRotation[]>('/api/platform-secret-rotation'),
      ]);
      setIamState(iamData ?? []);
      setAuditLog(auditData ?? []);
      setSecrets(secretsData ?? []);
    } catch {
      setIamState([]);
      setAuditLog([]);
      setSecrets([]);
    }
    setLoading(false);
  }, []);

  const runAudit = useCallback(async () => {
    setAuditing(true);
    try {
      const schedulerUrl = SCHEDULER_URL;
      await fetch(`${schedulerUrl}/sync/governance`, { method: 'POST' });
    } catch { /* ignore — reload will show latest */ }
    await loadData();
    setAuditing(false);
  }, [loadData]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Platform Governance" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 w-full" />)}
      </div>
    );
  }

  // Group IAM state by platform
  const byPlatform = (p: Platform) => iamState.filter((s) => s.platform === p);
  const driftItems = iamState.filter((s) => !s.in_sync);
  const expiringSecrets = secrets.filter((s) => {
    if (!s.expires_at) return false;
    const days = daysUntil(s.expires_at);
    return days !== null && days <= 90;
  });

  // Filter audit log
  const filteredAudit = auditLog.filter((e) => {
    if (filterPlatform !== 'all' && e.platform !== filterPlatform) return false;
    if (filterAgent !== 'all' && e.agent_role !== filterAgent) return false;
    return true;
  });

  // Stats
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayAudit = auditLog.filter((e) => new Date(e.timestamp) >= todayStart);
  const failures = todayAudit.filter((e) => e.response_code && e.response_code >= 400);

  const uniqueAgents = [...new Set(auditLog.map((e) => e.agent_role))].sort();
  const uniquePlatforms = [...new Set(auditLog.map((e) => e.platform))].sort();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-prism-critical/15">
            <MdLock className="text-lg text-prism-critical" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-txt-primary">Governance</h1>
            <p className="text-[13px] text-txt-muted">
              Access control, tool grants, and platform audit trail
            </p>
          </div>
        </div>
        {activeTab === 'platform' && (
          <button
            onClick={runAudit}
            disabled={auditing}
            className="rounded-lg border border-prism-border bg-prism-card px-4 py-2 text-[13px] font-medium text-prism-primary shadow-prism transition-colors hover:bg-prism-bg2 disabled:opacity-50"
          >
            {auditing ? 'Auditing…' : 'Run Audit Now'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <PageTabs<GovernanceTab>
        tabs={[
          { key: 'platform', label: 'Platform IAM' },
          { key: 'admin', label: 'Admin & Access' },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {/* Tab Content */}
      {activeTab === 'admin' ? (
        <AdminAccessPanel isAdmin={isAdmin} />
      ) : (
      <>

      {/* Drift Alerts */}
      {(driftItems.length > 0 || expiringSecrets.length > 0) && (
        <Card className="border-prism-elevated/30">
          <SectionHeader
            title={`Drift Alerts — ${driftItems.length + expiringSecrets.length} issue${driftItems.length + expiringSecrets.length !== 1 ? 's' : ''} detected`}
          />
          <div className="space-y-3">
            {driftItems.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-lg border border-prism-elevated/30 bg-prism-elevated/5 p-3"
              >
                <MdWarning className="mt-0.5 text-prism-elevated" />
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-prism-primary">
                    <code className="rounded bg-prism-bg2 px-1 text-[12px]">{item.credential_id}</code>
                    {' '}has unexpected permissions
                  </p>
                  {item.drift_details && (
                    <p className="mt-1 text-[12px] text-txt-muted">{item.drift_details}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="rounded border border-prism-elevated/30 bg-prism-card px-2.5 py-1 text-[11px] font-medium text-prism-elevated transition-colors hover:bg-prism-elevated/10">
                    Details
                  </button>
                </div>
              </div>
            ))}
            {expiringSecrets.map((secret) => (
              <div
                key={secret.id}
                className="flex items-start gap-3 rounded-lg border border-prism-elevated/30 bg-prism-elevated/5 p-3"
              >
                <MdVpnKey className="mt-0.5 text-prism-elevated" />
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-prism-primary">
                    Secret <code className="rounded bg-prism-bg2 px-1 text-[12px]">{secret.secret_name}</code>
                    {' '}expires in {daysUntil(secret.expires_at)} days
                  </p>
                </div>
                <button className="rounded border border-prism-elevated/30 bg-prism-card px-2.5 py-1 text-[11px] font-medium text-prism-elevated transition-colors hover:bg-prism-elevated/10">
                  Rotate Now
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Platform Sections */}
      {(['gcp', 'm365', 'github', 'stripe', 'vercel'] as Platform[]).map((platform) => {
        const items = byPlatform(platform);
        // GitHub uses hardcoded scope data — always show it
        if (items.length === 0 && platform !== 'github') return null;
        return (
          <CollapsibleSection
            key={platform}
            title={PLATFORM_LABELS[platform]}
            color={PLATFORM_COLORS[platform]}
            defaultOpen={platform === 'gcp' || platform === 'm365' || platform === 'github'}
          >
            {platform === 'gcp' && <GCPTable items={items} />}
            {platform === 'm365' && <M365Table items={items} />}
            {platform === 'github' && <GitHubTable items={items} />}
            {platform === 'stripe' && <StripeTable items={items} />}
            {platform === 'vercel' && <VercelTable items={items} />}
          </CollapsibleSection>
        );
      })}

      {/* Audit Log */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <SectionHeader title="Audit Log" />
          <div className="flex items-center gap-2">
            <select
              value={filterPlatform}
              onChange={(e) => setFilterPlatform(e.target.value)}
              className="rounded border border-border bg-surface px-2 py-1 text-[12px] text-txt-primary"
            >
              <option value="all">All platforms</option>
              {uniquePlatforms.map((p) => (
                <option key={p} value={p}>{p.toUpperCase()}</option>
              ))}
            </select>
            <select
              value={filterAgent}
              onChange={(e) => setFilterAgent(e.target.value)}
              className="rounded border border-border bg-surface px-2 py-1 text-[12px] text-txt-primary"
            >
              <option value="all">All agents</option>
              {uniqueAgents.map((a) => (
                <option key={a} value={a}>{DISPLAY_NAME_MAP[a] ?? a}</option>
              ))}
            </select>
          </div>
        </div>

        {filteredAudit.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-txt-muted">No audit entries yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-txt-muted">
                  <th className="pb-2 pr-4 font-medium">Time</th>
                  <th className="pb-2 pr-4 font-medium">Agent</th>
                  <th className="pb-2 pr-4 font-medium">Platform</th>
                  <th className="pb-2 pr-4 font-medium">Action</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudit.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/50">
                    <td className="py-2 pr-4 text-txt-muted text-[12px]">{timeAgo(entry.timestamp)}</td>
                    <td className="py-2 pr-4 text-txt-primary">
                      {DISPLAY_NAME_MAP[entry.agent_role] ?? entry.agent_role}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="rounded bg-prism-bg2 px-1.5 py-0.5 text-[11px] font-medium text-prism-secondary">
                        {entry.platform.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-txt-muted">{entry.action}</td>
                    <td className="py-2">
                      {entry.response_code ? (
                        entry.response_code < 400 ? (
                          <span className="text-prism-teal inline-flex items-center gap-1">{entry.response_code} <MdCheck className="text-[14px]" /></span>
                        ) : (
                          <span className="text-prism-critical inline-flex items-center gap-1">{entry.response_code} <MdClose className="text-[14px]" /></span>
                        )
                      ) : (
                        <span className="text-txt-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Stats bar */}
        <div className="mt-4 flex items-center gap-4 border-t border-border pt-3 text-[12px] text-txt-muted">
          <span><MdBarChart className="inline-block text-[14px] mr-1" />{todayAudit.length} calls today</span>
          <span>|</span>
          <span>{failures.length} failure{failures.length !== 1 ? 's' : ''}</span>
          <span>|</span>
          <span>0 security events</span>
        </div>
      </Card>

      {/* Secret Rotation Status */}
      <Card>
        <SectionHeader title="Secret Rotation Status" />
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-txt-muted">
                <th className="pb-2 pr-4 font-medium">Secret</th>
                <th className="pb-2 pr-4 font-medium">Platform</th>
                <th className="pb-2 pr-4 font-medium">Created</th>
                <th className="pb-2 pr-4 font-medium">Expires</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {secrets.map((secret) => (
                <tr key={secret.id} className="border-b border-border/50">
                  <td className="py-2.5 pr-4">
                    <code className="rounded bg-prism-bg2 px-1.5 py-0.5 text-[12px]">
                      {secret.secret_name}
                    </code>
                  </td>
                  <td className="py-2.5 pr-4 text-txt-muted">{secret.platform.toUpperCase()}</td>
                  <td className="py-2.5 pr-4 text-txt-muted text-[12px]">
                    {new Date(secret.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2.5 pr-4 text-txt-muted text-[12px]">
                    {secret.expires_at ? new Date(secret.expires_at).toLocaleDateString() : 'never'}
                  </td>
                  <td className="py-2.5">
                    <ExpiryBadge expiresAt={secret.expires_at} status={secret.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      </>
      )}
    </div>
  );
}
