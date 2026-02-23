import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { DISPLAY_NAME_MAP } from '../lib/types';
import { Card, SectionHeader, Skeleton, timeAgo } from '../components/ui';

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
          className="flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {open ? '▼' : '▶'}
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
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] dark:bg-white/8">
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
                    <span key={s} className="mr-1.5 inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-400">
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
                    <span key={r} className="mr-1.5 inline-block rounded bg-purple-50 px-1.5 py-0.5 text-[11px] font-medium text-purple-700 dark:bg-purple-500/15 dark:text-purple-400">
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
                    <span key={s} className="mr-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-white/8 dark:text-slate-400">
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
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
      ✓ Synced
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
      ⚠ Drift
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
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-500/15 dark:text-red-400">
        Expired
      </span>
    );
  }
  if (days <= 90) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
        ⚠ {days}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
      ✓ {days}d
    </span>
  );
}

/* ── Page ─────────────────────────────────── */

export default function Governance() {
  const [iamState, setIamState] = useState<IAMState[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [secrets, setSecrets] = useState<SecretRotation[]>([]);
  const [loading, setLoading] = useState(true);

  // Audit log filters
  const [filterPlatform, setFilterPlatform] = useState<string>('all');
  const [filterAgent, setFilterAgent] = useState<string>('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    const [iamRes, auditRes, secretsRes] = await Promise.all([
      supabase.from('platform_iam_state').select('*').order('platform'),
      supabase.from('platform_audit_log').select('*').order('timestamp', { ascending: false }).limit(50),
      supabase.from('platform_secret_rotation').select('*').order('platform'),
    ]);
    setIamState((iamRes.data as IAMState[]) ?? []);
    setAuditLog((auditRes.data as AuditEntry[]) ?? []);
    setSecrets((secretsRes.data as SecretRotation[]) ?? []);
    setLoading(false);
  }, []);

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
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-100 text-lg dark:bg-rose-500/15">
            🔐
          </span>
          <div>
            <h1 className="text-xl font-bold text-txt-primary">Platform Governance</h1>
            <p className="text-[13px] text-txt-muted">
              Platform-level access control, drift detection, and audit trail
            </p>
          </div>
        </div>
        <button
          onClick={loadData}
          className="rounded-lg border border-border bg-white px-4 py-2 text-[13px] font-medium text-txt-primary shadow-sm transition-colors hover:bg-slate-50 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
        >
          Run Audit Now
        </button>
      </div>

      {/* Drift Alerts */}
      {(driftItems.length > 0 || expiringSecrets.length > 0) && (
        <Card className="border-amber-200 dark:border-amber-500/30">
          <SectionHeader
            title={`Drift Alerts — ${driftItems.length + expiringSecrets.length} issue${driftItems.length + expiringSecrets.length !== 1 ? 's' : ''} detected`}
          />
          <div className="space-y-3">
            {driftItems.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/20 dark:bg-amber-500/5"
              >
                <span className="mt-0.5 text-amber-500">⚠️</span>
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-txt-primary">
                    <code className="rounded bg-white/50 px-1 text-[12px] dark:bg-white/10">{item.credential_id}</code>
                    {' '}has unexpected permissions
                  </p>
                  {item.drift_details && (
                    <p className="mt-1 text-[12px] text-txt-muted">{item.drift_details}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="rounded border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-50 dark:bg-white/5 dark:text-amber-400 dark:border-amber-500/30">
                    Details
                  </button>
                </div>
              </div>
            ))}
            {expiringSecrets.map((secret) => (
              <div
                key={secret.id}
                className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/20 dark:bg-amber-500/5"
              >
                <span className="mt-0.5 text-amber-500">🔑</span>
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-txt-primary">
                    Secret <code className="rounded bg-white/50 px-1 text-[12px] dark:bg-white/10">{secret.secret_name}</code>
                    {' '}expires in {daysUntil(secret.expires_at)} days
                  </p>
                </div>
                <button className="rounded border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-50 dark:bg-white/5 dark:text-amber-400 dark:border-amber-500/30">
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
        if (items.length === 0) return null;
        return (
          <CollapsibleSection
            key={platform}
            title={PLATFORM_LABELS[platform]}
            color={PLATFORM_COLORS[platform]}
            defaultOpen={platform === 'gcp' || platform === 'm365'}
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
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-white/8 dark:text-slate-400">
                        {entry.platform.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-txt-muted">{entry.action}</td>
                    <td className="py-2">
                      {entry.response_code ? (
                        entry.response_code < 400 ? (
                          <span className="text-emerald-600 dark:text-emerald-400">{entry.response_code} ✓</span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400">{entry.response_code} ✗</span>
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
          <span>📊 {todayAudit.length} calls today</span>
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
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] dark:bg-white/8">
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
    </div>
  );
}
