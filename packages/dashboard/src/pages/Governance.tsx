import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, PageTabs, SectionHeader, Skeleton } from '../components/ui';
import AccessControl from '../components/governance/AccessControl';
import AutonomyDashboard from '../components/governance/AutonomyDashboard';
import AuthorityControl from '../components/governance/AuthorityControl';
import ReliabilityDashboard from '../components/governance/ReliabilityDashboard';
import EnterpriseKpiDashboard from '../components/governance/EnterpriseKpiDashboard';
import ToolView from '../components/governance/ToolView';
import ModelAdmin from './ModelAdmin';
import {
  ADMIN_EMAILS,
  AccessPostureResponse,
  AgentCapacityConfig,
  CommitmentRegistryEntry,
  GovernanceAction,
  GovernanceChangeItem,
  GovernanceSurface,
  IAMState,
  LeastPrivilegeGrant,
  PendingApproval,
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
import { apiCall } from '../lib/firebase';
import { useAgents } from '../lib/hooks';
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
}

interface PlanningGateRoleSummary {
  role: string;
  runsObserved: number;
  runsWithPlanning: number;
  runsWithGatePass: number;
  runsWithGateFail: number;
  planningEvents: number;
  gatePassEvents: number;
  gateFailEvents: number;
  maxRetryAttempt: number;
  avgMissingCriteriaMentions: number;
  passRate: number;
}

interface PlanningGateSnapshot {
  windowDays: number;
  totals: {
    runsObserved: number;
    runsWithPlanning: number;
    runsWithGatePass: number;
    runsWithGateFail: number;
    planningEvents: number;
    gatePassEvents: number;
    gateFailEvents: number;
    maxRetryAttempt: number;
    avgMissingCriteriaMentions: number;
    passRate: number;
  };
  roles: PlanningGateRoleSummary[];
}

interface PlanningGateRoleAnomaly {
  kind: 'below_slo_7d' | 'regression_7d_vs_30d';
  role: string;
  message: string;
  passRate7d: number;
  passRate30d: number | null;
  runsWithPlanning7d: number;
  dropPp: number | null;
}

interface PlanningGateHealthSnapshot {
  status: 'green' | 'yellow' | 'red';
  evaluatedAt: string;
  report: {
    windowDays: number;
    minPlannedRuns: number;
    minRolePlannedRuns?: number;
    anomalyDropPp?: number;
    passRateThreshold: number;
    retrySpikeThreshold: number;
    runsWithPlanning: number;
    gatePassRate: number;
    maxRetryAttempt: number;
    alerts?: Array<{ type?: string; message: string }>;
    roleAnomalies?: PlanningGateRoleAnomaly[];
    topRoleRegressions?: unknown[];
  };
}

interface PlanningGateStage3Snapshot {
  windowDays: number;
  generatedAt: string;
  goldenEval: {
    current: {
      windowDays: number;
      total: number;
      passed: number;
      rate: number;
    };
    baseline30d: {
      windowDays: number;
      total: number;
      passed: number;
      rate: number;
    };
    deltaVs30d: number;
  };
  autoRepair: {
    current: {
      windowDays: number;
      triggered: number;
      convertedToPass: number;
      conversionRate: number;
    };
    baseline30d: {
      windowDays: number;
      triggered: number;
      convertedToPass: number;
      conversionRate: number;
    };
    deltaVs30d: number;
  };
  topMissingCriteria: Array<{ criterion: string; count: number }>;
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
};

const RISK_CARD_DEFAULTS = [
  { key: 'trust-alerts', title: 'Trust Alerts', anchor: 'action-queue' },
  { key: 'drift-alerts', title: 'Drift Alerts', anchor: 'action-queue' },
  { key: 'access-risk', title: 'Access Risk', anchor: 'access-control' },
  { key: 'policy-health', title: 'Policy Health', anchor: 'action-queue' },
  { key: 'compliance', title: 'Compliance', anchor: 'action-queue' },
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

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => asString(item)?.trim() ?? '')
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    try {
      return normalizeStringArray(JSON.parse(value));
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }

  return [];
}

function normalizeObjectRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeAgentCapacity(raw: unknown): AgentCapacityConfig | null {
  const item = getObjectOrFirst(raw);
  if (!item) return null;

  return {
    id: asString(getValue(item, ['id'])) ?? 'capacity-config',
    agentId: asString(getValue(item, ['agentId', 'agent_id'])) ?? 'unknown',
    capacityTier: (asString(getValue(item, ['capacityTier', 'capacity_tier'])) as AgentCapacityConfig['capacityTier']) ?? 'execute',
    requiresHumanApprovalFor: normalizeStringArray(getValue(item, ['requiresHumanApprovalFor', 'requires_human_approval_for'])),
    overrideByRoles: normalizeStringArray(getValue(item, ['overrideByRoles', 'override_by_roles'])),
    updatedAt: asString(getValue(item, ['updatedAt', 'updated_at'])) ?? new Date(0).toISOString(),
    updatedBy: asString(getValue(item, ['updatedBy', 'updated_by'])) ?? 'system',
    metadata: normalizeObjectRecord(getValue(item, ['metadata'])),
  };
}

function normalizeCommitments(raw: unknown): { page: number; pageSize: number; total: number; items: CommitmentRegistryEntry[] } {
  const record = isRecord(raw) ? raw : null;
  const items = getRecordList(raw).map((item, index) => ({
    id: asString(getValue(item, ['id'])) ?? `commitment-${index}`,
    agentId: asString(getValue(item, ['agentId', 'agent_id'])) ?? 'unknown',
    agentName: asString(getValue(item, ['agentName', 'agent_name'])) ?? 'Unknown Agent',
    actionType: asString(getValue(item, ['actionType', 'action_type'])) ?? 'unknown_action',
    actionDescription: asString(getValue(item, ['actionDescription', 'action_description'])) ?? 'Binding action',
    externalCounterparty: asString(getValue(item, ['externalCounterparty', 'external_counterparty'])),
    commitmentValue: asString(getValue(item, ['commitmentValue', 'commitment_value'])),
    toolCalled: asString(getValue(item, ['toolCalled', 'tool_called'])) ?? 'unknown_tool',
    toolInput: normalizeObjectRecord(getValue(item, ['toolInput', 'tool_input'])),
    approvedByHumanId: asString(getValue(item, ['approvedByHumanId', 'approved_by_human_id'])),
    approvedAt: asString(getValue(item, ['approvedAt', 'approved_at'])),
    autoApproved: asBoolean(getValue(item, ['autoApproved', 'auto_approved'])) ?? false,
    status: (asString(getValue(item, ['status'])) as CommitmentRegistryEntry['status']) ?? 'pending_approval',
    createdAt: asString(getValue(item, ['createdAt', 'created_at'])) ?? new Date(0).toISOString(),
    executedAt: asString(getValue(item, ['executedAt', 'executed_at'])),
    metadata: normalizeObjectRecord(getValue(item, ['metadata'])),
  }));

  return {
    page: asNumber(record?.page) ?? 1,
    pageSize: asNumber(record?.pageSize ?? record?.page_size) ?? items.length,
    total: asNumber(record?.total) ?? items.length,
    items,
  };
}

