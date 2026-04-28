/**
 * Authority Gates — Decision tier enforcement
 *
 * Validates whether an agent action requires approval before execution.
 * Used by the event router and agent tools to enforce the authority model.
 *
 * Authority is resolved in order:
 *   1. Per-agent DB column `company_agents.authority_scope` (green|yellow|red)
 *   2. Dynamic trust promotion/demotion via `agent_trust_scores`
 *   3. Hardcoded GREEN/YELLOW/RED action maps (fallback)
 */

import type { CompanyAgentRole, DecisionTier } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

// ─── Trust thresholds (mirror packages/agent-runtime/src/trustScorer.ts) ────
const PROMOTION_THRESHOLD = 0.85;
const DEMOTION_THRESHOLD = 0.4;

export interface AuthorityCheck {
  allowed: boolean;
  tier: DecisionTier;
  requiresApproval: boolean;
  assignTo?: string[];
  reason?: string;
}

const CALENDAR_GOVERNED_ACTIONS = [
  'create_calendar_event',
  'evaluate_calendar_mcp_founder_create_event',
  'CreateEvent',
  'mcp_CalendarTools.CreateEvent',
  'mcp_CalendarTools/CreateEvent',
] as const;

/**
 * Green actions by role — no approval needed.
 */
const GREEN_ACTIONS: Record<CompanyAgentRole, Set<string>> = {
  'chief-of-staff': new Set([
    'compile_briefing', 'route_decision', 'log_activity', 'synthesize_report',
    'check_escalations', 'generate_briefing', 'morning_briefing', 'eod_summary', 'midday_digest',
    'on_demand', 'send_dm', 'orchestrate', 'process_directive', 'agent365_mail_triage',
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
    'content_creation', 'audit', 'onboarding_ingestion',
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
  'vp-design': new Set([
    'design_audit', 'design_system_review',
    'audit',
    'on_demand', 'agent365_mail_triage',
  ]),
  // Sub-team members — tasks green (they operate under their exec's authority)
  'platform-engineer': new Set(['health_check', 'metrics_report', 'on_demand']),
  'quality-engineer': new Set(['qa_report', 'regression_check', 'on_demand']),
  'devops-engineer': new Set(['optimization_scan', 'pipeline_report', 'on_demand']),
  'ops': new Set([
    'health_check', 'freshness_check', 'cost_check', 'morning_status',
    'evening_status', 'on_demand', 'event_response',
    'retry_run', 'retry_sync', 'pause_agent', 'resume_agent',
    'create_incident', 'resolve_incident', 'trigger_agent',
    'send_dm', 'agent365_mail_triage',
  ]),
  // Research & Intelligence
  'vp-research': new Set(['decompose_research', 'qc_and_package_research', 'follow_up_research', 'on_demand']),
  // Sales, Finance, Marketing, Operations specialists
  'bob-the-tax-pro': new Set(['on_demand']),
  'marketing-intelligence-analyst': new Set(['on_demand']),
  'adi-rose': new Set(['on_demand']),
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
};

for (const action of CALENDAR_GOVERNED_ACTIONS) {
  YELLOW_ACTIONS[action] = { assignTo: ['kristina', 'andrew'] };
}

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
 * Query the per-agent authority_scope from DB plus their trust score.
 * Returns null if agent isn't in DB (fallback to hardcoded maps).
 */
async function getAgentAuthorityFromDb(
  agentRole: string,
): Promise<{ authorityScope: DecisionTier; trustScore: number; autoPromotionEligible: boolean } | null> {
  try {
    const rows = await systemQuery<{
      authority_scope: string;
      trust_score: number | null;
      auto_promotion_eligible: boolean | null;
    }>(
      `SELECT ca.authority_scope,
              ts.trust_score,
              ts.auto_promotion_eligible
       FROM company_agents ca
       LEFT JOIN agent_trust_scores ts ON ts.agent_role = ca.role
       WHERE ca.role = $1`,
      [agentRole],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      authorityScope: (row.authority_scope ?? 'green') as DecisionTier,
      trustScore: row.trust_score ?? 0.5,
      autoPromotionEligible: row.auto_promotion_eligible ?? false,
    };
  } catch (err) {
    console.warn('[AuthorityGates] DB lookup failed, falling back to hardcoded maps:', (err as Error).message);
    return null;
  }
}

/**
 * Apply trust-based promotion/demotion to a base authority tier.
 * Mirrors TrustScorer.getEffectiveAuthority() but runs in-process.
 */
function applyTrustAdjustment(
  baseTier: DecisionTier,
  trustScore: number,
  autoPromotionEligible: boolean,
): DecisionTier {
  // Promotion: yellow → green for high-trust agents
  if (baseTier === 'yellow' && trustScore >= PROMOTION_THRESHOLD && autoPromotionEligible) {
    return 'green';
  }
  // Demotion: green → yellow for low-trust agents
  if (baseTier === 'green' && trustScore < DEMOTION_THRESHOLD) {
    return 'yellow';
  }
  // red never gets promoted
  return baseTier;
}

/**
 * Check whether an agent action is authorized, or requires escalation.
 *
 * Resolution order:
 *   1. Static overrides (skill_test → always green)
 *   2. Hardcoded RED/YELLOW action sets (apply regardless of agent's DB scope)
 *   3. Per-agent DB authority_scope + trust score → effective tier
 *   4. Hardcoded GREEN action set (fallback if no DB row)
 *   5. Unknown action → yellow (both founders)
 */
export async function checkAuthority(
  agentRole: CompanyAgentRole,
  action: string,
): Promise<AuthorityCheck> {
  // Dedicated internal task for skill methodology A/B validation.
  if (action === 'skill_test') {
    return { allowed: true, tier: 'green', requiresApproval: false };
  }

  // Red actions always require both founders, regardless of DB scope.
  if (RED_ACTIONS.has(action)) {
    return {
      allowed: false,
      tier: 'red',
      requiresApproval: true,
      assignTo: ['kristina', 'andrew'],
      reason: `Action "${action}" requires approval from both founders`,
    };
  }

  // Yellow actions always require one+ founder approval.
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

  // ── DB-driven authority with trust adjustment ──────────────────
  const dbAuth = await getAgentAuthorityFromDb(agentRole);

  if (dbAuth) {
    const effectiveTier = applyTrustAdjustment(
      dbAuth.authorityScope,
      dbAuth.trustScore,
      dbAuth.autoPromotionEligible,
    );

    if (effectiveTier === 'green') {
      // DB says agent has green scope (or was promoted) — check if action is
      // in its hardcoded green set *or* if the DB scope explicitly grants it
      const greenSet = GREEN_ACTIONS[agentRole];
      if (greenSet?.has(action) || dbAuth.authorityScope === 'green') {
        return {
          allowed: true,
          tier: 'green',
          requiresApproval: false,
          reason: dbAuth.trustScore >= PROMOTION_THRESHOLD && dbAuth.authorityScope !== 'green'
            ? `Trust-promoted (${dbAuth.trustScore.toFixed(2)}) from ${dbAuth.authorityScope} → green`
            : undefined,
        };
      }
    }

    if (effectiveTier === 'yellow') {
      return {
        allowed: false,
        tier: 'yellow',
        requiresApproval: true,
        assignTo: ['kristina', 'andrew'],
        reason: dbAuth.trustScore < DEMOTION_THRESHOLD && dbAuth.authorityScope === 'green'
          ? `Trust-demoted (${dbAuth.trustScore.toFixed(2)}) from green → yellow for action "${action}"`
          : `Agent "${agentRole}" authority_scope is yellow — action "${action}" requires approval`,
      };
    }

    if (effectiveTier === 'red') {
      return {
        allowed: false,
        tier: 'red',
        requiresApproval: true,
        assignTo: ['kristina', 'andrew'],
        reason: `Agent "${agentRole}" authority_scope is red — action "${action}" requires approval from both founders`,
      };
    }
  }

  // ── Fallback: hardcoded maps (no DB row for this agent) ────────
  const greenSet = GREEN_ACTIONS[agentRole];
  if (greenSet?.has(action)) {
    return { allowed: true, tier: 'green', requiresApproval: false };
  }

  // Unknown action — default to yellow for safety
  return {
    allowed: false,
    tier: 'yellow',
    requiresApproval: true,
    assignTo: ['kristina', 'andrew'],
    reason: `Unknown action "${action}" — defaulting to yellow tier`,
  };
}
