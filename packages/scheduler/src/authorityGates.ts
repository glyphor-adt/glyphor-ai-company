/**
 * Authority Gates — Decision tier enforcement
 *
 * Validates whether an agent action requires approval before execution.
 * Used by the event router and agent tools to enforce the authority model.
 */

import type { CompanyAgentRole, DecisionTier } from '@glyphor/agent-runtime';

export interface AuthorityCheck {
  allowed: boolean;
  tier: DecisionTier;
  requiresApproval: boolean;
  assignTo?: string[];
  reason?: string;
}

/**
 * Green actions by role — no approval needed.
 */
const GREEN_ACTIONS: Record<CompanyAgentRole, Set<string>> = {
  'chief-of-staff': new Set([
    'compile_briefing', 'route_decision', 'log_activity', 'synthesize_report',
    'check_escalations', 'generate_briefing', 'morning_briefing', 'eod_summary', 'midday_digest',
    'on_demand', 'send_dm', 'orchestrate', 'agent365_mail_triage',
  ]),
  'cto': new Set([
    'model_fallback', 'cache_optimization', 'scale_within_budget',
    'staging_deploy', 'dependency_update', 'health_check',
    'platform_health_check', 'dependency_review',
    'rollback', 'incident_management', 'assign_task',
    'model_config', 'vercel_deploy', 'vercel_rollback',
    'on_demand', 'agent365_mail_triage',
  ]),
  'cpo': new Set([
    'usage_analysis', 'competitive_scan', 'feature_prioritization',
    'user_research', 'roadmap_analysis', 'weekly_usage_analysis',
    'on_demand', 'agent365_mail_triage',
  ]),
  'cmo': new Set([
    'blog_post', 'social_post', 'seo_analysis', 'case_study_draft',
    'content_calendar', 'generate_content', 'weekly_content_planning',
    'content_creation', 'audit',
    'on_demand', 'agent365_mail_triage',
  ]),
  'cfo': new Set([
    'cost_tracking', 'standard_report', 'margin_calculation',
    'financial_modeling', 'daily_cost_check',
    'audit', 'data_pull',
    'on_demand', 'agent365_mail_triage',
  ]),
  'clo': new Set([
    'regulatory_scan', 'contract_review', 'compliance_check',
    'on_demand', 'agent365_mail_triage',
  ]),
  'vp-sales': new Set([
    'account_research', 'roi_calculator', 'market_sizing',
    'kyc_research', 'proposal_draft', 'pipeline_review',
    'on_demand', 'agent365_mail_triage',
  ]),
  'vp-design': new Set([
    'design_audit', 'design_system_review',
    'audit',
    'on_demand', 'agent365_mail_triage',
  ]),
  // Sub-team members — tasks green (they operate under their exec's authority)
  'platform-engineer': new Set(['health_check', 'metrics_report', 'on_demand']),
  'quality-engineer': new Set(['qa_report', 'regression_check', 'on_demand']),
  'devops-engineer': new Set(['optimization_scan', 'pipeline_report', 'on_demand']),
  'user-researcher': new Set(['cohort_analysis', 'churn_signals', 'on_demand']),
  'competitive-intel': new Set(['landscape_scan', 'deep_dive', 'on_demand']),
  'content-creator': new Set(['blog_draft', 'social_batch', 'performance_review', 'on_demand']),
  'seo-analyst': new Set(['ranking_report', 'keyword_research', 'competitor_gap', 'on_demand']),
  'social-media-manager': new Set(['engagement_report', 'schedule_batch', 'mention_scan', 'on_demand']),
  'm365-admin': new Set(['channel_audit', 'user_audit', 'agent365_mail_triage', 'on_demand']),
  'global-admin': new Set(['access_audit', 'compliance_report', 'onboarding', 'agent365_mail_triage', 'on_demand']),
  'ui-ux-designer': new Set(['on_demand']),
  'frontend-engineer': new Set(['on_demand']),
  'design-critic': new Set(['on_demand']),
  'template-architect': new Set(['on_demand']),
  'ops': new Set([
    'health_check', 'freshness_check', 'cost_check', 'morning_status',
    'evening_status', 'on_demand', 'event_response',
    'retry_run', 'retry_sync', 'pause_agent', 'resume_agent',
    'create_incident', 'resolve_incident', 'trigger_agent',
    'send_dm', 'agent365_mail_triage',
  ]),
  // Research & Intelligence
  'vp-research': new Set(['decompose_research', 'qc_and_package_research', 'follow_up_research', 'on_demand']),
  'competitive-research-analyst': new Set(['research', 'on_demand']),
  'market-research-analyst': new Set(['research', 'on_demand']),
  'head-of-hr': new Set(['on_demand', 'agent365_mail_triage']),
  // Sales, Finance, Marketing, Operations specialists
  'bob-the-tax-pro': new Set(['on_demand']),
  'marketing-intelligence-analyst': new Set(['on_demand']),
  'adi-rose': new Set(['on_demand']),
  'platform-intel': new Set(['research', 'daily_scan', 'deep_analysis', 'on_demand']),
};

/**
 * Yellow actions — one founder required.
 */
const YELLOW_ACTIONS: Record<string, { assignTo: string[] }> = {
  'model_switch_costly': { assignTo: ['andrew'] },
  'roadmap_priority_change': { assignTo: ['kristina'] },
  'enterprise_outreach': { assignTo: ['kristina'] },
  'content_strategy_shift': { assignTo: ['kristina'] },
  'infra_scaling_costly': { assignTo: ['andrew'] },
  'publish_competitive_analysis': { assignTo: ['kristina'] },
  'production_deploy': { assignTo: ['andrew'] },
  'send_dm': { assignTo: ['kristina', 'andrew'] },
  'create_calendar_event': { assignTo: ['kristina', 'andrew'] },
};

/**
 * Red actions — both founders required.
 */
const RED_ACTIONS = new Set([
  'new_product_proposal',
  'pricing_change',
  'architecture_shift',
  'enterprise_deal_large',
  'brand_positioning_change',
  'budget_reallocation',
  'agent_roster_change',
  'high_cost_commitment',
]);

/**
 * Check whether an agent action is authorized, or requires escalation.
 */
export function checkAuthority(
  agentRole: CompanyAgentRole,
  action: string,
): AuthorityCheck {
  // Dedicated internal task for skill methodology A/B validation.
  // Keep green-tier so tests can run without founder approval queues.
  if (action === 'skill_test') {
    return { allowed: true, tier: 'green', requiresApproval: false };
  }

  // Check green (fully autonomous)
  const greenSet = GREEN_ACTIONS[agentRole];
  if (greenSet?.has(action)) {
    return { allowed: true, tier: 'green', requiresApproval: false };
  }

  // Check yellow (one founder)
  const yellowConfig = YELLOW_ACTIONS[action];
  if (yellowConfig) {
    return {
      allowed: false,
      tier: 'yellow',
      requiresApproval: true,
      assignTo: yellowConfig.assignTo,
      reason: `Action "${action}" requires approval from ${yellowConfig.assignTo.join(' and ')}`,
    };
  }

  // Check red (both founders)
  if (RED_ACTIONS.has(action)) {
    return {
      allowed: false,
      tier: 'red',
      requiresApproval: true,
      assignTo: ['kristina', 'andrew'],
      reason: `Action "${action}" requires approval from both founders`,
    };
  }

  // Unknown action — default to yellow, assign to both founders for safety
  return {
    allowed: false,
    tier: 'yellow',
    requiresApproval: true,
    assignTo: ['kristina', 'andrew'],
    reason: `Unknown action "${action}" — defaulting to yellow tier`,
  };
}
