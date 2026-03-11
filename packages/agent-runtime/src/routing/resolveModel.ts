import type { ModelRoutingMetadata } from '../providers/types.js';
import { inferCapabilities, type RoutingContext } from './inferCapabilities.js';

const DEFAULT_MODEL = 'gpt-5-mini-2025-08-07';

export interface RoutingDecision extends ModelRoutingMetadata {}

export function resolveModelConfig(
  context: RoutingContext & { currentModel?: string; capabilities?: string[] },
): RoutingDecision {
  const capabilities = (context.capabilities as string[] | undefined) ?? inferCapabilities(context);
  const selected = new Set(capabilities);
  const currentModel = context.currentModel ?? DEFAULT_MODEL;

  let decision: RoutingDecision = {
    model: currentModel,
    routingRule: 'respect_existing_model',
    capabilities,
  };

  if (selected.has('code_generation')) {
    decision = {
      model: 'gpt-5.4',
      routingRule: selected.has('needs_apply_patch') ? 'standard_code_gen' : 'code_generation',
      capabilities,
      reasoningEffort: selected.has('high_complexity') ? 'high' : 'medium',
      verbosity: 'medium',
      enableApplyPatch: selected.has('needs_apply_patch'),
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
  } else if (selected.has('legal_reasoning') || selected.has('web_research')) {
    decision = {
      model: selected.has('high_complexity') ? 'claude-sonnet-4-6' : 'gemini-3.1-pro-preview',
      routingRule: selected.has('legal_reasoning') ? 'grounded_legal_research' : 'grounded_research',
      capabilities,
      reasoningEffort: selected.has('high_complexity') ? 'high' : 'medium',
      claudeEffort: selected.has('high_complexity') ? 'high' : 'medium',
      claudeThinking: selected.has('high_complexity') ? 'adaptive' : 'manual',
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
