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
    'check_escalations', 'generate_briefing', 'morning_briefing', 'eod_summary',
  ]),
  'cto': new Set([
    'model_fallback', 'cache_optimization', 'scale_within_budget',
    'staging_deploy', 'dependency_update', 'health_check',
    'platform_health_check', 'dependency_review',
  ]),
  'cpo': new Set([
    'usage_analysis', 'competitive_scan', 'feature_prioritization',
    'user_research', 'roadmap_analysis', 'weekly_usage_analysis',
  ]),
  'cmo': new Set([
    'blog_post', 'social_post', 'seo_analysis', 'case_study_draft',
    'content_calendar', 'generate_content', 'weekly_content_planning',
  ]),
  'cfo': new Set([
    'cost_tracking', 'standard_report', 'margin_calculation',
    'financial_modeling', 'daily_cost_check',
  ]),
  'vp-customer-success': new Set([
    'health_scoring', 'nurture_email', 'segment_update',
    'support_triage', 'churn_detection', 'daily_health_scoring',
  ]),
  'vp-sales': new Set([
    'account_research', 'roi_calculator', 'market_sizing',
    'kyc_research', 'proposal_draft', 'pipeline_review',
  ]),
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
