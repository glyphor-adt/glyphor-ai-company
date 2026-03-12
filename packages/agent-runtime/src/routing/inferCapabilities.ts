import type { CompanyAgentRole } from '../types.js';
import type { Capability } from './capabilities.js';
import { HIGH_COMPLEXITY_CAPABILITIES } from './capabilities.js';
import { TOOL_CAPABILITY_MAP } from './toolCapabilityMap.js';

export interface RoutingContext {
  role: CompanyAgentRole | string;
  task: string;
  message: string;
  toolNames: string[];
  department?: string | null;
  trustScore?: number | null;
}

const DETERMINISTIC_TASKS = new Set<string>([
  'health_check',
  'freshness_check',
  'cost_check',
  'daily_cost_check',
  'triage_queue',
  'platform_health_check',
]);

function normalizeToolName(rawToolName: string): string {
  if (!rawToolName.includes(':')) return rawToolName;
  const parts = rawToolName.split(':').filter(Boolean);
  return parts[parts.length - 1] ?? rawToolName;
}

function inferCapabilitiesFromToolName(toolName: string): Capability[] {
  const normalized = toolName.toLowerCase();
  const inferred = new Set<Capability>();

  if (/\b(legal|contract|compliance|regulation|policy)\b/.test(normalized)) {
    inferred.add('legal_reasoning');
    inferred.add('needs_citations');
  }
  if (/\b(financial|finance|revenue|budget|forecast|cost|margin|ltv|churn)\b/.test(normalized)) {
    inferred.add('financial_computation');
    inferred.add('needs_code_execution');
  }
  if (/\b(research|search|monitor|intel|analysis)\b/.test(normalized)) {
    inferred.add('web_research');
    inferred.add('needs_citations');
  }
  if (/\b(content|copy|campaign|social|draft|blog|seo)\b/.test(normalized)) {
    inferred.add('creative_writing');
  }
  if (/\b(screenshot|visual|figma|audit|design)\b/.test(normalized)) {
    inferred.add('visual_analysis');
  }
  if (/\b(assign|dispatch|delegate|orchestr|handoff|brief|review|evaluate)\b/.test(normalized)) {
    inferred.add('orchestration');
    inferred.add('nuanced_evaluation');
  }

  const writeLike = /\b(create|update|write|deploy|patch|merge|commit|publish)\b/.test(normalized);
  const readLike = /\b(get|list|read|fetch|query|check|inspect|describe|status|health)\b/.test(normalized);

  if (writeLike) {
    if (inferred.has('creative_writing') || /\b(content|copy|campaign|social|blog|seo)\b/.test(normalized)) {
      inferred.add('creative_writing');
    } else {
      inferred.add('code_generation');
      inferred.add('needs_apply_patch');
    }
  }

  if (readLike && !writeLike) {
    inferred.add('structured_extraction');
    inferred.add('simple_tool_calling');
  }

  return Array.from(inferred);
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
  const departmentSignal = (context.department ?? '').toLowerCase();

  for (const rawToolName of context.toolNames) {
    const toolName = normalizeToolName(rawToolName);
    const mappedCapabilities = TOOL_CAPABILITY_MAP[toolName] ?? inferCapabilitiesFromToolName(toolName);
    for (const capability of mappedCapabilities) {
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

  if (/\b(engineering|design|frontend|platform)\b/.test(departmentSignal)) {
    capabilities.add('code_generation');
    capabilities.add('needs_apply_patch');
  }
  if (/\b(design)\b/.test(departmentSignal)) {
    capabilities.add('visual_analysis');
  }
  if (/\b(legal)\b/.test(departmentSignal)) {
    capabilities.add('legal_reasoning');
    capabilities.add('needs_citations');
  }
  if (/\b(finance)\b/.test(departmentSignal)) {
    capabilities.add('financial_computation');
    capabilities.add('needs_code_execution');
  }
  if (/\b(marketing)\b/.test(departmentSignal)) {
    capabilities.add('creative_writing');
  }
  if (/\b(research|intelligence|product)\b/.test(departmentSignal)) {
    capabilities.add('web_research');
    capabilities.add('needs_citations');
  }
  if (/\b(sales|customer success)\b/.test(departmentSignal)) {
    capabilities.add('structured_extraction');
    capabilities.add('nuanced_evaluation');
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

  if (DETERMINISTIC_TASKS.has(context.task)) {
    capabilities.add('deterministic_possible');
    capabilities.add('batch_eligible');
  }

  return Array.from(capabilities);
}
