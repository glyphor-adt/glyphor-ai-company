import type { CompanyAgentRole } from '../types.js';
import type { Capability } from './capabilities.js';
import { HIGH_COMPLEXITY_CAPABILITIES } from './capabilities.js';
import { TOOL_CAPABILITY_MAP } from './toolCapabilityMap.js';

export interface RoutingContext {
  role: CompanyAgentRole | string;
  task: string;
  message: string;
  toolNames: string[];
  trustScore?: number | null;
}

const EXECUTIVE_ROLES = new Set<string>([
  'chief-of-staff',
  'cto',
  'cfo',
  'cpo',
  'cmo',
  'clo',
  'ops',
  'vp-research',
  'vp-sales',
  'vp-design',
  'vp-customer-success',
]);

const CODE_HINT = /\b(code|typescript|tsconfig|bug|fix|build|compile|refactor|component|frontend|backend|api|migration|test)\b/i;
const RESEARCH_HINT = /\b(research|competitor|market|industry|source|citation|news|web|monitor)\b/i;
const LEGAL_HINT = /\b(legal|contract|policy|compliance|regulation|gdpr|hipaa|terms)\b/i;
const FINANCE_HINT = /\b(finance|revenue|forecast|budget|mrr|ltv|churn|cash|burn)\b/i;
const VISUAL_HINT = /\b(design|ui|ux|screenshot|figma|visual|brand|layout)\b/i;
const CREATIVE_HINT = /\b(content|blog|copy|campaign|social|draft|creative)\b/i;
const EXTRACTION_HINT = /\b(extract|classify|summarize|summarise|table|list|status|report)\b/i;

export function inferCapabilities(context: RoutingContext): Capability[] {
  const capabilities = new Set<Capability>();
  const taskAndMessage = `${context.task}\n${context.message}`.trim();

  for (const toolName of context.toolNames) {
    for (const capability of TOOL_CAPABILITY_MAP[toolName] ?? []) {
      capabilities.add(capability);
    }
  }

  if (CODE_HINT.test(taskAndMessage)) {
    capabilities.add('code_generation');
    capabilities.add('needs_apply_patch');
  }
  if (RESEARCH_HINT.test(taskAndMessage)) {
    capabilities.add('web_research');
    capabilities.add('needs_citations');
    capabilities.add('needs_compaction');
  }
  if (LEGAL_HINT.test(taskAndMessage)) {
    capabilities.add('legal_reasoning');
    capabilities.add('needs_citations');
  }
  if (FINANCE_HINT.test(taskAndMessage)) {
    capabilities.add('financial_computation');
    capabilities.add('needs_code_execution');
  }
  if (VISUAL_HINT.test(taskAndMessage)) {
    capabilities.add('visual_analysis');
  }
  if (CREATIVE_HINT.test(taskAndMessage)) {
    capabilities.add('creative_writing');
  }
  if (EXTRACTION_HINT.test(taskAndMessage)) {
    capabilities.add('structured_extraction');
  }

  if (EXECUTIVE_ROLES.has(context.role) || /\b(assign|delegate|orchestr|brief|directive|review|evaluate)\b/i.test(taskAndMessage)) {
    capabilities.add('orchestration');
    capabilities.add('nuanced_evaluation');
  }

  if (context.toolNames.length >= 40) {
    capabilities.add('many_tools');
    capabilities.add('needs_tool_search');
  }

  const hasHighComplexitySignal =
    Array.from(capabilities).some(capability => HIGH_COMPLEXITY_CAPABILITIES.has(capability)) ||
    /\b(architecture|multi-step|complex|strategy|root cause|deep dive)\b/i.test(taskAndMessage);

  if (hasHighComplexitySignal) {
    capabilities.add('high_complexity');
  } else {
    capabilities.add('low_complexity');
  }

  if (
    capabilities.has('low_complexity') &&
    !capabilities.has('code_generation') &&
    !capabilities.has('legal_reasoning') &&
    !capabilities.has('financial_computation') &&
    !capabilities.has('web_research')
  ) {
    capabilities.add('deterministic_possible');
    capabilities.add('batch_eligible');
  }

  if ((context.trustScore ?? 0.5) < 0.45) {
    capabilities.add('high_complexity');
  }

  return Array.from(capabilities);
}