function normalizePlanningGate(raw: unknown): PlanningGateSnapshot | null {
  if (!isRecord(raw) || !isRecord(raw.totals)) return null;
  const totals = raw.totals as UnknownRecord;
  const roles = Array.isArray(raw.roles) ? raw.roles.filter((item) => isRecord(item)).map((item) => ({
    role: asString(item.role) ?? 'unknown',
    runsObserved: asNumber(item.runsObserved) ?? asNumber(item.runs_observed) ?? 0,
    runsWithPlanning: asNumber(item.runsWithPlanning) ?? asNumber(item.runs_with_planning) ?? 0,
    runsWithGatePass: asNumber(item.runsWithGatePass) ?? asNumber(item.runs_with_gate_pass) ?? 0,
    runsWithGateFail: asNumber(item.runsWithGateFail) ?? asNumber(item.runs_with_gate_fail) ?? 0,
    planningEvents: asNumber(item.planningEvents) ?? asNumber(item.planning_events) ?? 0,
    gatePassEvents: asNumber(item.gatePassEvents) ?? asNumber(item.gate_pass_events) ?? 0,
    gateFailEvents: asNumber(item.gateFailEvents) ?? asNumber(item.gate_fail_events) ?? 0,
    maxRetryAttempt: asNumber(item.maxRetryAttempt) ?? asNumber(item.max_retry_attempt) ?? 0,
    avgMissingCriteriaMentions: asNumber(item.avgMissingCriteriaMentions) ?? asNumber(item.avg_missing_criteria_mentions) ?? 0,
    passRate: asNumber(item.passRate) ?? asNumber(item.pass_rate) ?? 0,
  })) : [];

  return {
    windowDays: asNumber(raw.windowDays) ?? asNumber(raw.window_days) ?? 30,
    totals: {
      runsObserved: asNumber(totals.runsObserved) ?? asNumber(totals.runs_observed) ?? 0,
      runsWithPlanning: asNumber(totals.runsWithPlanning) ?? asNumber(totals.runs_with_planning) ?? 0,
      runsWithGatePass: asNumber(totals.runsWithGatePass) ?? asNumber(totals.runs_with_gate_pass) ?? 0,
      runsWithGateFail: asNumber(totals.runsWithGateFail) ?? asNumber(totals.runs_with_gate_fail) ?? 0,
      planningEvents: asNumber(totals.planningEvents) ?? asNumber(totals.planning_events) ?? 0,
      gatePassEvents: asNumber(totals.gatePassEvents) ?? asNumber(totals.gate_pass_events) ?? 0,
      gateFailEvents: asNumber(totals.gateFailEvents) ?? asNumber(totals.gate_fail_events) ?? 0,
      maxRetryAttempt: asNumber(totals.maxRetryAttempt) ?? asNumber(totals.max_retry_attempt) ?? 0,
      avgMissingCriteriaMentions: asNumber(totals.avgMissingCriteriaMentions) ?? asNumber(totals.avg_missing_criteria_mentions) ?? 0,
      passRate: asNumber(totals.passRate) ?? asNumber(totals.pass_rate) ?? 0,
    },
    roles,
  };
}

function normalizePlanningGateStage3(raw: unknown): PlanningGateStage3Snapshot | null {
  if (!isRecord(raw) || !isRecord(raw.goldenEval) || !isRecord(raw.autoRepair)) return null;
  const goldenEval = raw.goldenEval as UnknownRecord;
  const autoRepair = raw.autoRepair as UnknownRecord;
  const goldenCurrent = isRecord(goldenEval.current) ? goldenEval.current : {};
  const goldenBaseline = isRecord(goldenEval.baseline30d) ? goldenEval.baseline30d : {};
  const autoCurrent = isRecord(autoRepair.current) ? autoRepair.current : {};
  const autoBaseline = isRecord(autoRepair.baseline30d) ? autoRepair.baseline30d : {};
  const criteriaList = Array.isArray(raw.topMissingCriteria)
    ? raw.topMissingCriteria.filter((item) => isRecord(item)).map((item) => ({
      criterion: asString(item.criterion) ?? 'Unknown criterion',
      count: asNumber(item.count) ?? 0,
    }))
    : [];

  return {
    windowDays: asNumber(raw.windowDays) ?? 30,
    generatedAt: asString(raw.generatedAt) ?? '',
    goldenEval: {
      current: {
        windowDays: asNumber(goldenCurrent.windowDays) ?? 30,
        total: asNumber(goldenCurrent.total) ?? 0,
        passed: asNumber(goldenCurrent.passed) ?? 0,
        rate: asNumber(goldenCurrent.rate) ?? 0,
      },
      baseline30d: {
        windowDays: asNumber(goldenBaseline.windowDays) ?? 30,
        total: asNumber(goldenBaseline.total) ?? 0,
        passed: asNumber(goldenBaseline.passed) ?? 0,
        rate: asNumber(goldenBaseline.rate) ?? 0,
      },
      deltaVs30d: asNumber(goldenEval.deltaVs30d) ?? 0,
    },
    autoRepair: {
      current: {
        windowDays: asNumber(autoCurrent.windowDays) ?? 30,
        triggered: asNumber(autoCurrent.triggered) ?? 0,
        convertedToPass: asNumber(autoCurrent.convertedToPass) ?? 0,
        conversionRate: asNumber(autoCurrent.conversionRate) ?? 0,
      },
      baseline30d: {
        windowDays: asNumber(autoBaseline.windowDays) ?? 30,
        triggered: asNumber(autoBaseline.triggered) ?? 0,
        convertedToPass: asNumber(autoBaseline.convertedToPass) ?? 0,
        conversionRate: asNumber(autoBaseline.conversionRate) ?? 0,
      },
      deltaVs30d: asNumber(autoRepair.deltaVs30d) ?? 0,
    },
    topMissingCriteria: criteriaList,
  };
}

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
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

