import type { ActionReceipt, CompanyAgentRole, ConversationTurn } from './types.js';
import { inferCapabilities } from './routing/inferCapabilities.js';
import { resolveModelConfig, type RoutingDecision } from './routing/resolveModel.js';
import { inferDomainRouting } from './routing/domainRouter.js';
import { DEFAULT_AGENT_MODEL } from '@glyphor/shared/models';
import { getSpecialized, getTierModel } from '@glyphor/shared';

export type SubtaskComplexity = 'trivial' | 'standard' | 'complex' | 'frontier';

export interface SubtaskClassification {
  complexity: SubtaskComplexity;
  requiresReasoning: boolean;
  requiresCreativity: boolean;
  requiresFactualGrounding: boolean;
  estimatedTokens: number;
  capabilities: string[];
  primaryDomain?: string;
  crossDomain?: boolean;
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

const DEFAULT_MODEL = getTierModel('default');
const FAST_MODEL = getTierModel('fast');
const HIGH_MODEL = getTierModel('high');
const CODE_MODEL = getSpecialized('code_generation');
const WORKHORSE_FALLBACK_MODEL = getSpecialized('web_search');
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
  const estimatedTokens = estimateContextTokens(context.history, context.lastTextOutput);
  const promptContext = buildTurnContext(context.history, context.actionReceipts, context.lastTextOutput);
  const domainRouting = inferDomainRouting({
    role: context.role,
    task: context.task,
    message: promptContext,
    toolNames: context.toolNames,
    department: context.department,
  });
  const noOpTask =
    (context.task === 'work_loop' || context.task === 'proactive') &&
    estimatedTokens <= 400 &&
    (context.actionReceipts?.length ?? 0) === 0;

  if (noOpTask) {
    return {
      complexity: 'trivial',
      requiresReasoning: false,
      requiresCreativity: false,
      requiresFactualGrounding: false,
      estimatedTokens,
      capabilities: ['low_complexity', 'deterministic_possible', 'batch_eligible'],
      primaryDomain: domainRouting.primaryDomain ?? undefined,
      crossDomain: domainRouting.crossDomain,
    };
  }

  const capabilities = inferCapabilities({
    role: context.role,
    task: context.task,
    message: promptContext,
    toolNames: context.toolNames,
    department: context.department,
    trustScore: context.trustScore,
  });
  const selected = new Set(capabilities);

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
    domainRouting.crossDomain ||
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
    primaryDomain: domainRouting.primaryDomain ?? undefined,
    crossDomain: domainRouting.crossDomain,
  };
}

const MESSAGE_CODE_SIGNAL = /\b(code|typescript|javascript|tsconfig|bug|fix|build|compile|refactor|component|module|function|class|import|endpoint|route|handler|middleware|schema|migration|dockerfile|deploy|git|pr|merge|lint|syntax|variable|exception|debug)\b/i;

export async function selectSubtaskModel(
  context: SubtaskRoutingContext,
  classification: SubtaskClassification,
): Promise<RoutingDecision> {
  const promptContext = buildTurnContext(context.history, context.actionReceipts, context.lastTextOutput);
  let decision = await resolveModelConfig({
    role: context.role,
    task: context.task,
    message: promptContext,
    toolNames: context.toolNames,
    department: context.department,
    trustScore: context.trustScore,
    currentModel: context.currentModel ?? DEFAULT_MODEL,
    capabilities: classification.capabilities,
  });

  // Build full user message text for code signal detection
  const userMessageText = context.history.map(t => t.content ?? '').join(' ');
  const messageHasCodeSignal = MESSAGE_CODE_SIGNAL.test(userMessageText);

  const workhorseForFrontierEscalation =
    decision.model === FAST_MODEL
    || decision.model === DEFAULT_MODEL
    || decision.model === DEFAULT_AGENT_MODEL
    || decision.model === WORKHORSE_FALLBACK_MODEL;
  const codeEditEscalationNeeded =
    messageHasCodeSignal
    && (classification.capabilities.includes('code_generation') || classification.capabilities.includes('needs_apply_patch'))
    && (
      decision.model === DEFAULT_MODEL
      || decision.model === DEFAULT_AGENT_MODEL
      || decision.model === FAST_MODEL
    );

  if (codeEditEscalationNeeded) {
    decision = {
      ...decision,
      model: CODE_MODEL,
      routingRule: 'code_edit_subtask',
      reasoningEffort: 'high',
      enableCompaction: true,
    };
  } else

  if (classification.complexity === 'frontier' && workhorseForFrontierEscalation) {
    decision = {
      ...decision,
      model: HIGH_MODEL,
      routingRule: 'frontier_subtask',
      reasoningEffort: 'high',
      enableCompaction: true,
    };
  } else if (classification.complexity === 'complex' && decision.model === FAST_MODEL) {
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
  if (classification.primaryDomain) requirements.push(`domain:${classification.primaryDomain}`);
  if (classification.crossDomain) requirements.push('cross-domain');
  return requirements.length > 0 ? requirements.join(', ') : 'lightweight execution';
}

export async function routeSubtask(context: SubtaskRoutingContext): Promise<SubtaskRoutingDecision> {
  const classification = classifySubtask(context);
  const routing = await selectSubtaskModel(context, classification);
  return {
    classification,
    routing,
    reason: `${classification.complexity} subtask with ${summarizeClassification(classification)} (${routing.routingRule})`,
  };
}
