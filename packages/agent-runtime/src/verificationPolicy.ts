import type { PassType } from './reasoningEngine.js';

export type VerificationTier = 'none' | 'self_critique' | 'cross_model' | 'conditional';

export interface VerificationDecision {
  tier: VerificationTier;
  passes: PassType[];
  reason: string;
  conditionalEscalationThreshold?: number;
}

export interface VerificationPolicyContext {
  agentRole: string;
  configId: string;
  task: string;
  trustScore: number | null;
  turnsUsed: number;
  mutationToolsCalled: string[];
  output: string;
}

const TIER_0_CONFIG_IDS = new Set([
  'ops-health-check',
  'ops-freshness-check',
  'ops-cost-check',
  'ops-morning-status',
  'ops-evening-status',
  'support-triage-recurring',
  'social-media-morning',
  'social-media-afternoon',
  'seo-analyst-daily',
  'm365-admin-weekly-audit',
  'm365-admin-user-audit',
]);

const TIER_0_TASKS = new Set([
  'health_check',
  'freshness_check',
  'cost_check',
  'morning_status',
  'evening_status',
  'user_audit',
  'channel_audit',
]);

const CONDITIONAL_TASKS = new Set([
  'pipeline_review',
  'orchestrate',
]);

const FINANCIAL_LEGAL_ROLES = new Set([
  'cfo',
  'clo',
  'revenue-analyst',
  'cost-analyst',
  'bob-the-tax-pro',
  'tax-strategy-specialist',
  'data-integrity-auditor',
]);

const EXTERNAL_OUTPUT_TOOLS = new Set([
  'send_transactional_email',
  'publish_content',
  'schedule_publish',
  'send_proposal',
  'publish_deliverable',
]);

function hasNumericClaims(output: string): boolean {
  return /\b(?:\$?\d[\d,]*(?:\.\d+)?%?|\d+(?:\.\d+)?x)\b/.test(output);
}

export function determineVerificationTier(context: VerificationPolicyContext): VerificationDecision {
  const successfulMutationTools = context.mutationToolsCalled.filter(Boolean);
  const hasExternalOutput = successfulMutationTools.some((tool) => EXTERNAL_OUTPUT_TOOLS.has(tool));

  if (context.turnsUsed <= 2 && successfulMutationTools.length === 0) {
    return { tier: 'none', passes: [], reason: 'no-op run' };
  }

  if (TIER_0_CONFIG_IDS.has(context.configId) || TIER_0_TASKS.has(context.task)) {
    return { tier: 'none', passes: [], reason: 'routine monitoring run' };
  }

  if (context.task === 'work_loop' || context.task === 'proactive') {
    return { tier: 'none', passes: [], reason: 'low-priority internal work loop' };
  }

  if (hasExternalOutput) {
    return {
      tier: 'cross_model',
      passes: ['self_critique', 'cross_model'],
      reason: 'external-facing output',
    };
  }

  if (FINANCIAL_LEGAL_ROLES.has(context.agentRole) && hasNumericClaims(context.output)) {
    return {
      tier: 'cross_model',
      passes: ['self_critique', 'cross_model', 'factual_verification'],
      reason: 'financial/legal output with numeric claims',
    };
  }

  if (CONDITIONAL_TASKS.has(context.task)) {
    if ((context.trustScore ?? 0.5) < 0.7) {
      return {
        tier: 'cross_model',
        passes: ['self_critique', 'cross_model'],
        reason: 'high-stakes orchestration with low trust',
      };
    }

    return {
      tier: 'conditional',
      passes: ['self_critique'],
      reason: 'high-stakes orchestration with conditional escalation',
      conditionalEscalationThreshold: 0.8,
    };
  }

  return {
    tier: 'self_critique',
    passes: ['self_critique'],
    reason: 'standard green-tier work',
  };
}
