import { useState, type ReactNode } from 'react';
import { MdChevronRight, MdExpandMore } from 'react-icons/md';
import { Card } from '../ui';
import { DISPLAY_NAME_MAP, ROLE_DEPARTMENT, ROLE_TIER, ROLE_TITLE } from '../../lib/types';

export type GovernanceSurface = 'tool-view' | 'access-control' | 'policy-lab';
export type Platform = 'gcp' | 'm365' | 'github' | 'stripe' | 'vercel';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info' | 'good' | 'warning';

export interface RiskSummaryItem {
  key: string;
  title: string;
  value: string | number;
  subtitle?: string | null;
  severity: Severity;
  trend?: number | null;
  anchor?: string;
}

export interface GovernanceAction {
  id: string;
  type: string;
  title: string;
  summary: string;
  severity: Severity;
  createdAt: string | null;
  agentRole?: string | null;
  platform?: string | null;
  decisionId?: string | null;
  actionButtons: string[];
}

export interface GovernanceChangeItem {
  id: string;
  type: string;
  title: string;
  description: string;
  createdAt: string | null;
}

export interface TrustMapEntry {
  department: string;
  agentRole: string;
  displayName: string;
  trustScore: number;
}

export interface AccessPostureBreakdown {
  key: string;
  label: string;
  score: number;
}

export interface AccessPostureResponse {
  score: number | null;
  trend: number | null;
  summary: string | null;
  breakdown: AccessPostureBreakdown[];
}

export interface LeastPrivilegeGrant {
  id: string;
  department: string;
  agentRole: string;
  toolName: string;
  usesLast30d: number;
  daysSinceUse: number | null;
  recommendation: string | null;
}

export interface PolicyImpactItem {
  id: string;
  policyType: string;
  agentRole: string | null;
  version: number | null;
  status: string;
  evalScore: number | null;
  source: string | null;
  promotedAt: string | null;
  createdAt: string | null;
  metricLabel: string | null;
  beforeValue: number | string | null;
  afterValue: number | string | null;
  deltaPct: number | null;
  impactSummary: string | null;
  affectedAgents: string[];
  rollbackReason: string | null;
}

export interface ComplianceHeatmapCell {
  department: string;
  principle: string;
  avgScore: number;
}

export interface AmendmentProposal {
  id: string;
  agentRole: string;
  action: string;
  principleText: string;
  rationale: string | null;
  status: string;
  createdAt: string | null;
  failedEvalCount: number | null;
}

export interface IAMState {
  id: string;
  platform: string;
  credential_id: string;
  agent_role: string | null;
  permissions: Record<string, unknown>;
  desired_permissions: Record<string, unknown> | null;
  in_sync: boolean;
  drift_details: string | null;
  last_synced: string | null;
}

export interface SecretRotation {
  id: string;
  platform: string;
  secret_name: string;
  created_at: string;
  expires_at: string | null;
  rotated_at?: string | null;
  status: string;
}

