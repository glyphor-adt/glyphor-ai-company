import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, PageTabs, SectionHeader, Skeleton } from '../components/ui';
import CommandCenter from '../components/governance/CommandCenter';
import AccessControl from '../components/governance/AccessControl';
import PolicyLab from '../components/governance/PolicyLab';
import ToolView from '../components/governance/ToolView';
import {
  ADMIN_EMAILS,
  AccessPostureResponse,
  AmendmentProposal,
  ComplianceHeatmapCell,
  GovernanceAction,
  GovernanceChangeItem,
  GovernanceSurface,
  IAMState,
  LeastPrivilegeGrant,
  PendingApproval,
  PolicyImpactItem,
  PolicyVersion,
  RiskSummaryItem,
  SecretRotation,
  ToolGrant,
  ToolReputation,
  TrustMapEntry,
  getDisplayName,
  normalizeSeverity,
  toHumanWords,
} from '../components/governance/shared';
import { useAuth } from '../lib/auth';
import { apiCall, SCHEDULER_URL } from '../lib/firebase';
import { ROLE_DEPARTMENT } from '../lib/types';

type UnknownRecord = Record<string, unknown>;

interface GovernanceData {
  riskSummary: RiskSummaryItem[];
  actionQueue: GovernanceAction[];
  changeLog: GovernanceChangeItem[];
  trustMap: TrustMapEntry[];
  accessPosture: AccessPostureResponse | null;
  leastPrivilege: LeastPrivilegeGrant[];
  iamState: IAMState[];
  secrets: SecretRotation[];
  grants: ToolGrant[];
  toolReputation: ToolReputation[];
  pendingApprovals: PendingApproval[];
  policyImpact: PolicyImpactItem[];
  complianceHeatmap: ComplianceHeatmapCell[];
  amendments: AmendmentProposal[];
  policyVersions: PolicyVersion[];
}

const INITIAL_DATA: GovernanceData = {
  riskSummary: [],
  actionQueue: [],
  changeLog: [],
  trustMap: [],
  accessPosture: null,
  leastPrivilege: [],
  iamState: [],
  secrets: [],
  grants: [],
  toolReputation: [],
  pendingApprovals: [],
  policyImpact: [],
  complianceHeatmap: [],
  amendments: [],
  policyVersions: [],
};

const RISK_CARD_DEFAULTS = [
  { key: 'trust-alerts', title: 'Trust Alerts', anchor: 'action-queue' },
  { key: 'drift-alerts', title: 'Drift Alerts', anchor: 'action-queue' },
  { key: 'access-risk', title: 'Access Risk', anchor: 'access-control' },
  { key: 'policy-health', title: 'Policy Health', anchor: 'policy-lab' },
  { key: 'compliance', title: 'Compliance', anchor: 'policy-lab' },
];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return null;
}

function asDisplayValue(value: unknown): string | number | null {
  if (typeof value === 'string' || typeof value === 'number') return value;
  return null;
}

function getRecordList(raw: unknown): UnknownRecord[] {
  if (Array.isArray(raw)) return raw.filter(isRecord);
  if (!isRecord(raw)) return [];

  for (const key of ['items', 'data', 'rows', 'results', 'cards']) {
    const candidate = raw[key];
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }

  return [];
}

function getObjectOrFirst(raw: unknown): UnknownRecord | null {
  if (isRecord(raw)) return raw;
  const list = getRecordList(raw);
  return list[0] ?? null;
}

