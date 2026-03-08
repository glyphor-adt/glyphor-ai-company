export type GovernanceActionSeverity = 'critical' | 'high' | 'medium' | 'low';

export type GovernanceActionType =
  | 'trust_alert'
  | 'decision'
  | 'drift_alert'
  | 'secret_expiry'
  | 'authority_proposal'
  | 'access_risk'
  | 'constitutional_failure'
  | 'canary_decision';

export interface GovernanceAction {
  type: GovernanceActionType;
  severity: GovernanceActionSeverity;
  title: string;
  description: string;
  agent_role?: string;
  impact?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export type GovernanceChangeLogEventType =
  | 'policy_change'
  | 'trust_change'
  | 'grant_change'
  | 'iam_change'
  | 'secret_change'
  | 'drift_event'
  | 'constitutional_event';

export interface GovernanceChangeLogEvent {
  type: GovernanceChangeLogEventType;
  timestamp: string;
  agent_role?: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export type GovernanceTrendDirection = 'up' | 'down' | 'flat';
export type GovernanceIndicatorSeverity = 'critical' | 'warning' | 'good';

export interface GovernanceRiskIndicator {
  severity: GovernanceIndicatorSeverity;
  trend: GovernanceTrendDirection;
}

export interface GovernanceTrustAlertSummary extends GovernanceRiskIndicator {
  count: number;
  detail: string;
}

export interface GovernanceDriftAlertSummary extends GovernanceRiskIndicator {
  count: number;
  detail: string;
}

export interface GovernanceAccessRiskSummary extends GovernanceRiskIndicator {
  count: number;
  detail: string;
}

export interface GovernancePolicyHealthSummary extends GovernanceRiskIndicator {
  avg_eval_score: number | null;
  canary_pass_rate: number | null;
}

export interface GovernanceComplianceSummary extends GovernanceRiskIndicator {
  pass_rate: number | null;
}

export interface GovernanceRiskSummary {
  trust_alerts: GovernanceTrustAlertSummary;
  drift_alerts: GovernanceDriftAlertSummary;
  access_risk: GovernanceAccessRiskSummary;
  policy_health: GovernancePolicyHealthSummary;
  compliance: GovernanceComplianceSummary;
}

export type GovernanceTrustColor = 'green' | 'yellow' | 'red';

export interface GovernanceTrustMapEntry {
  department: string;
  agent_role: string;
  display_name: string;
  trust_score: number;
  trust_color: GovernanceTrustColor;
}

export interface GovernanceLeastPrivilegeGrant {
  tool_name: string;
  granted_at: string;
  reason: string | null;
  uses_last_30d: number;
  days_since_use: number;
  severity: 'high' | 'medium' | 'low';
}

export interface GovernanceLeastPrivilegeDepartment {
  department: string;
  agent_role: string;
  grants: GovernanceLeastPrivilegeGrant[];
}

export type GovernanceAccessIssueType = 'secret' | 'iam_drift' | 'grant';

export interface GovernanceAccessIssue {
  type: GovernanceAccessIssueType;
  severity: GovernanceActionSeverity;
  title: string;
  description: string;
  created_at: string;
  agent_role?: string;
  platform?: string;
  recommended_action?: string;
  metadata?: Record<string, unknown>;
}

export interface GovernanceAccessPosture {
  score: number;
  trend_vs_7d: number;
  breakdown: {
    iam_sync_rate: number;
    secret_health_rate: number;
    grant_freshness_rate: number;
    least_privilege_score: number;
  };
  issues: GovernanceAccessIssue[];
}

export interface GovernancePolicyImpactCard {
  policy_id: string;
  name: string;
  status: 'active' | 'canary' | 'rolled_back';
  eval_score: number | null;
  promoted_at: string;
  metric_name: string;
  before_avg: number | null;
  after_avg: number | null;
  delta_pct: number | null;
  affected_agents: string[];
  source_pattern_id?: string;
}

export interface GovernanceComplianceHeatmapCell {
  department: string;
  principle: string;
  avg_score: number;
  evaluation_count: number;
}

export interface GovernanceAmendmentProposal {
  amendment_id: string;
  proposed_by: string;
  proposed_at: string;
  principle_name: string;
  current_rule: string;
  proposed_change: string;
  reason: string;
  failed_evals_count: number;
  status: 'pending';
  metadata?: Record<string, unknown>;
}
