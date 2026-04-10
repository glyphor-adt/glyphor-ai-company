import type { IncomingMessage, ServerResponse } from 'node:http';
import { systemQuery } from '@glyphor/shared/db';
import { writeJson } from './httpJson.js';
import type {
  GovernanceAction,
  GovernanceAccessIssue,
  GovernanceAccessPosture,
  GovernanceChangeLogEvent,
  GovernanceLeastPrivilegeDepartment,
  GovernanceRiskSummary,
  GovernanceTrendDirection,
  GovernanceTrustMapEntry,
} from '@glyphor/shared';

type JsonMap = Record<string, unknown>;

type ScoreHistoryEntry = {
  score?: number;
  timestamp?: string;
};

const ACTION_SEVERITY_ORDER: Record<GovernanceAction['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const ACCESS_SEVERITY_ORDER: Record<GovernanceAccessIssue['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

function round(value: number | null, digits = 2): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function daysSince(value: unknown, fallbackToNow = false): number {
  if (!value && fallbackToNow) return 0;
  const date = value ? new Date(toIsoString(value)) : new Date();
  const diff = Date.now() - date.getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function trendForCounts(current: number, previous: number): GovernanceTrendDirection {
  if (current > previous) return 'up';
  if (current < previous) return 'down';
  return 'flat';
}

function trendForRates(current: number | null, previous: number | null): GovernanceTrendDirection {
  if (current == null || previous == null) return 'flat';
  if (current > previous) return 'up';
  if (current < previous) return 'down';
  return 'flat';
}

function safeJsonMap(value: unknown): JsonMap | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonMap
    : undefined;
}

function formatPolicyName(content: unknown, policyType: string, version: unknown): string {
  const contentMap = safeJsonMap(content);
  const explicitName = contentMap?.name ?? contentMap?.policy_name ?? contentMap?.title;
  if (typeof explicitName === 'string' && explicitName.trim().length > 0) return explicitName;
  const readableType = policyType.replace(/_/g, ' ');
  const formatted = readableType.replace(/\b\w/g, char => char.toUpperCase());
  const versionSuffix = typeof version === 'number' ? ` v${version}` : '';
  return `${formatted}${versionSuffix}`;
}

function scoreHistory(value: unknown): ScoreHistoryEntry[] {
  return Array.isArray(value) ? value as ScoreHistoryEntry[] : [];
}

function priorTrustAlertCount(rows: Array<{ score_history: unknown }>): number {
  const cutoff = Date.now() - 7 * 86_400_000;
  return rows.reduce((count, row) => {
    const prior = scoreHistory(row.score_history)
      .filter(entry => entry.timestamp && new Date(entry.timestamp).getTime() <= cutoff)
      .sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime())[0];
    return count + ((prior?.score ?? 1) < 0.7 ? 1 : 0);
  }, 0);
}

async function getGrantUsageRows() {
  return systemQuery<{
    agent_role: string;
    tool_name: string;
    reason: string | null;
    scope: string | null;
    created_at: string;
    expires_at: string | null;
    department: string | null;
    trust_score: number | null;
    uses_last_30d: number;
    last_used_at: string | null;
  }>(
    `SELECT
       atg.agent_role,
       atg.tool_name,
       atg.reason,
       atg.scope,
       atg.created_at,
       atg.expires_at,
       ca.department,
       ats.trust_score,
       COALESCE(run_stats.completed_runs_last_30d, 0)::int AS uses_last_30d,
       run_stats.last_completed_run_at AS last_used_at
     FROM agent_tool_grants atg
     LEFT JOIN company_agents ca ON ca.role = atg.agent_role
     LEFT JOIN agent_trust_scores ats ON ats.agent_role = atg.agent_role
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*) FILTER (
           WHERE ar.status = 'completed'
             AND ar.started_at >= NOW() - INTERVAL '30 days'
         ) AS completed_runs_last_30d,
         MAX(ar.started_at) FILTER (WHERE ar.status = 'completed') AS last_completed_run_at
       FROM agent_runs ar
       WHERE ar.agent_id = atg.agent_role
     ) run_stats ON true
     WHERE atg.is_active = true`,
  );
}

