import type { ModelRoutingMetadata } from '../providers/types.js';
import { inferCapabilities, type RoutingContext } from './inferCapabilities.js';
import { inferDomainRouting } from './domainRouter.js';
import {
  MODEL_CONFIG,
  getTierModel,
  resolveModel as canonicalizeModelSlug,
  tierDefaults,
  type ConfigModelTier,
} from '@glyphor/shared';
import { DEFAULT_AGENT_MODEL } from '@glyphor/shared/models';
import { systemQuery } from '@glyphor/shared/db';
import { getRemainingCredits, type CreditCloud } from '../credits/ledger.js';
import { isBedrockEnabled } from '../providers/bedrockClient.js';

const DEFAULT_MODEL = DEFAULT_AGENT_MODEL;
const ECONOMY_MODEL = getTierModel('fast');
const HIGH_MODEL = getTierModel('high');

const MIN_CLOUD_CREDIT_USD = 50;
const CREDIT_ROUTE_ORDER: CreditCloud[] = ['aws', 'azure', 'gcp'];

function inferConfigTierFromModel(model: string): ConfigModelTier | null {
  const tiers = MODEL_CONFIG.tiers as Record<ConfigModelTier, string>;
  for (const key of Object.keys(tiers) as ConfigModelTier[]) {
    if (tiers[key] === model) return key;
  }
  return null;
}

function inferRoutingFamily(model: string): string {
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('deepseek-')) return 'deepseek';
  if (model.startsWith('gemini-')) return 'gemini';
  if (model.startsWith('gpt-') || /^o[134](-|$)/.test(model) || model.startsWith('model-router')) return 'openai';
  return 'unknown';
}

const TIER_CREDIT_OPTIONS: Record<
  ConfigModelTier,
  Array<{ cloud: CreditCloud; model: string }>
> = {
  fast: [{ cloud: 'gcp', model: getTierModel('fast') }],
  default: [{ cloud: 'gcp', model: getTierModel('default') }],
  standard: [
    { cloud: 'azure', model: 'model-router' },
    { cloud: 'gcp', model: 'gemini-3.1-flash-lite-preview' },
  ],
  high: [
    { cloud: 'aws', model: 'claude-sonnet-4-6' },
    { cloud: 'azure', model: 'gpt-5.4-mini' },
    { cloud: 'gcp', model: 'gemini-3.1-flash-lite-preview' },
  ],
  max: [
    // Opus 4.7 access not granted on this Bedrock account — see models.config.ts.
    { cloud: 'aws', model: 'claude-sonnet-4-6' },
    { cloud: 'azure', model: 'gpt-5.4' },
    { cloud: 'gcp', model: 'gemini-3.1-pro-preview' },
  ],
  reasoning: [
    { cloud: 'aws', model: 'deepseek-r1' },
    { cloud: 'azure', model: 'o4-mini' },
    { cloud: 'gcp', model: 'gemini-3.1-pro-preview' },
  ],
  code: [
    { cloud: 'aws', model: 'deepseek-v3-2' },
    { cloud: 'azure', model: 'gpt-5.4-mini' },
    { cloud: 'gcp', model: 'gemini-3.1-flash-lite-preview' },
  ],
};

