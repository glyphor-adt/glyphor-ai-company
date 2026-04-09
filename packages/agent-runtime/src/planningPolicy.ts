import type { AgentConfig, CompanyAgentRole } from './types.js';
import { SCHEDULED_TOOL_EXECUTION_TASKS } from './supervisorWorkloadStallPolicy.js';

export type PlanningModelTier = 'fast' | 'default' | 'high';

export interface EffectivePlanningPolicy {
  planningMode: 'off' | 'auto' | 'required';
  completionGateEnabled: boolean;
  planningMaxAttempts: number;
  completionGateMaxRetries: number;
  completionGateAutoRepairEnabled: boolean;
  /** Stronger model during planning JSON phase (undefined = follow subtask routing). */
  planningModelTier?: PlanningModelTier;
  /** Tier for completion-gate JSON verifier (undefined = default tier). */
  completionGateVerifyModelTier?: PlanningModelTier;
}

interface PlanningPolicyOverrides {
  planningMode?: 'off' | 'auto' | 'required';
  completionGateEnabled?: boolean;
  planningMaxAttempts?: number;
  completionGateMaxRetries?: number;
  completionGateAutoRepairEnabled?: boolean;
  planningModelTier?: PlanningModelTier;
  completionGateVerifyModelTier?: PlanningModelTier;
}

interface PlanningPolicyConfig {
  default?: PlanningPolicyOverrides;
  roles?: Record<string, PlanningPolicyOverrides>;
  tasks?: Record<string, PlanningPolicyOverrides>;
}

const STRICT_ROLE_DEFAULTS = new Set<CompanyAgentRole>([
  'frontend-engineer',
  'vp-design',
  'ui-ux-designer',
]);

const TASK_ROLE_DEFAULTS = new Set<CompanyAgentRole>([
  'platform-engineer',
  'quality-engineer',
  'devops-engineer',
  'user-researcher',
  'competitive-intel',
  'content-creator',
  'seo-analyst',
  'social-media-manager',
  'template-architect',
  'design-critic',
  'market-research-analyst',
  'competitive-research-analyst',
  'platform-intel',
]);

function clampInt(value: unknown, fallback: number, min = 0, max = 10): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function loadPlanningPolicyConfigFromEnv(): PlanningPolicyConfig | null {
  const raw = process.env.AGENT_PLANNING_POLICY_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as PlanningPolicyConfig;
  } catch {
    console.warn('[planningPolicy] Failed to parse AGENT_PLANNING_POLICY_JSON; using built-in defaults.');
    return null;
  }
}

function mergeOverrides(
  base: EffectivePlanningPolicy,
  overrides: PlanningPolicyOverrides | undefined,
): EffectivePlanningPolicy {
  if (!overrides) return base;
  return {
    planningMode: overrides.planningMode ?? base.planningMode,
    completionGateEnabled: overrides.completionGateEnabled ?? base.completionGateEnabled,
    planningMaxAttempts: clampInt(overrides.planningMaxAttempts, base.planningMaxAttempts, 1, 8),
    completionGateMaxRetries: clampInt(overrides.completionGateMaxRetries, base.completionGateMaxRetries, 0, 8),
    completionGateAutoRepairEnabled:
      overrides.completionGateAutoRepairEnabled ?? base.completionGateAutoRepairEnabled,
    planningModelTier: overrides.planningModelTier !== undefined
      ? overrides.planningModelTier
      : base.planningModelTier,
    completionGateVerifyModelTier: overrides.completionGateVerifyModelTier !== undefined
      ? overrides.completionGateVerifyModelTier
      : base.completionGateVerifyModelTier,
  };
}

export function resolvePlanningPolicy(input: {
  role: CompanyAgentRole;
  task: string;
  config: AgentConfig;
  taskTierHint?: boolean;
}): EffectivePlanningPolicy {
  let policy: EffectivePlanningPolicy;
  if (input.task === 'on_demand') {
    policy = {
      planningMode: 'off',
      completionGateEnabled: false,
      planningMaxAttempts: 1,
      completionGateMaxRetries: 0,
      completionGateAutoRepairEnabled: false,
    };
  } else if (
    input.task === 'work_loop'
    || input.task === 'proactive'
    || input.task === 'process_assignments'
    || input.task === 'urgent_message_response'
    || input.task === 'incident_response'
    || input.task === 'event_message_sent'
    || input.task === 'heartbeat_response'
    || input.task === 'agent365_mail_triage'
    || input.task === 'weekly_content_planning'
    || input.task === 'generate_content'
    || input.task === 'seo_analysis'
    || input.task === 'content_planning_cycle'
  ) {
    // Heartbeat / sweep / urgent wakes must see tools from turn 1. A JSON-only planning phase here
    // often yields long "thinking" loops with zero tool_call rows, huge token burn, and supervisor stall.
    policy = {
      planningMode: 'off',
      completionGateEnabled: false,
      planningMaxAttempts: 1,
      completionGateMaxRetries: 0,
      completionGateAutoRepairEnabled: false,
    };
  } else if (STRICT_ROLE_DEFAULTS.has(input.role)) {
    policy = {
      planningMode: 'required',
      completionGateEnabled: true,
      planningMaxAttempts: 2,
      completionGateMaxRetries: 2,
      completionGateAutoRepairEnabled: false,
      planningModelTier: 'high',
      completionGateVerifyModelTier: 'high',
    };
  } else if (TASK_ROLE_DEFAULTS.has(input.role) || input.taskTierHint === true) {
    policy = {
      planningMode: 'auto',
      completionGateEnabled: true,
      planningMaxAttempts: 2,
      completionGateMaxRetries: 2,
      completionGateAutoRepairEnabled: false,
    };
  } else {
    policy = {
      planningMode: 'off',
      completionGateEnabled: false,
      planningMaxAttempts: 1,
      completionGateMaxRetries: 0,
      completionGateAutoRepairEnabled: false,
    };
  }

  const envConfig = loadPlanningPolicyConfigFromEnv();
  policy = mergeOverrides(policy, envConfig?.default);
  policy = mergeOverrides(policy, envConfig?.roles?.[input.role]);
  policy = mergeOverrides(policy, envConfig?.tasks?.[input.task]);

  policy = mergeOverrides(policy, {
    planningMode: input.config.planningMode,
    completionGateEnabled: input.config.completionGateEnabled,
    planningMaxAttempts: input.config.planningMaxAttempts,
    completionGateMaxRetries: input.config.completionGateMaxRetries,
    completionGateAutoRepairEnabled: input.config.completionGateAutoRepairEnabled,
    planningModelTier: input.config.planningModelTier,
    completionGateVerifyModelTier: input.config.completionGateVerifyModelTier,
  });

  if (policy.planningMode === 'off') {
    policy.completionGateEnabled = false;
  }

  // Hard override: never run JSON-only planning for scheduled content tasks — tools must be wired from turn 1.
  if (SCHEDULED_TOOL_EXECUTION_TASKS.has(input.task)) {
    policy = mergeOverrides(policy, {
      planningMode: 'off',
      completionGateEnabled: false,
      planningMaxAttempts: 1,
      completionGateMaxRetries: 0,
      completionGateAutoRepairEnabled: false,
    });
  }

  return policy;
}
