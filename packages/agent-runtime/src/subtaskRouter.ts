import type { ActionReceipt, CompanyAgentRole, ConversationTurn } from './types.js';
import { inferCapabilities } from './routing/inferCapabilities.js';
import { resolveModelConfig, type RoutingDecision } from './routing/resolveModel.js';

export type SubtaskComplexity = 'trivial' | 'standard' | 'complex' | 'frontier';

export interface SubtaskClassification {
  complexity: SubtaskComplexity;
  requiresReasoning: boolean;
  requiresCreativity: boolean;
  requiresFactualGrounding: boolean;
  estimatedTokens: number;
  capabilities: string[];
}

export interface SubtaskRoutingContext {
  role: CompanyAgentRole | string;
  task: string;
  history: ConversationTurn[];
  toolNames: string[];
  trustScore?: number | null;
  currentModel?: string;
  department?: string | null;
  lastTextOutput?: string | null;
  actionReceipts?: ActionReceipt[];
}

export interface SubtaskRoutingDecision {
  classification: SubtaskClassification;
  routing: RoutingDecision;
  reason: string;
}

const DEFAULT_MODEL = 'gpt-5-mini-2025-08-07';
const COMPLEXITY_RANK: Record<SubtaskComplexity, number> = {
  trivial: 0,
  standard: 1,
  complex: 2,
  frontier: 3,
};

export function compareSubtaskComplexity(left: SubtaskComplexity, right: SubtaskComplexity): number {
  return COMPLEXITY_RANK[left] - COMPLEXITY_RANK[right];
}

function estimateContextTokens(history: ConversationTurn[], lastTextOutput?: string | null): number {
  const recentTurns = history.slice(-8);
  const charCount = recentTurns.reduce((sum, turn) => sum + (turn.content?.length ?? 0), 0) + (lastTextOutput?.length ?? 0);
  return Math.ceil(charCount / 4);
}

function buildTurnContext(history: ConversationTurn[], actionReceipts: ActionReceipt[] = [], lastTextOutput?: string | null): string {
  const recentTurns = history
    .slice(-6)
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join('\n');

  const recentTools = actionReceipts
    .slice(-4)
    .map((receipt) => `${receipt.tool}:${receipt.result}`)
    .join(', ');

  return [
    recentTurns,
    lastTextOutput ? `latest_output: ${lastTextOutput.slice(0, 500)}` : '',
    recentTools ? `recent_tools: ${recentTools}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function classifySubtask(context: SubtaskRoutingContext): SubtaskClassification {
  const promptContext = buildTurnContext(context.history, context.actionReceipts, context.lastTextOutput);
  const capabilities = inferCapabilities({
    role: context.role,
    task: context.task,
    message: promptContext,
    toolNames: context.toolNames,
    department: context.department,
    trustScore: context.trustScore,
  });
  const selected = new Set(capabilities);
  const estimatedTokens = estimateContextTokens(context.history, context.lastTextOutput);

  let complexity: SubtaskComplexity = 'trivial';
  if (
    estimatedTokens > 12000 ||
    selected.has('many_tools') ||
    (selected.has('code_generation') && selected.has('needs_apply_patch')) ||
    (selected.has('high_complexity') && (
      selected.has('orchestration') ||
      selected.has('legal_reasoning') ||
      selected.has('financial_computation')
    ))
  ) {
    complexity = 'frontier';
  } else if (
    estimatedTokens > 6000 ||
    selected.has('high_complexity') ||
    selected.has('web_research') ||
    selected.has('legal_reasoning') ||
    selected.has('financial_computation') ||
    selected.has('visual_analysis')
  ) {
    complexity = 'complex';
  } else if (
    estimatedTokens > 1800 ||
    selected.has('creative_writing') ||
    selected.has('nuanced_evaluation') ||
    selected.has('structured_extraction') ||
    selected.has('orchestration')
  ) {
    complexity = 'standard';
  }

  return {
    complexity,
    requiresReasoning: complexity !== 'trivial' || selected.has('high_complexity') || selected.has('nuanced_evaluation'),
    requiresCreativity: selected.has('creative_writing'),
    requiresFactualGrounding:
      selected.has('web_research') ||
      selected.has('legal_reasoning') ||
      selected.has('financial_computation') ||
      selected.has('needs_citations') ||
      selected.has('structured_extraction'),
    estimatedTokens,
    capabilities,
  };
}

export function selectSubtaskModel(
  context: SubtaskRoutingContext,
  classification: SubtaskClassification,
): RoutingDecision {
  const promptContext = buildTurnContext(context.history, context.actionReceipts, context.lastTextOutput);
  let decision = resolveModelConfig({
    role: context.role,
    task: context.task,
    message: promptContext,
    toolNames: context.toolNames,
    department: context.department,
    trustScore: context.trustScore,
    currentModel: context.currentModel ?? DEFAULT_MODEL,
    capabilities: classification.capabilities,
  });

  if (
    classification.complexity === 'frontier' &&
    (decision.model === 'gpt-5-nano' || decision.model === DEFAULT_MODEL)
  ) {
    decision = {
      ...decision,
      model: 'claude-sonnet-4-6',
      routingRule: 'frontier_subtask',
      reasoningEffort: 'high',
      claudeEffort: 'high',
      claudeThinking: 'adaptive',
      enableCompaction: true,
    };
  } else if (classification.complexity === 'complex' && decision.model === 'gpt-5-nano') {
    decision = {
      ...decision,
      model: DEFAULT_MODEL,
      routingRule: 'complex_subtask',
      reasoningEffort: 'medium',
      verbosity: 'medium',
    };
  }

  return decision;
}

function summarizeClassification(classification: SubtaskClassification): string {
  const requirements: string[] = [];
  if (classification.requiresReasoning) requirements.push('reasoning');
  if (classification.requiresCreativity) requirements.push('creativity');
  if (classification.requiresFactualGrounding) requirements.push('grounding');
  return requirements.length > 0 ? requirements.join(', ') : 'lightweight execution';
}

export function routeSubtask(context: SubtaskRoutingContext): SubtaskRoutingDecision {
  const classification = classifySubtask(context);
  const routing = selectSubtaskModel(context, classification);
  return {
    classification,
    routing,
    reason: `${classification.complexity} subtask with ${summarizeClassification(classification)} (${routing.routingRule})`,
  };
}