const VALID_TABS: GovernanceSurface[] = [
  'tool-view',
  'access-control',
  'authority',
  'autonomy',
  'reliability',
  'enterprise-kpis',
  'models',
];
const HIDDEN_AUTHORITY_STATUSES = new Set(['retired', 'inactive', 'deleted']);

export default function Governance() {
  const { user } = useAuth();
  const { data: agents, loading: agentsLoading } = useAgents();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as GovernanceSurface | null;
  const [activeTab, setActiveTab] = useState<GovernanceSurface>(
    tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : 'reliability'
  );

  const handleTabChange = useCallback((tab: GovernanceSurface) => {
    setActiveTab(tab);
    if (tab === 'tool-view') {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ tab }, { replace: true });
    }
  }, [setSearchParams]);
  const [data, setData] = useState<GovernanceData>(INITIAL_DATA);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyDecisionId, setBusyDecisionId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [capacityConfig, setCapacityConfig] = useState<AgentCapacityConfig | null>(null);
  const [capacityFetchError, setCapacityFetchError] = useState<string | null>(null);
  const [authorityLoading, setAuthorityLoading] = useState(false);
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [busyCommitmentId, setBusyCommitmentId] = useState<string | null>(null);
  const [pendingCommitments, setPendingCommitments] = useState<CommitmentRegistryEntry[]>([]);
  const [pendingCommitmentTotal, setPendingCommitmentTotal] = useState(0);
  const [agentCommitments, setAgentCommitments] = useState<CommitmentRegistryEntry[]>([]);
  const [agentCommitmentTotal, setAgentCommitmentTotal] = useState(0);
  const [planningGate, setPlanningGate] = useState<PlanningGateSnapshot | null>(null);
  const [planningGateHealth, setPlanningGateHealth] = useState<PlanningGateHealthSnapshot | null>(null);
  const [planningGateStage3, setPlanningGateStage3] = useState<PlanningGateStage3Snapshot | null>(null);

  const isAdmin = user?.email ? ADMIN_EMAILS.includes(user.email.toLowerCase()) : false;
  const authorityAgents = useMemo(
    () => agents.filter((agent) => !HIDDEN_AUTHORITY_STATUSES.has(String(agent.status ?? '').toLowerCase())),
    [agents],
  );

  useEffect(() => {
    if (authorityAgents.length === 0) return;
    if (selectedAgentId && authorityAgents.some((agent) => agent.role === selectedAgentId || agent.id === selectedAgentId)) return;
    const nextAgent = [...authorityAgents]
      .sort((left, right) => (left.display_name || left.name || left.role).localeCompare(right.display_name || right.name || right.role))[0];
    if (nextAgent) {
      setSelectedAgentId(nextAgent.role || nextAgent.id);
    }
  }, [authorityAgents, selectedAgentId]);

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
        planningGateRaw,
        planningGateHealthRaw,
        planningGateStage3Raw,
      ] = await Promise.all([
        fetchWithFallback(['/api/governance/risk-summary']).catch(() => null),
        fetchWithFallback(['/api/governance/action-queue']).catch(() => null),
        fetchWithFallback(['/api/governance/changelog?days=7']).catch(() => null),
        fetchWithFallback(['/api/governance/trust-map']).catch(() => null),
        fetchWithFallback(['/api/governance/access-posture']).catch(() => null),
        fetchWithFallback(['/api/governance/least-privilege', '/api/governance/least-privilege-analysis']).catch(() => null),
        apiCallWithTimeout('/api/platform-iam-state').catch(() => null),
        apiCallWithTimeout('/api/platform-secret-rotation').catch(() => null),
        apiCallWithTimeout('/api/agent-tool-grants?order=agent_role.asc,tool_name.asc&limit=5000').catch(() => null),
        apiCallWithTimeout('/api/tool-reputation?order=updated_at.desc&limit=2000').catch(() => null),
        apiCallWithTimeout('/api/decisions?status=pending&order=created_at.desc&limit=20').catch(() => null),
        apiCallWithTimeout('/admin/metrics/planning-gate?window=30').catch(() => null),
        apiCallWithTimeout('/admin/metrics/planning-gate-health').catch(() => null),
        apiCallWithTimeout('/admin/metrics/planning-gate-stage3?window=30').catch(() => null),
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
      });
      setPlanningGate(normalizePlanningGate(planningGateRaw));
      setPlanningGateHealth((isRecord(planningGateHealthRaw) ? planningGateHealthRaw : null) as PlanningGateHealthSnapshot | null);
      setPlanningGateStage3(normalizePlanningGateStage3(planningGateStage3Raw));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const refreshPendingCommitments = useCallback(async () => {
    const raw = await apiCallWithTimeout('/admin/commitments/pending?pageSize=12').catch(() => null);
    const normalized = normalizeCommitments(raw);
    setPendingCommitments(normalized.items);
    setPendingCommitmentTotal(normalized.total);
  }, []);

  const refreshSelectedAuthority = useCallback(async (agentId: string) => {
    if (!agentId) {
      setCapacityConfig(null);
      setCapacityFetchError(null);
      setAgentCommitments([]);
      setAgentCommitmentTotal(0);
      return;
    }

    const encodedAgentId = encodeURIComponent(agentId);
    let capacityErr: string | null = null;
    const [capacityRaw, commitmentsRaw] = await Promise.all([
      apiCallWithTimeout(`/admin/agents/${encodedAgentId}/capacity`).catch((err: unknown) => {
        capacityErr = err instanceof Error ? err.message : String(err);
        return null;
      }),
      apiCallWithTimeout(`/admin/commitments?agent=${encodedAgentId}&pageSize=20`).catch(() => null),
    ]);

    setCapacityFetchError(capacityErr);
    setCapacityConfig(normalizeAgentCapacity(capacityRaw));
    const normalizedCommitments = normalizeCommitments(commitmentsRaw);
    setAgentCommitments(normalizedCommitments.items);
    setAgentCommitmentTotal(normalizedCommitments.total);
  }, []);

  const refreshAuthority = useCallback(async (agentId: string, mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode === 'initial') {
      setAuthorityLoading(true);
    }

    try {
      await Promise.all([
        refreshPendingCommitments(),
        refreshSelectedAuthority(agentId),
      ]);
    } finally {
      setAuthorityLoading(false);
    }
  }, [refreshPendingCommitments, refreshSelectedAuthority]);

  useEffect(() => {
    refresh('initial');
  }, [refresh]);

  useEffect(() => {
    if (!selectedAgentId) return;
    refreshAuthority(selectedAgentId, 'initial');
  }, [refreshAuthority, selectedAgentId]);

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

  const handleSaveCapacity = useCallback(async (input: {
    capacityTier: AgentCapacityConfig['capacityTier'];
    requiresHumanApprovalFor: string[];
    overrideByRoles: string[];
    metadata: Record<string, unknown>;
  }) => {
    if (!selectedAgentId) return;
    setSavingCapacity(true);
    try {
      const updated = await apiCall('/admin/agents/' + encodeURIComponent(selectedAgentId) + '/capacity', {
        method: 'PUT',
        body: JSON.stringify({
          capacityTier: input.capacityTier,
          requiresHumanApprovalFor: input.requiresHumanApprovalFor,
          overrideByRoles: input.overrideByRoles,
          metadata: input.metadata,
          updatedBy: user?.email ?? 'dashboard',
        }),
      });
      setCapacityConfig(normalizeAgentCapacity(updated));
      await refreshPendingCommitments();
    } finally {
      setSavingCapacity(false);
    }
  }, [refreshPendingCommitments, selectedAgentId, user?.email]);

  const handleApproveCommitment = useCallback(async (id: string) => {
    setBusyCommitmentId(id);
    try {
      await apiCall(`/admin/commitments/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ approverHumanId: user?.email ?? 'dashboard' }),
      });
      await refreshAuthority(selectedAgentId);
    } finally {
      setBusyCommitmentId(null);
    }
  }, [refreshAuthority, selectedAgentId, user?.email]);

  const handleRejectCommitment = useCallback(async (id: string, reason: string) => {
    setBusyCommitmentId(id);
    try {
      await apiCall(`/admin/commitments/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({
          approverHumanId: user?.email ?? 'dashboard',
          reason,
        }),
      });
      await refreshAuthority(selectedAgentId);
    } finally {
      setBusyCommitmentId(null);
    }
  }, [refreshAuthority, selectedAgentId, user?.email]);

  const handleReverseCommitment = useCallback(async (id: string, reason: string) => {
    setBusyCommitmentId(id);
    try {
      await apiCall(`/admin/commitments/${id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      await refreshAuthority(selectedAgentId);
    } finally {
      setBusyCommitmentId(null);
    }
  }, [refreshAuthority, selectedAgentId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <SectionHeader title="Governance Control Plane" subtitle="Loading command center, tool view, and access posture surfaces…" />
        {[1, 2, 3].map((index) => <Skeleton key={index} className="h-48 w-full" />)}
      </div>
    );
  }

  const healthTone = planningGateHealth?.status === 'red'
    ? 'border-prism-critical/40 bg-prism-critical/10 text-prism-critical'
    : planningGateHealth?.status === 'yellow'
      ? 'border-prism-elevated/40 bg-prism-elevated/10 text-prism-elevated'
      : 'border-prism-teal/40 bg-prism-teal/10 text-prism-teal';
  const healthLabel = planningGateHealth?.status === 'red'
    ? 'Alert'
    : planningGateHealth?.status === 'yellow'
      ? 'Watching'
      : 'Healthy';
  const firstRoleAnomaly = planningGateHealth?.report?.roleAnomalies?.[0];
  const healthDetail = planningGateHealth?.status === 'red'
    ? (planningGateHealth?.report?.alerts?.[0]?.message ?? 'Threshold breached.')
    : planningGateHealth?.status === 'yellow'
      ? (
          firstRoleAnomaly?.message
          ?? `Needs at least ${planningGateHealth?.report?.minPlannedRuns ?? 0} planned runs for stable signal.`
        )
      : 'Pass rate and retry behavior are within configured thresholds.';

  return (
    <div className="outer-cards-transparent space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <SectionHeader
            title="Governance Control Plane"
            subtitle="Tool, authority, autonomy, and access-control surfaces for managing agent execution rights and approvals."
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
          <Card className="mt-3 max-w-3xl border-border/70 bg-surface">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-txt-muted">
                Planning & Completion Gate (30d)
              </p>
              <div className="flex items-center gap-3">
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${healthTone}`}>
                  {healthLabel}
                </span>
                <span className="text-[11px] text-txt-muted">
                  Last evaluated: {formatDateTime(planningGateHealth?.evaluatedAt)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleTabChange('reliability')}
                className="text-[12px] font-medium text-prism-sky transition-colors hover:text-prism-teal"
              >
                Open Reliability →
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-[11px] text-txt-muted">Pass Rate</p>
                <p className="text-lg font-semibold text-txt-primary">{formatPct(planningGate?.totals.passRate)}</p>
              </div>
              <div>
                <p className="text-[11px] text-txt-muted">Planned Runs</p>
                <p className="text-lg font-semibold text-txt-primary">{(planningGate?.totals.runsWithPlanning ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[11px] text-txt-muted">Gate Fails</p>
                <p className="text-lg font-semibold text-txt-primary">{(planningGate?.totals.gateFailEvents ?? 0).toLocaleString()}</p>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-border/60 bg-bg-elevated/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-txt-muted">
                  Stage 3 Scorecard
                </p>
                <span className="text-[11px] text-txt-muted">
                  Updated: {formatDateTime(planningGateStage3?.generatedAt)}
                </span>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] text-txt-muted">Golden Eval Pass</p>
                  <p className="text-lg font-semibold text-txt-primary">{formatPct(planningGateStage3?.goldenEval.current.rate)}</p>
                  <p className="text-[11px] text-txt-muted">
                    {planningGateStage3?.goldenEval.current.passed ?? 0}/{planningGateStage3?.goldenEval.current.total ?? 0}
                    {' '}({planningGateStage3?.windowDays ?? 30}d)
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-txt-muted">Auto-Repair Conversion</p>
                  <p className="text-lg font-semibold text-txt-primary">{formatPct(planningGateStage3?.autoRepair.current.conversionRate)}</p>
                  <p className="text-[11px] text-txt-muted">
                    {planningGateStage3?.autoRepair.current.convertedToPass ?? 0}/{planningGateStage3?.autoRepair.current.triggered ?? 0} converted
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-txt-muted">30d Delta (Golden / Repair)</p>
                  <p className="text-lg font-semibold text-txt-primary">
                    {formatPct(planningGateStage3?.goldenEval.deltaVs30d)} / {formatPct(planningGateStage3?.autoRepair.deltaVs30d)}
                  </p>
                  <p className="text-[11px] text-txt-muted">Positive values indicate improvement</p>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-txt-muted">
                Top missing criteria:{' '}
                {planningGateStage3?.topMissingCriteria?.length
                  ? planningGateStage3.topMissingCriteria
                    .slice(0, 3)
                    .map((item) => `${item.criterion} (${item.count})`)
                    .join(' • ')
                  : 'No missing-criteria failures in selected window.'}
              </p>
            </div>
            <p className="mt-3 text-[12px] text-txt-muted">{healthDetail}</p>
          </Card>
        </div>
        <button
          type="button"
          onClick={() => Promise.all([refresh(), refreshAuthority(selectedAgentId)])}
          disabled={refreshing || authorityLoading}
          className="rounded-lg theme-glass-panel-soft px-4 py-2 text-[13px] font-medium text-txt-secondary transition-colors hover:border-primary/40 hover:text-txt-primary disabled:opacity-50"
        >
          {refreshing || authorityLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <PageTabs<GovernanceSurface>
        tabs={[
          { key: 'tool-view', label: 'Tool View' },
          { key: 'access-control', label: 'Access Control' },
          { key: 'authority', label: 'Authority' },
          { key: 'autonomy', label: 'Autonomy' },
          { key: 'reliability', label: 'Reliability' },
          { key: 'enterprise-kpis', label: 'Enterprise KPIs' },
          { key: 'models', label: 'Models' },
        ]}
        active={activeTab}
        onChange={handleTabChange}
      />

      {activeTab === 'tool-view' && (
        <div id="tool-view">
          <ToolView
            loading={false}
            toolReputation={data.toolReputation}
            grants={data.grants}
            onOpenSurface={handleTabChange}
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

      {activeTab === 'authority' && (
        <div id="authority">
          <AuthorityControl
            loading={authorityLoading || agentsLoading}
            agents={authorityAgents}
            selectedAgentId={selectedAgentId}
            capacityConfig={capacityConfig}
            capacityFetchError={capacityFetchError}
            pendingCommitments={pendingCommitments}
            pendingCommitmentTotal={pendingCommitmentTotal}
            agentCommitments={agentCommitments}
            agentCommitmentTotal={agentCommitmentTotal}
            isAdmin={isAdmin}
            savingCapacity={savingCapacity}
            busyCommitmentId={busyCommitmentId}
            onSelectAgent={setSelectedAgentId}
            onSaveCapacity={handleSaveCapacity}
            onApproveCommitment={handleApproveCommitment}
            onRejectCommitment={handleRejectCommitment}
            onReverseCommitment={handleReverseCommitment}
          />
        </div>
      )}

      {activeTab === 'autonomy' && (
        <div id="autonomy">
          <AutonomyDashboard
            isAdmin={isAdmin}
            currentUserEmail={user?.email ?? null}
          />
        </div>
      )}

      {activeTab === 'reliability' && (
        <div id="reliability">
          <ReliabilityDashboard />
        </div>
      )}

      {activeTab === 'enterprise-kpis' && (
        <div id="enterprise-kpis">
          <EnterpriseKpiDashboard />
        </div>
      )}

      {activeTab === 'models' && (
        <div id="models">
          <ModelAdmin />
        </div>
      )}
    </div>
  );
}