async function applyCreditAwareRouting<T extends ModelRoutingMetadata & { model: string }>(decision: T): Promise<T> {
  const tier = inferConfigTierFromModel(decision.model);
  if (!tier) return decision;

  const options = TIER_CREDIT_OPTIONS[tier];
  if (!options || options.length <= 1) return decision;

  // Filter out AWS/Bedrock options when Bedrock is not configured
  const bedrockAvailable = isBedrockEnabled();
  const eligibleOptions = bedrockAvailable
    ? options
    : options.filter((opt) => opt.cloud !== 'aws');
  if (eligibleOptions.length === 0) return decision;

  const credits = await Promise.all(CREDIT_ROUTE_ORDER.map((c) => getRemainingCredits(c)));
  const creditMap: Record<CreditCloud, number> = {
    aws: credits[0] ?? 0,
    azure: credits[1] ?? 0,
    gcp: credits[2] ?? 0,
  };

  const sorted = [...eligibleOptions].sort((a, b) => {
    const diff = creditMap[b.cloud] - creditMap[a.cloud];
    if (diff !== 0) return diff;
    return CREDIT_ROUTE_ORDER.indexOf(a.cloud) - CREDIT_ROUTE_ORDER.indexOf(b.cloud);
  });

  for (const opt of sorted) {
    if (creditMap[opt.cloud] >= MIN_CLOUD_CREDIT_USD) {
      console.log(
        JSON.stringify({
          tier,
          family: inferRoutingFamily(opt.model),
          chosen_cloud: opt.cloud,
          credits_remaining: creditMap,
        }),
      );
      return { ...decision, model: canonicalizeModelSlug(opt.model) } as T;
    }
  }

  const fallback = sorted[sorted.length - 1];
  console.log(
    JSON.stringify({
      tier,
      family: inferRoutingFamily(fallback.model),
      chosen_cloud: fallback.cloud,
      credits_remaining: creditMap,
      note: 'below_threshold_fallback',
    }),
  );
  return { ...decision, model: canonicalizeModelSlug(fallback.model) } as T;
}

const CODE_INTENSIVE_ROLES = new Set([
  'platform-engineer',
  'quality-engineer',
  'devops-engineer',
  'cto',
]);

const ORCHESTRATOR_ROLES = new Set([
  'chief-of-staff', 'cto', 'cpo', 'clo', 'ops', 'vp-research', 'cmo',
]);

const ORCHESTRATION_TASKS = new Set([
  'orchestrate', 'strategic_planning', 'weekly_review',
  'monthly_retrospective', 'decompose_research', 'qc_and_package_research',
]);

const EXECUTIVE_ROLES = new Set([
  'chief-of-staff', 'cto', 'cfo', 'cpo', 'cmo', 'vp-design', 'vp-research', 'clo',
]);

const NANO_ELIGIBLE_TASKS = new Set([
  'health_check', 'freshness_check', 'cost_check', 'daily_cost_check',
  'triage_queue', 'platform_health_check',
  'agent365_mail_triage', 'channel_audit', 'user_audit',
  'check_escalations', 'mention_scan', 'engagement_report',
  'ranking_report', 'metrics_report', 'event_response',
]);

function isCodeCentricContext(context: RoutingContext): boolean {
  const role = String(context.role ?? '').toLowerCase();
  if (CODE_INTENSIVE_ROLES.has(role)) return true;

  const taskAndMessage = `${context.task ?? ''} ${context.message ?? ''}`.toLowerCase();
  return /(code|coding|implement|implementation|bug|fix|patch|refactor|compile|build|test|tests|pull request|pr review|typescript|javascript|sql|migration)/.test(taskAndMessage);
}

// ── DB-backed route cache ────────────────────────────────────

interface RouteConfig {
  route_name: string;
  model_slug: string;
  priority: number;
}

// Hardcoded defaults used when DB is unavailable (cold start / test)
const STATIC_ROUTES: RouteConfig[] = [
  { route_name: 'economy',              model_slug: ECONOMY_MODEL,              priority: 100 },
  { route_name: 'workhorse',            model_slug: DEFAULT_MODEL,              priority: 50 },
  { route_name: 'orchestration',        model_slug: DEFAULT_MODEL,              priority: 90 },
  { route_name: 'executive_assignment', model_slug: DEFAULT_MODEL,              priority: 80 },
  { route_name: 'complex_research',     model_slug: HIGH_MODEL,                 priority: 85 },
  { route_name: 'financial_complex',    model_slug: HIGH_MODEL,                 priority: 85 },
  { route_name: 'visual_analysis',      model_slug: DEFAULT_MODEL,              priority: 85 },
  { route_name: 'code_gen',             model_slug: DEFAULT_MODEL,              priority: 70 },
  { route_name: 'founder_chat',         model_slug: DEFAULT_MODEL,              priority: 75 },
  { route_name: 'triangulation',        model_slug: HIGH_MODEL,                 priority: 95 },
  { route_name: 'deep_research',        model_slug: 'o3-deep-research',         priority: 95 },
  { route_name: 'legal_review',         model_slug: HIGH_MODEL,                 priority: 95 },
  { route_name: 'default',              model_slug: DEFAULT_MODEL,              priority: 0 },
];