async function getAccessIssues(): Promise<GovernanceAccessIssue[]> {
  const [secretRows, iamRows, grantRows] = await Promise.all([
    systemQuery<{
      platform: string;
      secret_name: string;
      status: string;
      expires_at: string | null;
      rotated_at: string | null;
      created_at: string;
      days_to_expiry: number | null;
    }>(
      `SELECT
         platform,
         secret_name,
         status,
         expires_at,
         rotated_at,
         created_at,
         CASE
           WHEN expires_at IS NULL THEN NULL
           ELSE EXTRACT(EPOCH FROM (expires_at - NOW())) / 86400
         END AS days_to_expiry
       FROM platform_secret_rotation
       WHERE status <> 'rotated'
         AND (
           status = 'expired'
           OR expires_at IS NULL
           OR expires_at < NOW() + INTERVAL '30 days'
         )`,
    ),
    systemQuery<{
      platform: string;
      credential_id: string;
      agent_role: string | null;
      permissions: unknown;
      desired_permissions: unknown;
      in_sync: boolean;
      drift_details: string | null;
      last_synced: string;
    }>(
      `SELECT
         platform,
         credential_id,
         agent_role,
         permissions,
         desired_permissions,
         in_sync,
         drift_details,
         last_synced
       FROM platform_iam_state
       WHERE in_sync = false`,
    ),
    getGrantUsageRows(),
  ]);

  const issues: GovernanceAccessIssue[] = [];

  for (const row of secretRows) {
    const daysToExpiry = toNumber(row.days_to_expiry);
    const severity: GovernanceAccessIssue['severity'] = row.status === 'expired'
      ? 'critical'
      : (daysToExpiry != null && daysToExpiry < 30 ? 'medium' : 'low');
    const when = row.expires_at ? `${Math.max(0, Math.ceil(daysToExpiry ?? 0))} day(s)` : 'unknown expiry';
    issues.push({
      type: 'secret',
      severity,
      title: `${row.platform} secret ${row.secret_name} needs attention`,
      description: row.status === 'expired'
        ? `Secret is expired and should be rotated immediately.`
        : `Secret expires in ${when}.`,
      created_at: toIsoString(row.expires_at ?? row.created_at),
      platform: row.platform,
      recommended_action: row.status === 'expired' ? 'Rotate immediately' : 'Review rotation plan',
      metadata: {
        secret_name: row.secret_name,
        status: row.status,
        expires_at: row.expires_at,
        rotated_at: row.rotated_at,
        days_to_expiry: round(daysToExpiry, 1),
      },
    });
  }

  for (const row of iamRows) {
    const permissionText = `${JSON.stringify(row.permissions ?? {})} ${JSON.stringify(row.desired_permissions ?? {})}`.toLowerCase();
    const hasWriteAccess = /(write|admin|owner|editor|manage)/.test(permissionText);
    issues.push({
      type: 'iam_drift',
      severity: hasWriteAccess ? 'high' : 'low',
      title: `${row.platform} IAM drift detected`,
      description: row.drift_details || `Credential ${row.credential_id} is out of sync with desired permissions.`,
      created_at: toIsoString(row.last_synced),
      agent_role: row.agent_role ?? undefined,
      platform: row.platform,
      recommended_action: hasWriteAccess ? 'Reconcile write access now' : 'Review drift details',
      metadata: {
        credential_id: row.credential_id,
        in_sync: row.in_sync,
        permissions: row.permissions,
        desired_permissions: row.desired_permissions,
        permissions_include_write: hasWriteAccess,
      },
    });
  }

  for (const row of grantRows) {
    const trustScore = toNumber(row.trust_score) ?? 0.5;
    const lastReference = row.last_used_at ?? row.created_at;
    const staleDays = daysSince(lastReference);
    const expiresSoon = row.expires_at && new Date(row.expires_at).getTime() < Date.now() + 30 * 86_400_000;
    if (trustScore >= 0.5 && staleDays <= 90 && !expiresSoon) continue;

    const severity: GovernanceAccessIssue['severity'] = trustScore < 0.5
      ? 'high'
      : (staleDays > 90 || expiresSoon ? 'medium' : 'low');
    const descriptionParts = [
      trustScore < 0.5 ? `Agent trust score is ${round(trustScore)}.` : null,
      staleDays > 90 ? `Agent has no recent completed runs for ${staleDays} days.` : null,
      expiresSoon && row.expires_at ? `Grant expires on ${row.expires_at}.` : null,
    ].filter(Boolean);

    issues.push({
      type: 'grant',
      severity,
      title: `${row.agent_role} grant ${row.tool_name} should be reviewed`,
      description: descriptionParts.join(' ') || 'Grant freshness requires review.',
      created_at: toIsoString(row.expires_at ?? row.created_at),
      agent_role: row.agent_role,
      recommended_action: trustScore < 0.5 ? 'Reduce access or require approval' : 'Review for revocation',
      metadata: {
        tool_name: row.tool_name,
        department: row.department,
        trust_score: round(trustScore),
        uses_last_30d: row.uses_last_30d,
        days_since_use: staleDays,
        scope: row.scope,
        expires_at: row.expires_at,
      },
    });
  }

  return issues.sort((a, b) => {
    const severityDiff = ACCESS_SEVERITY_ORDER[a.severity] - ACCESS_SEVERITY_ORDER[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

async function getActionQueue(): Promise<GovernanceAction[]> {
  const [
    trustRows,
    decisionRows,
    driftRows,
    secretRows,
    authorityRows,
    grantRows,
    constitutionalRows,
    canaryRows,
  ] = await Promise.all([
    systemQuery<{
      agent_role: string;
      trust_score: number;
      updated_at: string;
      display_name: string | null;
      failed_compliance_runs: number;
    }>(
      `SELECT
         ats.agent_role,
         ats.trust_score,
         ats.updated_at,
         ca.display_name,
         COALESCE((
           SELECT COUNT(*)::int
           FROM constitutional_evaluations ce
           WHERE ce.agent_role = ats.agent_role
             AND ce.overall_adherence < 0.5
             AND ce.evaluated_at >= NOW() - INTERVAL '7 days'
         ), 0) AS failed_compliance_runs
       FROM agent_trust_scores ats
       LEFT JOIN company_agents ca ON ca.role = ats.agent_role
       WHERE ats.trust_score < 0.7`,
    ),
    systemQuery<{
      id: string;
      title: string;
      summary: string;
      proposed_by: string;
      tier: string;
      created_at: string;
      data: unknown;
    }>(
      `SELECT id, title, summary, proposed_by, tier, created_at, data
       FROM decisions
       WHERE status = 'pending'`,
    ),
    systemQuery<{
      id: string;
      agent_role: string;
      metric: string;
      baseline_value: number;
      recent_value: number;
      deviation_sigma: number;
      direction: string;
      severity: string;
      detected_at: string;
    }>(
      `SELECT id, agent_role, metric, baseline_value, recent_value, deviation_sigma, direction, severity, detected_at
       FROM drift_alerts
       WHERE acknowledged = false`,
    ),
    systemQuery<{
      platform: string;
      secret_name: string;
      status: string;
      expires_at: string | null;
      created_at: string;
      days_to_expiry: number | null;
    }>(
      `SELECT
         platform,
         secret_name,
         status,
         expires_at,
         created_at,
         CASE
           WHEN expires_at IS NULL THEN NULL
           ELSE EXTRACT(EPOCH FROM (expires_at - NOW())) / 86400
         END AS days_to_expiry
       FROM platform_secret_rotation
       WHERE status <> 'rotated'
         AND expires_at < NOW() + INTERVAL '14 days'`,
    ),
    systemQuery<{
      id: string;
      agent_id: string;
      current_tier: string;
      proposed_tier: string;
      action: string;
      evidence: string;
      approval_rate: number | null;
      total_count: number | null;
      status: string;
      proposed_by: string;
      created_at: string;
    }>(
      `SELECT id, agent_id, current_tier, proposed_tier, action, evidence, approval_rate, total_count, status, proposed_by, created_at
       FROM authority_proposals
       WHERE status IN ('pending', 'proposed')`,
    ),
    getGrantUsageRows(),
    systemQuery<{
      agent_role: string;
      failure_count: number;
      last_evaluated_at: string;
      min_adherence: number;
    }>(
      `SELECT
         agent_role,
         COUNT(*)::int AS failure_count,
         MAX(evaluated_at) AS last_evaluated_at,
         MIN(overall_adherence) AS min_adherence
       FROM constitutional_evaluations
       WHERE overall_adherence < 0.5
         AND evaluated_at >= NOW() - INTERVAL '24 hours'
       GROUP BY agent_role`,
    ),
    systemQuery<{
      id: string;
      policy_type: string;
      agent_role: string | null;
      eval_score: number | null;
      review_at: string;
      content: unknown;
    }>(
      `SELECT
         id,
         policy_type,
         agent_role,
         eval_score,
         COALESCE(promoted_at, created_at) AS review_at,
         content
       FROM policy_versions
       WHERE status = 'canary'
         AND COALESCE(promoted_at, created_at) < NOW() - INTERVAL '48 hours'`,
    ),
  ]);

  const actions: GovernanceAction[] = [];

  for (const row of trustRows) {
    const displayName = row.display_name ?? row.agent_role;
    const severity: GovernanceAction['severity'] = row.trust_score < 0.4 ? 'critical' : 'high';
    actions.push({
      type: 'trust_alert',
      severity,
      title: `${displayName} trust score dropped to ${row.trust_score.toFixed(2)}`,
      description: row.failed_compliance_runs > 0
        ? `Constitutional compliance failed ${row.failed_compliance_runs} recent run(s).`
        : `Trust score is below the governance threshold.`,
      agent_role: row.agent_role,
      impact: row.trust_score < 0.4
        ? 'Agent actions should be reviewed before execution.'
        : 'Monitor trust before additional authority is granted.',
      created_at: toIsoString(row.updated_at),
      metadata: {
        trust_score: row.trust_score,
        failed_compliance_runs: row.failed_compliance_runs,
      },
    });
  }

  for (const row of decisionRows) {
    actions.push({
      type: 'decision',
      severity: row.tier === 'red' ? 'critical' : 'high',
      title: row.title,
      description: row.summary,
      agent_role: row.proposed_by,
      impact: `Pending ${row.tier} decision requires founder review.`,
      created_at: toIsoString(row.created_at),
      metadata: {
        decision_id: row.id,
        tier: row.tier,
        data: row.data,
      },
    });
  }

  for (const row of driftRows) {
    const severity: GovernanceAction['severity'] = row.severity === 'critical'
      ? 'critical'
      : (row.severity === 'warning' ? 'medium' : 'low');
    actions.push({
      type: 'drift_alert',
      severity,
      title: `${row.agent_role} drift detected on ${row.metric}`,
      description: `Recent value ${row.recent_value} vs baseline ${row.baseline_value} (${row.deviation_sigma.toFixed(1)}σ, ${row.direction}).`,
      agent_role: row.agent_role,
      created_at: toIsoString(row.detected_at),
      metadata: {
        drift_alert_id: row.id,
        metric: row.metric,
        baseline_value: row.baseline_value,
        recent_value: row.recent_value,
        deviation_sigma: row.deviation_sigma,
        direction: row.direction,
      },
    });
  }

  for (const row of secretRows) {
    const daysToExpiry = toNumber(row.days_to_expiry);
    const severity: GovernanceAction['severity'] = row.status === 'expired' || (daysToExpiry != null && daysToExpiry < 7)
      ? 'critical'
      : 'high';
    actions.push({
      type: 'secret_expiry',
      severity,
      title: `${row.platform} secret ${row.secret_name} expires soon`,
      description: row.status === 'expired'
        ? 'Secret is expired and rotation is overdue.'
        : `Secret expires in ${Math.max(0, Math.ceil(daysToExpiry ?? 0))} day(s).`,
      impact: 'Review rotation plan before access is interrupted.',
      created_at: toIsoString(row.expires_at ?? row.created_at),
      metadata: {
        platform: row.platform,
        secret_name: row.secret_name,
        status: row.status,
        expires_at: row.expires_at,
      },
    });
  }

  for (const row of authorityRows) {
    actions.push({
      type: 'authority_proposal',
      severity: 'high',
      title: `Authority change: ${row.agent_id} ${row.current_tier} → ${row.proposed_tier}`,
      description: row.evidence,
      agent_role: row.agent_id,
      impact: 'Authority proposal needs a promote or reject decision.',
      created_at: toIsoString(row.created_at),
      metadata: {
        authority_proposal_id: row.id,
        current_tier: row.current_tier,
        proposed_tier: row.proposed_tier,
        action: row.action,
        approval_rate: row.approval_rate,
        total_count: row.total_count,
        proposed_by: row.proposed_by,
      },
    });
  }

  for (const row of grantRows) {
    const trustScore = toNumber(row.trust_score) ?? 0.5;
    const lastReference = row.last_used_at ?? row.created_at;
    const staleDays = daysSince(lastReference);
    const expiresSoon = row.expires_at && new Date(row.expires_at).getTime() < Date.now() + 7 * 86_400_000;
    if (trustScore >= 0.5 && staleDays <= 90 && !expiresSoon) continue;

    const severity: GovernanceAction['severity'] = trustScore < 0.5
      ? 'high'
      : (staleDays > 90 || expiresSoon ? 'medium' : 'low');
    actions.push({
      type: 'access_risk',
      severity,
      title: `${row.agent_role} grant ${row.tool_name} is risky`,
      description: trustScore < 0.5
        ? `Granted tool access is paired with a low trust score (${round(trustScore)}).`
        : `Agent has been inactive for ${staleDays} day(s), so this grant should be reviewed.`,
      agent_role: row.agent_role,
      impact: expiresSoon ? 'Review before the grant expires.' : 'Review access scope and revoke if unnecessary.',
      created_at: toIsoString(row.expires_at ?? row.created_at),
      metadata: {
        tool_name: row.tool_name,
        trust_score: round(trustScore),
        uses_last_30d: row.uses_last_30d,
        days_since_use: staleDays,
        department: row.department,
        scope: row.scope,
      },
    });
  }

  for (const row of constitutionalRows) {
    actions.push({
      type: 'constitutional_failure',
      severity: 'critical',
      title: `${row.agent_role} failed constitutional checks`,
      description: `${row.failure_count} evaluation(s) fell below 0.5 adherence in the last 24 hours.`,
      agent_role: row.agent_role,
      impact: 'Investigate violations before additional autonomy is restored.',
      created_at: toIsoString(row.last_evaluated_at),
      metadata: {
        failure_count: row.failure_count,
        min_adherence: row.min_adherence,
      },
    });
  }

  for (const row of canaryRows) {
    actions.push({
      type: 'canary_decision',
      severity: 'high',
      title: `Canary policy ${formatPolicyName(row.content, row.policy_type, null)} is awaiting a decision`,
      description: `Canary has been live longer than 48 hours${row.eval_score != null ? ` with eval ${row.eval_score.toFixed(2)}` : ''}.`,
      agent_role: row.agent_role ?? undefined,
      impact: 'Choose whether to promote or roll back the canary.',
      created_at: toIsoString(row.review_at),
      metadata: {
        policy_id: row.id,
        policy_type: row.policy_type,
        eval_score: row.eval_score,
        content: row.content,
      },
    });
  }

  return actions.sort((a, b) => {
    const severityDiff = ACTION_SEVERITY_ORDER[a.severity] - ACTION_SEVERITY_ORDER[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

async function getChangeLog(days: number): Promise<GovernanceChangeLogEvent[]> {
  const cutoff = `${Math.max(1, Math.min(days, 30))} days`;
  const [
    policyEvents,
    trustRows,
    grantRows,
    iamRows,
    secretRows,
    driftRows,
    constitutionalRows,
    amendmentRows,
  ] = await Promise.all([
    systemQuery<{
      policy_id: string;
      policy_type: string;
      agent_role: string | null;
      eval_score: number | null;
      timestamp: string;
      event_kind: string;
      status: string;
      version: number;
      content: unknown;
    }>(
      `SELECT id AS policy_id, policy_type, agent_role, eval_score, created_at AS timestamp, 'created' AS event_kind, status, version, content
       FROM policy_versions
       WHERE created_at >= NOW() - INTERVAL '${cutoff}'
       UNION ALL
       SELECT id AS policy_id, policy_type, agent_role, eval_score, promoted_at AS timestamp, 'promoted' AS event_kind, status, version, content
       FROM policy_versions
       WHERE promoted_at IS NOT NULL AND promoted_at >= NOW() - INTERVAL '${cutoff}'
       UNION ALL
       SELECT id AS policy_id, policy_type, agent_role, eval_score, rolled_back_at AS timestamp, 'rolled_back' AS event_kind, status, version, content
       FROM policy_versions
       WHERE rolled_back_at IS NOT NULL AND rolled_back_at >= NOW() - INTERVAL '${cutoff}'`,
    ),
    systemQuery<{
      agent_role: string;
      trust_score: number;
      updated_at: string;
      score_history: unknown;
    }>(
      `SELECT agent_role, trust_score, updated_at, score_history
       FROM agent_trust_scores
       WHERE updated_at >= NOW() - INTERVAL '${cutoff}'`,
    ),
    systemQuery<{
      agent_role: string;
      tool_name: string;
      granted_by: string;
      directive_id: string | null;
      is_active: boolean;
      expires_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT agent_role, tool_name, granted_by, directive_id, is_active, expires_at, created_at, updated_at
       FROM agent_tool_grants
       WHERE created_at >= NOW() - INTERVAL '${cutoff}'
          OR updated_at >= NOW() - INTERVAL '${cutoff}'`,
    ),
    systemQuery<{
      platform: string;
      credential_id: string;
      agent_role: string | null;
      in_sync: boolean;
      drift_details: string | null;
      last_synced: string;
    }>(
      `SELECT platform, credential_id, agent_role, in_sync, drift_details, last_synced
       FROM platform_iam_state
       WHERE last_synced >= NOW() - INTERVAL '${cutoff}'`,
    ),
    systemQuery<{
      platform: string;
      secret_name: string;
      status: string;
      rotated_at: string | null;
      created_at: string;
      expires_at: string | null;
    }>(
      `SELECT platform, secret_name, status, rotated_at, created_at, expires_at
       FROM platform_secret_rotation
       WHERE created_at >= NOW() - INTERVAL '${cutoff}'
          OR rotated_at >= NOW() - INTERVAL '${cutoff}'`,
    ),
    systemQuery<{
      id: string;
      agent_role: string;
      metric: string;
      severity: string;
      direction: string;
      detected_at: string;
    }>(
      `SELECT id, agent_role, metric, severity, direction, detected_at
       FROM drift_alerts
       WHERE detected_at >= NOW() - INTERVAL '${cutoff}'`,
    ),
    systemQuery<{
      agent_role: string;
      overall_adherence: number;
      revision_triggered: boolean;
      evaluated_at: string;
    }>(
      `SELECT agent_role, overall_adherence, revision_triggered, evaluated_at
       FROM constitutional_evaluations
       WHERE overall_adherence < 0.7
         AND evaluated_at >= NOW() - INTERVAL '${cutoff}'`,
    ),
    systemQuery<{
      id: string;
      agent_role: string;
      action: string;
      principle_text: string;
      created_at: string;
      rationale: string | null;
    }>(
      `SELECT id, agent_role, action, principle_text, created_at, rationale
       FROM proposed_constitutional_amendments
       WHERE created_at >= NOW() - INTERVAL '${cutoff}'`,
    ),
  ]);

  const events: GovernanceChangeLogEvent[] = [];

  for (const row of policyEvents) {
    const name = formatPolicyName(row.content, row.policy_type, row.version);
    const description = row.event_kind === 'promoted'
      ? `Policy "${name}" promoted to ${row.status}${row.eval_score != null ? ` (eval ${row.eval_score.toFixed(2)})` : ''}.`
      : row.event_kind === 'rolled_back'
        ? `Policy "${name}" rolled back${row.eval_score != null ? ` (eval ${row.eval_score.toFixed(2)})` : ''}.`
        : `Policy "${name}" created in ${row.status} state.`;
    events.push({
      type: 'policy_change',
      timestamp: toIsoString(row.timestamp),
      agent_role: row.agent_role ?? undefined,
      description,
      metadata: {
        policy_id: row.policy_id,
        policy_type: row.policy_type,
        event_kind: row.event_kind,
        status: row.status,
        eval_score: row.eval_score,
      },
    });
  }

  for (const row of trustRows) {
    const prior = scoreHistory(row.score_history)
      .filter(entry => entry.timestamp && new Date(entry.timestamp).getTime() < new Date(row.updated_at).getTime())
      .sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime())[0];
    const delta = prior?.score != null ? row.trust_score - prior.score : null;
    events.push({
      type: 'trust_change',
      timestamp: toIsoString(row.updated_at),
      agent_role: row.agent_role,
      description: prior?.score != null
        ? `Trust score updated for ${row.agent_role}: ${prior.score.toFixed(2)} → ${row.trust_score.toFixed(2)} (${delta! >= 0 ? '+' : ''}${delta!.toFixed(2)}).`
        : `Trust score recorded for ${row.agent_role}: ${row.trust_score.toFixed(2)}.`,
      metadata: {
        trust_score: row.trust_score,
        previous_score: prior?.score ?? null,
        delta: round(delta),
      },
    });
  }

  for (const row of grantRows) {
    const eventTimestamp = row.updated_at > row.created_at ? row.updated_at : row.created_at;
    const verb = !row.is_active ? 'updated' : (row.updated_at > row.created_at ? 'updated' : 'granted');
    events.push({
      type: 'grant_change',
      timestamp: toIsoString(eventTimestamp),
      agent_role: row.agent_role,
      description: `Tool grant ${verb}: ${row.agent_role} → ${row.tool_name} (by ${row.granted_by}).`,
      metadata: {
        tool_name: row.tool_name,
        directive_id: row.directive_id,
        expires_at: row.expires_at,
        is_active: row.is_active,
      },
    });
  }

  for (const row of iamRows) {
    events.push({
      type: 'iam_change',
      timestamp: toIsoString(row.last_synced),
      agent_role: row.agent_role ?? undefined,
      description: row.in_sync
        ? `${row.platform} credential ${row.credential_id} re-synced successfully.`
        : `${row.platform} IAM drift detected for ${row.credential_id}.`,
      metadata: {
        platform: row.platform,
        credential_id: row.credential_id,
        in_sync: row.in_sync,
        drift_details: row.drift_details,
      },
    });
  }

  for (const row of secretRows) {
    const timestamp = row.rotated_at ?? row.created_at;
    events.push({
      type: 'secret_change',
      timestamp: toIsoString(timestamp),
      description: row.rotated_at
        ? `Secret rotated: ${row.secret_name} on ${row.platform}.`
        : `Secret lifecycle updated: ${row.secret_name} on ${row.platform} is ${row.status}.`,
      metadata: {
        platform: row.platform,
        secret_name: row.secret_name,
        status: row.status,
        expires_at: row.expires_at,
      },
    });
  }

  for (const row of driftRows) {
    events.push({
      type: 'drift_event',
      timestamp: toIsoString(row.detected_at),
      agent_role: row.agent_role,
      description: `Drift alert for ${row.agent_role}: ${row.metric} ${row.direction} (${row.severity}).`,
      metadata: {
        drift_alert_id: row.id,
        metric: row.metric,
        severity: row.severity,
        direction: row.direction,
      },
    });
  }

  for (const row of constitutionalRows) {
    events.push({
      type: 'constitutional_event',
      timestamp: toIsoString(row.evaluated_at),
      agent_role: row.agent_role,
      description: `Constitutional adherence for ${row.agent_role} dropped to ${row.overall_adherence.toFixed(2)}${row.revision_triggered ? ' and triggered revision' : ''}.`,
      metadata: {
        overall_adherence: row.overall_adherence,
        revision_triggered: row.revision_triggered,
      },
    });
  }

  for (const row of amendmentRows) {
    events.push({
      type: 'constitutional_event',
      timestamp: toIsoString(row.created_at),
      agent_role: row.agent_role,
      description: `Amendment proposed by ${row.agent_role}: ${row.principle_text}`,
      metadata: {
        amendment_id: row.id,
        action: row.action,
        rationale: row.rationale,
      },
    });
  }

  return events
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

async function getRiskSummary(): Promise<GovernanceRiskSummary> {
  const [
    trustRows,
    currentTrustCountRows,
    driftCurrentRows,
    driftPreviousRows,
    policyCurrentRows,
    policyPreviousRows,
    complianceChecklistRows,
    complianceCurrentRows,
    compliancePreviousRows,
  ] = await Promise.all([
    systemQuery<{ score_history: unknown }>(
      'SELECT score_history FROM agent_trust_scores',
    ),
    systemQuery<{ count: number; critical_count: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE trust_score < 0.7)::int AS count,
         COUNT(*) FILTER (WHERE trust_score < 0.4)::int AS critical_count
       FROM agent_trust_scores`,
    ),
    systemQuery<{ count: number; critical_count: number }>(
      `SELECT
         COUNT(*)::int AS count,
         COUNT(*) FILTER (WHERE severity = 'critical')::int AS critical_count
       FROM drift_alerts
       WHERE acknowledged = false`,
    ),
    systemQuery<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM drift_alerts
       WHERE detected_at >= NOW() - INTERVAL '14 days'
         AND detected_at < NOW() - INTERVAL '7 days'`,
    ),
    systemQuery<{ avg_eval_score: number | null; active_count: number; recent_promoted: number; recent_rolled_back: number }>(
      `SELECT
         AVG(eval_score) FILTER (WHERE status = 'active') AS avg_eval_score,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
         COUNT(*) FILTER (
           WHERE status = 'active'
             AND COALESCE(promoted_at, created_at) >= NOW() - INTERVAL '30 days'
         )::int AS recent_promoted,
         COUNT(*) FILTER (
           WHERE status = 'rolled_back'
             AND COALESCE(rolled_back_at, created_at) >= NOW() - INTERVAL '30 days'
         )::int AS recent_rolled_back
       FROM policy_versions`,
    ),
    systemQuery<{ avg_eval_score: number | null }>(
      `SELECT AVG(eval_score) AS avg_eval_score
       FROM policy_versions
       WHERE status = 'active'
         AND COALESCE(promoted_at, created_at) >= NOW() - INTERVAL '60 days'
         AND COALESCE(promoted_at, created_at) < NOW() - INTERVAL '30 days'`,
    ),
    systemQuery<{ total: number; compliant: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'compliant')::int AS compliant
       FROM compliance_checklists`,
    ),
    systemQuery<{ avg_score: number | null }>(
      `SELECT AVG(overall_adherence) AS avg_score
       FROM constitutional_evaluations
       WHERE evaluated_at >= NOW() - INTERVAL '7 days'`,
    ),
    systemQuery<{ avg_score: number | null }>(
      `SELECT AVG(overall_adherence) AS avg_score
       FROM constitutional_evaluations
       WHERE evaluated_at >= NOW() - INTERVAL '14 days'
         AND evaluated_at < NOW() - INTERVAL '7 days'`,
    ),
  ]);

  const accessIssues = await getAccessIssues();
  const accessCurrentCount = accessIssues.length;
  const accessPreviousCount = accessIssues.filter(issue => new Date(issue.created_at).getTime() < Date.now() - 7 * 86_400_000).length;

  const trustCurrent = currentTrustCountRows[0]?.count ?? 0;
  const trustCritical = currentTrustCountRows[0]?.critical_count ?? 0;
  const trustPrevious = priorTrustAlertCount(trustRows);

  const driftCurrent = driftCurrentRows[0]?.count ?? 0;
  const driftCritical = driftCurrentRows[0]?.critical_count ?? 0;
  const driftPrevious = driftPreviousRows[0]?.count ?? 0;

  const policyAvg = round(toNumber(policyCurrentRows[0]?.avg_eval_score));
  const previousPolicyAvg = round(toNumber(policyPreviousRows[0]?.avg_eval_score));
  const recentPromoted = policyCurrentRows[0]?.recent_promoted ?? 0;
  const recentRolledBack = policyCurrentRows[0]?.recent_rolled_back ?? 0;
  const canaryPassRate = recentPromoted + recentRolledBack > 0
    ? round(recentPromoted / (recentPromoted + recentRolledBack))
    : null;
  const policySeverity = (policyAvg ?? 0) >= 0.9 && (canaryPassRate ?? 1) >= 0.9
    ? 'good'
    : ((policyAvg ?? 0) >= 0.7 ? 'warning' : 'critical');

  const complianceTotal = complianceChecklistRows[0]?.total ?? 0;
  const complianceCompliant = complianceChecklistRows[0]?.compliant ?? 0;
  const compliancePassRate = complianceTotal > 0 ? round(complianceCompliant / complianceTotal) : null;
  const complianceCurrentAvg = round(toNumber(complianceCurrentRows[0]?.avg_score));
  const compliancePreviousAvg = round(toNumber(compliancePreviousRows[0]?.avg_score));

  const accessSeverity = accessIssues.some(issue => issue.severity === 'critical')
    ? 'critical'
    : (accessCurrentCount > 0 ? 'warning' : 'good');

  return {
    trust_alerts: {
      count: trustCurrent,
      severity: trustCritical > 0 ? 'critical' : (trustCurrent > 0 ? 'warning' : 'good'),
      trend: trendForCounts(trustCurrent, trustPrevious),
      detail: `${trustCurrent} agent${trustCurrent === 1 ? '' : 's'} below threshold`,
    },
    drift_alerts: {
      count: driftCurrent,
      severity: driftCritical > 0 ? 'critical' : (driftCurrent > 0 ? 'warning' : 'good'),
      trend: trendForCounts(driftCurrent, driftPrevious),
      detail: `${driftCurrent} unacknowledged drift event${driftCurrent === 1 ? '' : 's'}`,
    },
    access_risk: {
      count: accessCurrentCount,
      severity: accessSeverity,
      trend: trendForCounts(accessCurrentCount, accessPreviousCount),
      detail: `${accessCurrentCount} access risk${accessCurrentCount === 1 ? '' : 's'} flagged`,
    },
    policy_health: {
      avg_eval_score: policyAvg,
      canary_pass_rate: canaryPassRate,
      severity: policySeverity,
      trend: trendForRates(policyAvg, previousPolicyAvg),
    },
    compliance: {
      pass_rate: compliancePassRate,
      severity: (compliancePassRate ?? 0) >= 0.9 ? 'good' : ((compliancePassRate ?? 0) >= 0.7 ? 'warning' : 'critical'),
      trend: trendForRates(complianceCurrentAvg, compliancePreviousAvg),
    },
  };
}

async function getTrustMap(): Promise<GovernanceTrustMapEntry[]> {
  const rows = await systemQuery<{
    department: string | null;
    agent_role: string;
    display_name: string | null;
    trust_score: number;
  }>(
    `SELECT
       COALESCE(ca.department, 'Unassigned') AS department,
       ats.agent_role,
       COALESCE(ca.display_name, ats.agent_role) AS display_name,
       ats.trust_score
     FROM agent_trust_scores ats
     LEFT JOIN company_agents ca ON ca.role = ats.agent_role
     ORDER BY COALESCE(ca.department, 'Unassigned') ASC, ats.trust_score DESC`,
  );

  return rows.map(row => ({
    department: row.department ?? 'Unassigned',
    agent_role: row.agent_role,
    display_name: row.display_name ?? row.agent_role,
    trust_score: row.trust_score,
    trust_color: row.trust_score >= 0.7 ? 'green' : (row.trust_score >= 0.4 ? 'yellow' : 'red'),
  }));
}

async function getLeastPrivilege(): Promise<GovernanceLeastPrivilegeDepartment[]> {
  const rows = await getGrantUsageRows();
  const grouped = new Map<string, GovernanceLeastPrivilegeDepartment>();

  for (const row of rows) {
    const lastReference = row.last_used_at ?? row.created_at;
    const daysSinceUse = daysSince(lastReference);
    if (row.uses_last_30d > 0 && daysSinceUse <= 90) continue;

    const severity = row.uses_last_30d === 0 && daysSinceUse > 90
      ? 'high'
      : (daysSinceUse > 30 ? 'medium' : 'low');
    const key = `${row.department ?? 'Unassigned'}::${row.agent_role}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        department: row.department ?? 'Unassigned',
        agent_role: row.agent_role,
        grants: [],
      });
    }
    grouped.get(key)!.grants.push({
      tool_name: row.tool_name,
      granted_at: toIsoString(row.created_at),
      reason: row.reason,
      uses_last_30d: row.uses_last_30d,
      days_since_use: daysSinceUse,
      severity,
    });
  }

  return [...grouped.values()]
    .map(group => ({
      ...group,
      grants: group.grants.sort((a, b) => ACTION_SEVERITY_ORDER[a.severity] - ACTION_SEVERITY_ORDER[b.severity] || b.days_since_use - a.days_since_use),
    }))
    .sort((a, b) => a.department.localeCompare(b.department) || a.agent_role.localeCompare(b.agent_role));
}

async function getAccessPosture(): Promise<GovernanceAccessPosture> {
  const [iamRows, secretRows, grantRows, issues] = await Promise.all([
    systemQuery<{ total: number; in_sync: number }>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE in_sync = true)::int AS in_sync
       FROM platform_iam_state`,
    ),
    systemQuery<{ total: number; healthy: number }>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (
           WHERE status <> 'expired'
             AND (expires_at IS NULL OR expires_at >= NOW() + INTERVAL '30 days')
         )::int AS healthy
       FROM platform_secret_rotation
       WHERE status <> 'rotated'`,
    ),
    getGrantUsageRows(),
    getAccessIssues(),
  ]);

  const iamTotal = iamRows[0]?.total ?? 0;
  const iamSyncRate = iamTotal > 0 ? ((iamRows[0]?.in_sync ?? 0) / iamTotal) * 100 : 100;

  const secretTotal = secretRows[0]?.total ?? 0;
  const secretHealthRate = secretTotal > 0 ? ((secretRows[0]?.healthy ?? 0) / secretTotal) * 100 : 100;

  const totalGrants = grantRows.length;
  const freshGrants = grantRows.filter(row => {
    const lastReference = row.last_used_at ?? row.created_at;
    return daysSince(lastReference) <= 90;
  }).length;
  const leastPrivilegeGrants = grantRows.filter(row => {
    const trustScore = toNumber(row.trust_score) ?? 0.5;
    const lastReference = row.last_used_at ?? row.created_at;
    return trustScore >= 0.5 && daysSince(lastReference) <= 90;
  }).length;

  const grantFreshnessRate = totalGrants > 0 ? (freshGrants / totalGrants) * 100 : 100;
  const leastPrivilegeScore = totalGrants > 0 ? (leastPrivilegeGrants / totalGrants) * 100 : 100;

  const score = (
    iamSyncRate * 0.3
    + secretHealthRate * 0.2
    + grantFreshnessRate * 0.2
    + leastPrivilegeScore * 0.3
  );

  return {
    score: Math.round(score),
    trend_vs_7d: 0,
    breakdown: {
      iam_sync_rate: round(iamSyncRate, 1) ?? 0,
      secret_health_rate: round(secretHealthRate, 1) ?? 0,
      grant_freshness_rate: round(grantFreshnessRate, 1) ?? 0,
      least_privilege_score: round(leastPrivilegeScore, 1) ?? 0,
    },
    issues: issues.slice(0, 12),
  };
}

export async function handleGovernanceApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  queryString: string,
  method: string,
): Promise<boolean> {
  if (!url.startsWith('/api/governance/')) return false;

  const send = (status: number, data: unknown) => writeJson(res, status, data, req);

  if (method !== 'GET') {
    send(405, { error: 'Method not allowed' });
    return true;
  }

  const resource = url.slice('/api/governance/'.length);
  const params = new URLSearchParams(queryString);

  try {
    switch (resource) {
      case 'action-queue':
        send( 200, await getActionQueue());
        return true;
      case 'changelog': {
        const days = Number.parseInt(params.get('days') ?? '7', 10);
        send( 200, await getChangeLog(Number.isFinite(days) ? days : 7));
        return true;
      }
      case 'risk-summary':
        send( 200, await getRiskSummary());
        return true;
      case 'trust-map':
        send( 200, await getTrustMap());
        return true;
      case 'least-privilege':
      case 'least-privilege-analysis':
        send( 200, await getLeastPrivilege());
        return true;
      case 'access-posture':
        send( 200, await getAccessPosture());
        return true;
      default:
        send( 404, { error: `Unknown governance API resource: ${resource}` });
        return true;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[GovernanceApi] ${resource} failed:`, message);
    send( 500, { error: message });
    return true;
  }
}