function getValue(record: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function getActions(raw: unknown, type: string): string[] {
  const recordActions = isRecord(raw) ? raw.actions : undefined;
  const source: unknown[] = Array.isArray(recordActions)
    ? recordActions
    : Array.isArray((raw as UnknownRecord | undefined)?.action_labels)
      ? ((raw as UnknownRecord).action_labels as unknown[])
      : [];
  const labels = source
    .map((item: unknown) => isRecord(item) ? asString(item.label) : asString(item))
    .filter((value: string | null): value is string => Boolean(value));

  if (labels.length) return labels;

  if (/^decision$|authority/i.test(type)) return ['Approve', 'Reject', 'View History'];
  if (/canary/i.test(type)) return ['Review Policy'];
  if (/trust/i.test(type)) return ['Review Agent', 'Investigate'];
  if (/secret/i.test(type)) return ['View Rotation Plan'];
  if (/grant|access|iam/i.test(type)) return ['Review Access'];
  if (/policy|amend|constitutional/i.test(type)) return ['Review Policy'];
  return ['Investigate'];
}

function normalizeRiskSummary(raw: unknown): RiskSummaryItem[] {
  const list = getRecordList(raw);

  if (list.length) {
    return list.map((item, index) => {
      const fallback = RISK_CARD_DEFAULTS[index] ?? {
        key: `risk-${index}`,
        title: `Risk ${index + 1}`,
        anchor: 'action-queue',
      };
      const value = getValue(item, ['value', 'count', 'score', 'rate', 'metric']) ?? '—';
      return {
        key: asString(getValue(item, ['key', 'slug', 'id'])) ?? fallback.key,
        title: asString(getValue(item, ['title', 'label', 'name'])) ?? fallback.title,
        value: typeof value === 'number' || typeof value === 'string' ? value : '—',
        subtitle: asString(getValue(item, ['subtitle', 'description', 'summary', 'detail'])),
        severity: normalizeSeverity(asString(getValue(item, ['severity', 'status', 'tone']))),
        trend: asNumber(getValue(item, ['trend', 'trend_pct', 'delta', 'change'])),
        anchor: asString(getValue(item, ['anchor'])) ?? fallback.anchor,
      };
    });
  }

  if (!isRecord(raw)) return [];

  return RISK_CARD_DEFAULTS.flatMap((card) => {
    const candidate = raw[card.key] ?? raw[card.key.replace(/-/g, '_')];
    if (!isRecord(candidate)) return [];
    const value = getValue(candidate, ['value', 'count', 'score', 'rate']) ?? '—';
    return [{
      key: card.key,
      title: asString(getValue(candidate, ['title', 'label'])) ?? card.title,
      value: typeof value === 'number' || typeof value === 'string' ? value : '—',
      subtitle: asString(getValue(candidate, ['subtitle', 'description', 'summary'])),
      severity: normalizeSeverity(asString(getValue(candidate, ['severity', 'status']))),
      trend: asNumber(getValue(candidate, ['trend', 'trend_pct', 'delta'])),
      anchor: card.anchor,
    }];
  });
}

function normalizeActionQueue(raw: unknown): GovernanceAction[] {
  return getRecordList(raw).map((item, index) => {
    const type = asString(getValue(item, ['type', 'action_type', 'kind'])) ?? `action-${index}`;
    const metadata = isRecord(item.metadata) ? item.metadata : null;
    const decisionId = asString(getValue(item, ['decision_id', 'source_id'])) ?? (metadata ? asString(getValue(metadata, ['decision_id', 'source_id'])) : null);
    const derivedId =
      asString(getValue(item, ['id', 'source_id']))
      ?? (metadata ? asString(getValue(metadata, ['decision_id', 'drift_alert_id', 'authority_proposal_id', 'policy_id'])) : null)
      ?? `${type}-${index}`;
    return {
      id: derivedId,
      type,
      title: asString(getValue(item, ['title', 'headline', 'label'])) ?? toHumanWords(type),
      summary: asString(getValue(item, ['summary', 'description', 'impact', 'detail', 'rationale'])) ?? 'Awaiting additional governance context.',
      severity: normalizeSeverity(asString(getValue(item, ['severity', 'tier', 'status']))),
      createdAt: asString(getValue(item, ['created_at', 'timestamp', 'detected_at', 'updated_at'])),
      agentRole: asString(getValue(item, ['agent_role', 'role', 'subject_role'])),
      platform: asString(getValue(item, ['platform'])) ?? (metadata ? asString(getValue(metadata, ['platform'])) : null),
      decisionId: decisionId,
      actionButtons: getActions(item, type),
    };
  });
}

function normalizeChangeLog(raw: unknown): GovernanceChangeItem[] {
  return getRecordList(raw).map((item, index) => ({
    id: asString(getValue(item, ['id', 'event_id'])) ?? `change-${index}`,
    type: asString(getValue(item, ['type', 'event_type'])) ?? 'event',
    title: asString(getValue(item, ['title', 'headline', 'summary'])) ?? 'Governance event',
    description: asString(getValue(item, ['description', 'detail', 'summary'])) ?? 'No event detail returned.',
    createdAt: asString(getValue(item, ['created_at', 'timestamp', 'updated_at'])),
  }));
}

function normalizeTrustMap(raw: unknown): TrustMapEntry[] {
  const directRows = getRecordList(raw);
  if (directRows.length) {
    return directRows.map((item) => ({
      department: asString(getValue(item, ['department'])) ?? 'Other',
      agentRole: asString(getValue(item, ['agent_role', 'role'])) ?? 'unknown',
      displayName: asString(getValue(item, ['display_name', 'name'])) ?? getDisplayName(asString(getValue(item, ['agent_role', 'role']))),
      trustScore: asNumber(getValue(item, ['trust_score', 'score'])) ?? 0,
    }));
  }

  if (!isRecord(raw)) return [];

  return Object.entries(raw).flatMap(([department, value]) => {
    if (!Array.isArray(value)) return [];
    return value.filter(isRecord).map((item) => ({
      department,
      agentRole: asString(getValue(item, ['agent_role', 'role'])) ?? 'unknown',
      displayName: asString(getValue(item, ['display_name', 'name'])) ?? getDisplayName(asString(getValue(item, ['agent_role', 'role']))),
      trustScore: asNumber(getValue(item, ['trust_score', 'score'])) ?? 0,
    }));
  });
}

function normalizeAccessPosture(raw: unknown): AccessPostureResponse | null {
  const record = getObjectOrFirst(raw);
  if (!record) return null;

  const breakdownSource = getRecordList(record.breakdown);
  const breakdownRecord = isRecord(record.breakdown) ? record.breakdown : null;
  const breakdown = breakdownSource.length
    ? breakdownSource.map((item, index) => ({
      key: asString(getValue(item, ['key', 'slug', 'id'])) ?? `breakdown-${index}`,
      label: asString(getValue(item, ['label', 'title', 'name'])) ?? `Breakdown ${index + 1}`,
      score: asNumber(getValue(item, ['score', 'value', 'rate'])) ?? 0,
    }))
    : [
      ['iam_sync_rate', 'IAM Sync'],
      ['secret_health_rate', 'Secret Health'],
      ['grant_freshness_rate', 'Grant Freshness'],
      ['least_privilege_score', 'Least Privilege'],
    ].flatMap(([key, label]) => (breakdownRecord?.[key] ?? record[key]) == null ? [] : [{
      key,
      label,
      score: asNumber(breakdownRecord?.[key] ?? record[key]) ?? 0,
    }]);

  const issues = getRecordList(record.issues);
  const summary = asString(getValue(record, ['summary', 'description']))
    ?? (issues.length
      ? `${issues.length} access issue${issues.length === 1 ? '' : 's'} require review across IAM, secrets, and grants.`
      : 'Composite health across IAM sync, secret hygiene, grant freshness, and least-privilege fit.');

  return {
    score: asNumber(getValue(record, ['score', 'posture_score', 'value'])),
    trend: asNumber(getValue(record, ['trend', 'trend_pct', 'delta', 'trend_vs_7d'])),
    summary,
    breakdown,
  };
}

function normalizeLeastPrivilege(raw: unknown): LeastPrivilegeGrant[] {
  return getRecordList(raw).flatMap((item, index) => {
    const agentRole = asString(getValue(item, ['agent_role', 'role'])) ?? 'unknown';
    const department = asString(getValue(item, ['department'])) ?? ROLE_DEPARTMENT[agentRole] ?? 'Other';
    const grants = Array.isArray(item.grants)
      ? item.grants.filter(isRecord)
      : [item];

    return grants.map((grant, grantIndex) => {
      const toolName = asString(getValue(grant, ['tool_name', 'tool'])) ?? 'unknown_tool';
      const severity = asString(getValue(grant, ['severity']));
      const recommendation =
        asString(getValue(grant, ['recommendation', 'recommended_action']))
        ?? (severity === 'high'
          ? 'Revoke or require explicit approval'
          : severity === 'medium'
            ? 'Review scope and expiration'
            : 'Monitor usage');

      return {
        id: asString(getValue(grant, ['id'])) ?? `${agentRole}-${toolName}-${index}-${grantIndex}`,
        department,
        agentRole,
        toolName,
        usesLast30d: asNumber(getValue(grant, ['uses_last_30d', 'usage_count', 'uses'])) ?? 0,
        daysSinceUse: asNumber(getValue(grant, ['days_since_use', 'days_since_last_use'])),
        recommendation,
      };
    });
  });
}

function normalizePolicyImpact(raw: unknown): PolicyImpactItem[] {
  return getRecordList(raw).map((item, index) => ({
    id: asString(getValue(item, ['id', 'policy_id'])) ?? `policy-impact-${index}`,
    policyType: asString(getValue(item, ['policy_type', 'type'])) ?? 'policy',
    agentRole: asString(getValue(item, ['agent_role', 'role'])),
    version: asNumber(getValue(item, ['version'])),
    status: asString(getValue(item, ['status'])) ?? 'unknown',
    evalScore: asNumber(getValue(item, ['eval_score', 'score'])),
    source: asString(getValue(item, ['source'])),
    promotedAt: asString(getValue(item, ['promoted_at', 'activated_at'])),
    createdAt: asString(getValue(item, ['created_at'])),
    metricLabel: asString(getValue(item, ['metric_label', 'metric', 'metric_name'])),
    beforeValue: asDisplayValue(getValue(item, ['before_value', 'before', 'baseline'])),
    afterValue: asDisplayValue(getValue(item, ['after_value', 'after', 'current'])),
    deltaPct: asNumber(getValue(item, ['delta_pct', 'delta_percent'])),
    impactSummary: asString(getValue(item, ['impact_summary', 'summary', 'description'])),
    affectedAgents: Array.isArray(item.affected_agents)
      ? item.affected_agents.map(asString).filter((value): value is string => Boolean(value))
      : [],
    rollbackReason: asString(getValue(item, ['rollback_reason'])),
  }));
}

function normalizeComplianceHeatmap(raw: unknown): ComplianceHeatmapCell[] {
  return getRecordList(raw).map((item) => ({
    department: asString(getValue(item, ['department'])) ?? 'Other',
    principle: asString(getValue(item, ['principle', 'category'])) ?? 'general',
    avgScore: asNumber(getValue(item, ['avg_score', 'score', 'value'])) ?? 0,
  }));
}

function normalizeAmendments(raw: unknown): AmendmentProposal[] {
  return getRecordList(raw).map((item, index) => ({
    id: asString(getValue(item, ['id', 'amendment_id'])) ?? `amendment-${index}`,
    agentRole: asString(getValue(item, ['agent_role', 'role', 'proposed_by'])) ?? 'unknown',
    action: asString(getValue(item, ['action'])) ?? (isRecord(item.metadata) ? asString(getValue(item.metadata, ['action'])) : null) ?? 'modify',
    principleText: asString(getValue(item, ['proposed_change', 'principle_text', 'principle_name', 'title', 'summary'])) ?? 'Proposed constitutional amendment',
    rationale: asString(getValue(item, ['rationale', 'reason'])),
    status: asString(getValue(item, ['status'])) ?? 'proposed',
    createdAt: asString(getValue(item, ['created_at', 'proposed_at'])),
    failedEvalCount: asNumber(getValue(item, ['failed_eval_count', 'failed_evals', 'failed_evals_count'])),
  }));
}

function normalizeIamState(raw: unknown): IAMState[] {
  return getRecordList(raw).map((item, index) => ({
    id: asString(getValue(item, ['id'])) ?? `iam-${index}`,
    platform: asString(getValue(item, ['platform'])) ?? 'unknown',
    credential_id: asString(getValue(item, ['credential_id'])) ?? 'unknown',
    agent_role: asString(getValue(item, ['agent_role', 'role'])),
    permissions: isRecord(item.permissions) ? item.permissions : {},
    desired_permissions: isRecord(item.desired_permissions) ? item.desired_permissions : null,
    in_sync: asBoolean(getValue(item, ['in_sync'])) ?? false,
    drift_details: asString(getValue(item, ['drift_details'])),
    last_synced: asString(getValue(item, ['last_synced', 'updated_at'])),
  }));
}

function normalizeSecrets(raw: unknown): SecretRotation[] {
  return getRecordList(raw).map((item, index) => ({
    id: asString(getValue(item, ['id'])) ?? `secret-${index}`,
    platform: asString(getValue(item, ['platform'])) ?? 'unknown',
    secret_name: asString(getValue(item, ['secret_name', 'name'])) ?? 'unknown_secret',
    created_at: asString(getValue(item, ['created_at'])) ?? new Date(0).toISOString(),
    expires_at: asString(getValue(item, ['expires_at'])),
    rotated_at: asString(getValue(item, ['rotated_at'])),
    status: asString(getValue(item, ['status'])) ?? 'active',
  }));
}

function normalizeGrants(raw: unknown): ToolGrant[] {
  return getRecordList(raw).map((item, index) => ({
    id: asString(getValue(item, ['id'])) ?? `grant-${index}`,
    agent_role: asString(getValue(item, ['agent_role'])) ?? 'unknown',
    tool_name: asString(getValue(item, ['tool_name'])) ?? 'unknown_tool',
    granted_by: asString(getValue(item, ['granted_by'])) ?? 'system',
    reason: asString(getValue(item, ['reason'])),
    scope: asString(getValue(item, ['scope'])) ?? 'full',
    is_active: asBoolean(getValue(item, ['is_active'])) ?? true,
    expires_at: asString(getValue(item, ['expires_at'])),
    created_at: asString(getValue(item, ['created_at'])) ?? new Date(0).toISOString(),
    updated_at: asString(getValue(item, ['updated_at'])) ?? new Date(0).toISOString(),
  }));
}

function normalizeToolReputation(raw: unknown): ToolReputation[] {
  return getRecordList(raw).map((item, index) => ({
    id: asString(getValue(item, ['id'])) ?? `tool-reputation-${index}`,
    tool_name: asString(getValue(item, ['tool_name'])) ?? 'unknown_tool',
    tool_source: asString(getValue(item, ['tool_source', 'source'])) ?? 'unknown',
    total_calls: asNumber(getValue(item, ['total_calls'])) ?? 0,
    successful_calls: asNumber(getValue(item, ['successful_calls'])) ?? 0,
    failed_calls: asNumber(getValue(item, ['failed_calls'])) ?? 0,
    timeout_calls: asNumber(getValue(item, ['timeout_calls'])) ?? 0,
    avg_latency_ms: asNumber(getValue(item, ['avg_latency_ms'])),
    downstream_defect_count: asNumber(getValue(item, ['downstream_defect_count', 'defect_count'])) ?? 0,
    contradiction_count: asNumber(getValue(item, ['contradiction_count'])) ?? 0,
    last_used_at: asString(getValue(item, ['last_used_at'])),
    last_failed_at: asString(getValue(item, ['last_failed_at'])),
    success_rate: asNumber(getValue(item, ['success_rate'])),
    reliability_score: asNumber(getValue(item, ['reliability_score'])),
    is_active: asBoolean(getValue(item, ['is_active'])) ?? true,
    expired_at: asString(getValue(item, ['expired_at'])),
    expiration_reason: asString(getValue(item, ['expiration_reason'])),
    created_at: asString(getValue(item, ['created_at'])) ?? new Date(0).toISOString(),
    updated_at: asString(getValue(item, ['updated_at'])) ?? new Date(0).toISOString(),
  }));
}

function normalizePendingApprovals(raw: unknown): PendingApproval[] {
  return getRecordList(raw).map((item, index) => ({
    id: asString(getValue(item, ['id'])) ?? `approval-${index}`,
    tier: asString(getValue(item, ['tier'])) ?? 'yellow',
    status: asString(getValue(item, ['status'])) ?? 'pending',
    title: asString(getValue(item, ['title'])) ?? 'Pending approval',
    summary: asString(getValue(item, ['summary'])) ?? 'No summary provided.',
    proposed_by: asString(getValue(item, ['proposed_by'])) ?? 'unknown',
    data: isRecord(item.data) ? item.data : null,
    created_at: asString(getValue(item, ['created_at'])) ?? new Date(0).toISOString(),
  }));
}

function normalizePolicyVersions(raw: unknown): PolicyVersion[] {
  return getRecordList(raw).map((item, index) => ({
    id: asString(getValue(item, ['id'])) ?? `policy-${index}`,
    policy_type: asString(getValue(item, ['policy_type', 'type'])) ?? 'policy',
    agent_role: asString(getValue(item, ['agent_role'])),
    version: asNumber(getValue(item, ['version'])) ?? 1,
    status: (asString(getValue(item, ['status'])) as PolicyVersion['status']) ?? 'draft',
    eval_score: asNumber(getValue(item, ['eval_score'])),
    source: asString(getValue(item, ['source'])),
    rollback_reason: asString(getValue(item, ['rollback_reason'])),
    promoted_at: asString(getValue(item, ['promoted_at'])),
    created_at: asString(getValue(item, ['created_at'])) ?? new Date(0).toISOString(),
    content: isRecord(item.content) ? item.content : null,
  }));
}

async function fetchWithFallback(paths: string[]): Promise<unknown> {
  let lastError: unknown = null;
  for (const path of paths) {
    try {
      return await apiCallWithTimeout<unknown>(path);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

const GOVERNANCE_REQUEST_TIMEOUT_MS = 5000;

async function apiCallWithTimeout<T = unknown>(path: string, options: RequestInit = {}, timeoutMs = GOVERNANCE_REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await apiCall<T>(path, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export default function Governance() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<GovernanceSurface>('command-center');
  const [data, setData] = useState<GovernanceData>(INITIAL_DATA);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [collectingPolicy, setCollectingPolicy] = useState(false);
  const [evaluatingPolicy, setEvaluatingPolicy] = useState(false);
  const [collectResult, setCollectResult] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<string | null>(null);
  const [busyDecisionId, setBusyDecisionId] = useState<string | null>(null);

  const isAdmin = user?.email ? ADMIN_EMAILS.includes(user.email.toLowerCase()) : false;

  const refresh = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode === 'initial') {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const [
        riskSummaryRaw,
        actionQueueRaw,
        changeLogRaw,
        trustMapRaw,
        accessPostureRaw,
        leastPrivilegeRaw,
        iamStateRaw,
        secretsRaw,
        grantsRaw,
        toolReputationRaw,
        approvalsRaw,
        policyImpactRaw,
        complianceRaw,
        amendmentsRaw,
        policyVersionsRaw,
      ] = await Promise.all([
        fetchWithFallback(['/api/governance/risk-summary']).catch(() => null),
        fetchWithFallback(['/api/governance/action-queue']).catch(() => null),
        fetchWithFallback(['/api/governance/changelog?days=7']).catch(() => null),
        fetchWithFallback(['/api/governance/trust-map']).catch(() => null),
        fetchWithFallback(['/api/governance/access-posture']).catch(() => null),
        fetchWithFallback(['/api/governance/least-privilege', '/api/governance/least-privilege-analysis']).catch(() => null),
        apiCallWithTimeout('/api/platform-iam-state').catch(() => null),
        apiCallWithTimeout('/api/platform-secret-rotation').catch(() => null),
        apiCallWithTimeout('/api/agent-tool-grants?order=agent_role.asc,tool_name.asc').catch(() => null),
        apiCallWithTimeout('/api/tool-reputation?order=updated_at.desc&limit=200').catch(() => null),
        apiCallWithTimeout('/api/decisions?status=pending&order=created_at.desc&limit=20').catch(() => null),
        fetchWithFallback(['/api/governance/policy-impact']).catch(() => null),
        fetchWithFallback(['/api/governance/compliance-heatmap']).catch(() => null),
        fetchWithFallback(['/api/governance/amendments']).catch(() => null),
        apiCallWithTimeout('/api/policy_versions?limit=200').catch(() => null),
      ]);

      setData({
        riskSummary: normalizeRiskSummary(riskSummaryRaw),
        actionQueue: normalizeActionQueue(actionQueueRaw),
        changeLog: normalizeChangeLog(changeLogRaw),
        trustMap: normalizeTrustMap(trustMapRaw),
        accessPosture: normalizeAccessPosture(accessPostureRaw),
        leastPrivilege: normalizeLeastPrivilege(leastPrivilegeRaw),
        iamState: normalizeIamState(iamStateRaw),
        secrets: normalizeSecrets(secretsRaw),
        grants: normalizeGrants(grantsRaw),
        toolReputation: normalizeToolReputation(toolReputationRaw),
        pendingApprovals: normalizePendingApprovals(approvalsRaw),
        policyImpact: normalizePolicyImpact(policyImpactRaw),
        complianceHeatmap: normalizeComplianceHeatmap(complianceRaw),
        amendments: normalizeAmendments(amendmentsRaw),
        policyVersions: normalizePolicyVersions(policyVersionsRaw),
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh('initial');
  }, [refresh]);

  const handleResolveApproval = useCallback(async (id: string, approve: boolean) => {
    setBusyDecisionId(id);
    try {
      await apiCall(`/api/decisions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: approve ? 'approved' : 'rejected',
          resolved_by: user?.email ?? 'dashboard',
          resolved_at: new Date().toISOString(),
        }),
      });
      await refresh();
    } finally {
      setBusyDecisionId(null);
    }
  }, [refresh, user?.email]);

  const handleGrant = useCallback(async (input: { agentRole: string; toolName: string; reason: string; expiresAt: string | null }) => {
    await apiCall('/api/agent-tool-grants', {
      method: 'POST',
      body: JSON.stringify({
        agent_role: input.agentRole,
        tool_name: input.toolName,
        granted_by: user?.email ?? 'dashboard',
        reason: input.reason || null,
        expires_at: input.expiresAt,
      }),
    });
    await refresh();
  }, [refresh, user?.email]);

  const handleRevoke = useCallback(async (grant: ToolGrant) => {
    await apiCall(`/api/agent-tool-grants/${grant.id}`, { method: 'DELETE' });
    await refresh();
  }, [refresh]);

  const collectPolicies = useCallback(async () => {
    setCollectingPolicy(true);
    setCollectResult(null);
    try {
      await fetch(`${SCHEDULER_URL}/policy/collect`, { method: 'POST' });
      setCollectResult('success');
    } catch {
      setCollectResult('error');
    } finally {
      setCollectingPolicy(false);
      await refresh();
    }
  }, [refresh]);

  const evaluatePolicies = useCallback(async () => {
    setEvaluatingPolicy(true);
    setEvalResult(null);
    try {
      await fetch(`${SCHEDULER_URL}/policy/evaluate`, { method: 'POST' });
      setEvalResult('success');
    } catch {
      setEvalResult('error');
    } finally {
      setEvaluatingPolicy(false);
      await refresh();
    }
  }, [refresh]);

  if (loading) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Governance Control Plane" subtitle="Loading command center, tool view, access posture, and policy lab surfaces…" />
        {[1, 2, 3].map((index) => <Skeleton key={index} className="h-48 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <SectionHeader
            title="Governance Control Plane"
            subtitle="Executive Command Center, restored Tool View, Access Control, and Policy Lab surfaces aligned to the overhaul architecture."
          />
          <Card className="max-w-3xl border-prism-sky/20 bg-prism-sky/5">
            <p className="text-[13px] text-txt-secondary">
              Tool-health visibility has been restored inside Governance via Tool View.
              {' '}
              <Link to="/operations" className="font-medium text-prism-sky hover:underline">
                Open Operations
              </Link>
              {' '}for audit logs, reliability traces, and scheduler health.
            </p>
          </Card>
        </div>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={refreshing}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-[13px] font-medium text-txt-secondary transition-colors hover:border-border-hover hover:text-txt-primary disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <PageTabs<GovernanceSurface>
        tabs={[
          { key: 'command-center', label: 'Command Center' },
          { key: 'tool-view', label: 'Tool View' },
          { key: 'access-control', label: 'Access Control' },
          { key: 'policy-lab', label: 'Policy Lab' },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === 'command-center' && (
        <CommandCenter
          loading={false}
          riskSummary={data.riskSummary}
          actionQueue={data.actionQueue}
          changeLog={data.changeLog}
          trustMap={data.trustMap}
          onOpenSurface={setActiveTab}
          onResolveDecision={handleResolveApproval}
          busyDecisionId={busyDecisionId}
        />
      )}

      {activeTab === 'tool-view' && (
        <div id="tool-view">
          <ToolView
            loading={false}
            toolReputation={data.toolReputation}
            grants={data.grants}
            onOpenSurface={setActiveTab}
          />
        </div>
      )}

      {activeTab === 'access-control' && (
        <div id="access-control">
          <AccessControl
            loading={false}
            accessPosture={data.accessPosture}
            actionQueue={data.actionQueue}
            leastPrivilege={data.leastPrivilege}
            iamState={data.iamState}
            secrets={data.secrets}
            grants={data.grants}
            pendingApprovals={data.pendingApprovals}
            isAdmin={isAdmin}
            currentUserEmail={user?.email ?? null}
            busyDecisionId={busyDecisionId}
            onGrant={handleGrant}
            onRevoke={handleRevoke}
            onResolveApproval={handleResolveApproval}
          />
        </div>
      )}

      {activeTab === 'policy-lab' && (
        <div id="policy-lab">
          <PolicyLab
            loading={false}
            policyImpact={data.policyImpact}
            complianceHeatmap={data.complianceHeatmap}
            amendments={data.amendments}
            policyVersions={data.policyVersions}
            collecting={collectingPolicy}
            evaluating={evaluatingPolicy}
            collectResult={collectResult}
            evalResult={evalResult}
            onCollect={collectPolicies}
            onEvaluate={evaluatePolicies}
          />
        </div>
      )}
    </div>
  );
}