let routeCache: RouteConfig[] | null = null;
let routeCacheTime = 0;
const ROUTE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function loadRoutes(): Promise<RouteConfig[]> {
  if (routeCache && Date.now() - routeCacheTime < ROUTE_CACHE_TTL) {
    return routeCache;
  }
  try {
    const rows = await systemQuery<RouteConfig>(
      `SELECT route_name, model_slug, priority
       FROM routing_config
       WHERE is_active = true
       ORDER BY priority DESC`,
    );
    if (rows.length > 0) {
      routeCache = rows;
      routeCacheTime = Date.now();
      return routeCache;
    }
  } catch {
    // DB unavailable — fall through to static defaults
  }
  routeCache = STATIC_ROUTES;
  routeCacheTime = Date.now();
  return routeCache;
}

function getRoute(routes: RouteConfig[], name: string): string {
  const route = routes.find(r => r.route_name === name);
  return route?.model_slug ?? routes.find(r => r.route_name === 'default')?.model_slug ?? DEFAULT_MODEL;
}

/** Force refresh — call after dashboard model swap. */
export function invalidateRouteCache(): void {
  routeCache = null;
}

// ── Main routing function ────────────────────────────────────

export interface RoutingDecision extends ModelRoutingMetadata {}

export async function resolveModelConfig(
  context: RoutingContext & { currentModel?: string; capabilities?: string[]; modelOverride?: string },
): Promise<RoutingDecision> {
  const routes = await loadRoutes();
  const capabilities = (context.capabilities as string[] | undefined) ?? inferCapabilities(context);
  const selected = new Set(capabilities);
  const domainRouting = inferDomainRouting({
    role: context.role,
    task: context.task,
    message: context.message,
    toolNames: context.toolNames,
    department: context.department,
  });
  const deterministicTask = new Set([
    'health_check', 'freshness_check', 'cost_check', 'daily_cost_check',
    'triage_queue', 'platform_health_check',
  ]).has(context.task);

  let decision: RoutingDecision = {
    model: context.currentModel ?? DEFAULT_MODEL,
    routingRule: 'respect_existing_model',
    capabilities,
  };

  const highComplexity = selected.has('high_complexity');

  // ── Priority 1: Deterministic skip ──
  if (deterministicTask && selected.has('deterministic_possible')) {
    decision = {
      model: '__deterministic__',
      routingRule: 'deterministic_skip',
      capabilities,
      reasoningEffort: 'minimal',
      verbosity: 'low',
    };
  }
  // ── Priority 2: Economy tier (nano-eligible tasks) ──
  else if (isNanoEligible(context.task, selected)) {
    decision = {
      model: getRoute(routes, 'economy'),
      routingRule: 'economy_tier',
      capabilities,
      reasoningEffort: 'minimal',
      verbosity: 'low',
    };
  }
  // ── Priority 3: Executive orchestration ──
  else if (ORCHESTRATOR_ROLES.has(context.role) && ORCHESTRATION_TASKS.has(context.task)) {
    decision = {
      model: getRoute(routes, 'orchestration'),
      routingRule: 'executive_orchestration',
      capabilities,
      reasoningEffort: 'high',
      enableCompaction: true,
    };
  }
  // ── Priority 4: Complex research (web_research + deep) ──
  else if (selected.has('web_research') && highComplexity) {
    decision = {
      model: getRoute(routes, 'complex_research'),
      routingRule: 'complex_research',
      capabilities,
      reasoningEffort: 'high',
      enableCitations: true,
      enableCompaction: true,
      enableGoogleSearch: true,
    };
  }
  // ── Priority 5: Complex financial computation ──
  else if (selected.has('financial_computation') && highComplexity) {
    decision = {
      model: getRoute(routes, 'financial_complex'),
      routingRule: 'financial_complex',
      capabilities,
      reasoningEffort: 'high',
      enableCodeExecution: true,
    };
  }
  // ── Priority 6: Visual analysis ──
  else if (selected.has('visual_analysis')) {
    decision = {
      model: getRoute(routes, 'visual_analysis'),
      routingRule: 'visual_analysis',
      capabilities,
      reasoningEffort: highComplexity ? 'medium' : 'low',
    };
  }
  // ── Priority 7: Executive assignment (non-orchestration) ──
  else if (EXECUTIVE_ROLES.has(context.role) && context.task === 'work_loop' && highComplexity) {
    decision = {
      model: getRoute(routes, 'executive_assignment'),
      routingRule: 'executive_assignment',
      capabilities,
      reasoningEffort: 'high',
      enableCompaction: true,
    };
  }
  // ── Priority 8: Code generation ──
  else if (selected.has('code_generation') && isCodeCentricContext(context)) {
    decision = {
      model: getRoute(routes, 'code_gen'),
      routingRule: selected.has('needs_apply_patch') ? 'standard_code_gen' : 'code_generation',
      capabilities,
      reasoningEffort: highComplexity ? 'high' : 'medium',
      verbosity: 'medium',
      enableApplyPatch: selected.has('needs_apply_patch'),
      enableToolSearch: selected.has('many_tools'),
    };
  }
  // ── Priority 8b: Code read-only (no tools, review/analysis) ──
  else if (selected.has('code_generation')) {
    decision = {
      model: getRoute(routes, 'code_gen'),
      routingRule: 'code_read_only',
      capabilities,
      reasoningEffort: highComplexity ? 'medium' : 'low',
      verbosity: 'medium',
      enableToolSearch: selected.has('many_tools'),
    };
  }
  // ── Priority 9: Non-complex financial computation ──
  else if (selected.has('financial_computation')) {
    decision = {
      model: getRoute(routes, 'workhorse'),
      routingRule: 'financial_compute',
      capabilities,
      reasoningEffort: 'medium',
      enableCodeExecution: true,
    };
  }
  // ── Priority 10: Legal reasoning ──
  else if (selected.has('legal_reasoning')) {
    decision = {
      model: getRoute(routes, 'workhorse'),
      routingRule: 'grounded_legal_research',
      capabilities,
      reasoningEffort: highComplexity ? 'high' : 'medium',
      enableCitations: true,
      enableCompaction: true,
    };
  }
  // ── Priority 11: Creative writing / nuanced evaluation ──
  else if (selected.has('creative_writing') || selected.has('nuanced_evaluation')) {
    decision = {
      model: getRoute(routes, 'workhorse'),
      routingRule: selected.has('creative_writing') ? 'creative_writing' : 'nuanced_evaluation',
      capabilities,
      reasoningEffort: highComplexity ? 'high' : 'medium',
      enableCompaction: true,
    };
  }
  // ── Priority 12: Non-complex web research ──
  else if (selected.has('web_research')) {
    decision = {
      model: getRoute(routes, 'workhorse'),
      routingRule: 'grounded_research',
      capabilities,
      reasoningEffort: 'medium',
      enableCitations: true,
      enableCompaction: true,
      enableGoogleSearch: true,
    };
  }
  // ── Priority 13: Founder chat ──
  else if (context.task === 'on_demand' && EXECUTIVE_ROLES.has(context.role)) {
    decision = {
      model: getRoute(routes, 'founder_chat'),
      routingRule: 'founder_chat',
      capabilities,
      reasoningEffort: 'medium',
    };
  }
  // ── Priority 14: Dashboard model override ──
  else if (context.modelOverride) {
    decision = {
      model: context.modelOverride,
      routingRule: 'dashboard_select',
      capabilities,
    };
  }
  // ── Priority 15: Late deterministic catch-all ──
  else if (selected.has('deterministic_possible')) {
    decision = {
      model: '__deterministic__',
      routingRule: 'deterministic_skip',
      capabilities,
      reasoningEffort: 'minimal',
      verbosity: 'low',
    };
  }
  // ── Priority 16: Low complexity ──
  else if (selected.has('low_complexity')) {
    decision = {
      model: getRoute(routes, 'economy'),
      routingRule: 'low_complexity_default',
      capabilities,
      reasoningEffort: 'minimal',
      verbosity: 'low',
    };
  }
  // ── Priority 17: Default workhorse ──
  else {
    decision = {
      model: getRoute(routes, 'workhorse'),
      routingRule: 'default_generalist',
      capabilities,
      reasoningEffort: 'low',
      verbosity: 'medium',
    };
  }

  // ── Post-routing adjustments ──

  const economyModel = getRoute(routes, 'economy');
  const workhorse = getRoute(routes, 'workhorse');

  if ((context.trustScore ?? 0.5) < 0.45) {
    if (decision.model === economyModel) {
      decision.model = workhorse;
      decision.routingRule = 'low_trust_escalation';
    }
    decision.reasoningEffort = 'high';
  }

  if (!deterministicTask && domainRouting.crossDomain) {
    if (decision.model === economyModel) {
      decision.model = workhorse;
      decision.routingRule = 'cross_domain_escalation';
    }
    decision.reasoningEffort = decision.reasoningEffort === 'minimal' ? 'medium' : 'high';
    decision.enableCompaction = true;
  }

  if (!deterministicTask && decision.model === economyModel && domainRouting.primaryDomain === 'legal') {
    decision.model = workhorse;
    decision.routingRule = 'legal_domain_escalation';
    decision.reasoningEffort = 'medium';
    decision.enableCitations = true;
    decision.enableCompaction = true;
  }

  if (!deterministicTask && decision.model === economyModel && domainRouting.primaryDomain === 'finance') {
    decision.model = workhorse;
    decision.routingRule = 'financial_domain_escalation';
    decision.reasoningEffort = 'medium';
    decision.enableCodeExecution = true;
  }

  // Map deprecated / removed registry slugs (e.g. stale routing_config rows) before any LLM call.
  if (decision.model !== '__deterministic__') {
    const normalized = canonicalizeModelSlug(decision.model);
    if (normalized !== decision.model) {
      decision = { ...decision, model: normalized };
    }
  }

  if (decision.model !== '__deterministic__') {
    decision = await applyCreditAwareRouting(decision);
  }

  // ── Tier defaults (base layer — agent/per-call overrides win) ──
  if (decision.model !== '__deterministic__') {
    const tier = inferConfigTierFromModel(decision.model);
    if (tier) {
      const defaults = tierDefaults[tier as keyof typeof tierDefaults];
      if (defaults) {
        if (defaults.claudeEffort && !decision.claudeEffort) {
          decision = { ...decision, claudeEffort: defaults.claudeEffort as ModelRoutingMetadata['claudeEffort'] };
        }
        if (defaults.taskBudget && !decision.taskBudget) {
          decision = { ...decision, taskBudget: defaults.taskBudget };
        }
      }
    }
  }

  return decision;
}

// ── Classification helpers ──

function isNanoEligible(task: string, selected: Set<string>): boolean {
  if (NANO_ELIGIBLE_TASKS.has(task)) return true;
  if (selected.has('low_complexity') && !selected.has('code_generation') && !selected.has('web_research')) return true;
  return false;
}
