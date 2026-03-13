import type { ModelRoutingMetadata } from '../providers/types.js';
import { inferCapabilities, type RoutingContext } from './inferCapabilities.js';

const DEFAULT_MODEL = 'gpt-5-mini-2025-08-07';
const PREMIUM_ANTHROPIC_ENABLED = process.env.ENABLE_PREMIUM_ANTHROPIC === 'true';
const CODE_INTENSIVE_ROLES = new Set([
  'platform-engineer',
  'quality-engineer',
  'devops-engineer',
  'frontend-engineer',
  'template-architect',
  'cto',
]);

function isCodeCentricContext(context: RoutingContext): boolean {
  const role = String(context.role ?? '').toLowerCase();
  if (CODE_INTENSIVE_ROLES.has(role)) return true;

  const taskAndMessage = `${context.task ?? ''} ${context.message ?? ''}`.toLowerCase();
  return /(code|coding|implement|implementation|bug|fix|patch|refactor|compile|build|test|tests|pull request|pr review|typescript|javascript|sql|migration)/.test(taskAndMessage);
}

export interface RoutingDecision extends ModelRoutingMetadata {}

export function resolveModelConfig(
  context: RoutingContext & { currentModel?: string; capabilities?: string[] },
): RoutingDecision {
  const capabilities = (context.capabilities as string[] | undefined) ?? inferCapabilities(context);
  const selected = new Set(capabilities);
  const currentModel = context.currentModel ?? DEFAULT_MODEL;
  const deterministicTask = new Set([
    'health_check',
    'freshness_check',
    'cost_check',
    'daily_cost_check',
    'triage_queue',
    'platform_health_check',
  ]).has(context.task);

  let decision: RoutingDecision = {
    model: currentModel,
    routingRule: 'respect_existing_model',
    capabilities,
  };

  const shouldUsePremiumCodeModel =
    selected.has('code_generation') &&
    (selected.has('needs_apply_patch') || selected.has('needs_tool_search')) &&
    isCodeCentricContext(context);
  const highComplexity = selected.has('high_complexity');
  const canUsePremiumAnthropic = PREMIUM_ANTHROPIC_ENABLED && highComplexity;

  if (deterministicTask && selected.has('deterministic_possible')) {
    decision = {
      model: '__deterministic__',
      routingRule: 'deterministic_skip',
      capabilities,
      reasoningEffort: 'minimal',
      verbosity: 'low',
    };
  } else if (shouldUsePremiumCodeModel) {
    decision = {
      model: 'gpt-5.4',
      routingRule: selected.has('needs_apply_patch') ? 'standard_code_gen' : 'code_generation',
      capabilities,
      reasoningEffort: selected.has('high_complexity') ? 'high' : 'medium',
      verbosity: 'medium',
      enableApplyPatch: selected.has('needs_apply_patch'),
      enableToolSearch: selected.has('many_tools'),
    };
  } else if (selected.has('code_generation')) {
    decision = {
      model: DEFAULT_MODEL,
      routingRule: 'code_read_only',
      capabilities,
      reasoningEffort: selected.has('high_complexity') ? 'medium' : 'low',
      verbosity: 'medium',
      enableToolSearch: selected.has('many_tools'),
    };
  } else if (selected.has('financial_computation')) {
    decision = {
      model: selected.has('high_complexity') ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
      routingRule: 'financial_compute',
      capabilities,
      reasoningEffort: selected.has('high_complexity') ? 'high' : 'medium',
      enableCodeExecution: true,
    };
  } else if (selected.has('legal_reasoning')) {
    decision = {
      model: canUsePremiumAnthropic ? 'claude-sonnet-4-6' : 'gemini-3.1-flash-lite-preview',
      routingRule: 'grounded_legal_research',
      capabilities,
      reasoningEffort: highComplexity ? 'high' : 'medium',
      claudeEffort: canUsePremiumAnthropic ? 'high' : 'medium',
      claudeThinking: canUsePremiumAnthropic ? 'adaptive' : 'manual',
      enableCitations: true,
      enableCompaction: true,
    };
  } else if (selected.has('creative_writing') || selected.has('nuanced_evaluation')) {
    decision = {
      model: canUsePremiumAnthropic ? 'claude-sonnet-4-6' : 'gemini-3.1-flash-lite-preview',
      routingRule: selected.has('creative_writing') ? 'creative_writing' : 'nuanced_evaluation',
      capabilities,
      reasoningEffort: highComplexity ? 'high' : 'medium',
      claudeEffort: canUsePremiumAnthropic ? 'high' : 'medium',
      claudeThinking: canUsePremiumAnthropic ? 'adaptive' : 'manual',
      enableCompaction: true,
    };
  } else if (selected.has('web_research')) {
    decision = {
      model: 'gemini-3.1-pro-preview',
      routingRule: 'grounded_research',
      capabilities,
      reasoningEffort: selected.has('high_complexity') ? 'high' : 'medium',
      enableCitations: true,
      enableCompaction: true,
      enableGoogleSearch: selected.has('web_research'),
    };
  } else if (selected.has('visual_analysis')) {
    decision = {
      model: 'gemini-3.1-pro-preview',
      routingRule: 'visual_analysis',
      capabilities,
      reasoningEffort: selected.has('high_complexity') ? 'medium' : 'low',
    };
  } else if (selected.has('deterministic_possible')) {
    decision = {
      model: '__deterministic__',
      routingRule: 'deterministic_skip',
      capabilities,
      reasoningEffort: 'minimal',
      verbosity: 'low',
    };
  } else if (selected.has('low_complexity')) {
    decision = {
      model: 'gpt-5-nano',
      routingRule: 'low_complexity_default',
      capabilities,
      reasoningEffort: 'minimal',
      verbosity: 'low',
    };
  } else if (currentModel === DEFAULT_MODEL) {
    decision = {
      model: DEFAULT_MODEL,
      routingRule: 'default_generalist',
      capabilities,
      reasoningEffort: 'low',
      verbosity: 'medium',
    };
  }

  if ((context.trustScore ?? 0.5) < 0.45) {
    if (decision.model === 'gpt-5-nano') {
      decision.model = DEFAULT_MODEL;
      decision.routingRule = 'low_trust_escalation';
    }
    decision.reasoningEffort = 'high';
  }

  return decision;
}