export interface ToolGrant {
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

export interface ToolReputation {
  id: string;
  tool_name: string;
  tool_source: string;
  total_calls: number;
  successful_calls: number;
  failed_calls: number;
  timeout_calls: number;
  avg_latency_ms: number | null;
  downstream_defect_count: number;
  contradiction_count: number;
  last_used_at: string | null;
  last_failed_at: string | null;
  success_rate: number | null;
  reliability_score: number | null;
  is_active: boolean;
  expired_at: string | null;
  expiration_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PendingApproval {
  id: string;
  tier: string;
  status: string;
  title: string;
  summary: string;
  proposed_by: string;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface PolicyVersion {
  id: string;
  policy_type: string;
  agent_role: string | null;
  version: number;
  status: 'draft' | 'candidate' | 'canary' | 'active' | 'archived' | 'rolled_back' | 'superseded';
  eval_score: number | null;
  source: string | null;
  rollback_reason: string | null;
  promoted_at: string | null;
  created_at: string;
  content?: Record<string, unknown> | null;
}

export const ADMIN_EMAILS = [
  'kristina@glyphor.ai',
  'devops@glyphor.ai',
  'andrew@glyphor.ai',
  'andrew.zwelling@gmail.com',
];

export const AGENT_ROLES = Object.keys(DISPLAY_NAME_MAP).sort();

const DEPT_ORDER = [
  'Executive Office',
  'Engineering',
  'Product',
  'Finance',
  'Marketing',
  'Sales',
  'Design & Frontend',
  'Research & Intelligence',
  'Operations',
  'Operations & IT',
  'Legal',
  'People & Culture',
];

const TIER_PRIORITY: Record<string, number> = {
  Orchestrator: 0,
  Executive: 1,
  Specialist: 2,
  'Sub-Team': 3,
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  gcp: 'Google Cloud Platform',
  m365: 'Microsoft 365 / Entra ID',
  github: 'GitHub',
  stripe: 'Stripe',
  vercel: 'Vercel',
};

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: 'border-prism-critical/30 bg-prism-critical/10 text-prism-critical',
  high: 'border-prism-high/30 bg-prism-high/10 text-prism-high',
  medium: 'border-prism-elevated/30 bg-prism-elevated/10 text-prism-elevated',
  low: 'border-prism-sky/30 bg-prism-sky/10 text-prism-sky',
  info: 'border-border bg-prism-card text-txt-secondary',
  warning: 'border-prism-elevated/30 bg-prism-elevated/10 text-prism-elevated',
  good: 'border-prism-teal/30 bg-prism-teal/10 text-prism-teal',
};

export function getAgentsByDepartment(): { dept: string; roles: string[] }[] {
  const deptMap = new Map<string, string[]>();
  for (const role of AGENT_ROLES) {
    const dept = ROLE_DEPARTMENT[role] ?? 'Other';
    if (!deptMap.has(dept)) deptMap.set(dept, []);
    deptMap.get(dept)!.push(role);
  }

  for (const [, roles] of deptMap) {
    roles.sort((left, right) => {
      const leftPriority = TIER_PRIORITY[ROLE_TIER[left] ?? 'Sub-Team'] ?? 3;
      const rightPriority = TIER_PRIORITY[ROLE_TIER[right] ?? 'Sub-Team'] ?? 3;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return getDisplayName(left).localeCompare(getDisplayName(right));
    });
  }

  const ordered: { dept: string; roles: string[] }[] = [];
  for (const dept of DEPT_ORDER) {
    if (deptMap.has(dept)) {
      ordered.push({ dept, roles: deptMap.get(dept)! });
      deptMap.delete(dept);
    }
  }

  for (const [dept, roles] of deptMap) {
    ordered.push({ dept, roles });
  }

  return ordered;
}

export function normalizeSeverity(value: string | null | undefined): Severity {
  const normalized = (value ?? '').toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'critical') return 'critical';
  if (normalized === 'high') return 'high';
  if (normalized === 'medium') return 'medium';
  if (normalized === 'low') return 'low';
  if (normalized === 'good' || normalized === 'healthy' || normalized === 'success') return 'good';
  if (normalized === 'warning' || normalized === 'warn') return 'warning';
  return 'info';
}

export function getDisplayName(role: string | null | undefined): string {
  if (!role) return 'Unassigned';
  return DISPLAY_NAME_MAP[role] ?? role;
}

export function getRoleTitle(role: string | null | undefined): string {
  if (!role) return 'Unassigned';
  return ROLE_TITLE[role] ?? role;
}

export function toHumanWords(value: string): string {
  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => {
      if (['gcp', 'iam', 'seo', 'api', 'm365', 'llm', 'okr'].includes(part.toLowerCase())) {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

export function daysSince(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return `${normalized.toFixed(digits)}%`;
}

export function formatMetricValue(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') return value;
  if (Math.abs(value) >= 1000) return value.toLocaleString();
  if (Math.abs(value) >= 1) return value.toFixed(1).replace(/\.0$/, '');
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function getPlatformLabel(platform: string | null | undefined): string {
  if (!platform) return 'Unknown';
  return PLATFORM_LABELS[platform as Platform] ?? platform.toUpperCase();
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.18em] ${SEVERITY_STYLES[severity]}`}>
      {severity}
    </span>
  );
}

export function TrendPill({ value }: { value: number | null | undefined }) {
  if (value == null || Number.isNaN(value) || value === 0) {
    return <span className="text-[11px] text-txt-muted">—</span>;
  }
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  const positive = normalized > 0;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${positive ? 'bg-prism-critical/10 text-prism-critical' : 'bg-prism-teal/10 text-prism-teal'}`}>
      {positive ? '↑' : '↓'} {Math.abs(normalized).toFixed(0)}%
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 bg-prism-card/60 p-5">
        <div>
          <p className="text-sm font-semibold text-txt-primary">{title}</p>
          <p className="mt-1 text-[13px] text-txt-muted">{description}</p>
        </div>
        {action}
      </div>
    </Card>
  );
}

export function CollapsibleCard({
  title,
  subtitle,
  defaultOpen = false,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="overflow-hidden p-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 text-prism-sky">
            {open ? <MdExpandMore className="text-[18px]" /> : <MdChevronRight className="text-[18px]" />}
          </span>
          <div>
            <p className="text-sm font-semibold text-txt-primary">{title}</p>
            {subtitle && <p className="mt-1 text-[12px] text-txt-muted">{subtitle}</p>}
          </div>
        </div>
        {action}
      </button>
      {open && <div className="border-t border-border/70 px-5 py-5">{children}</div>}
    </Card>
  );
}
