/**
 * Domain Router — Deterministic Directive Classification & Routing
 *
 * PURELY DETERMINISTIC. Zero LLM calls.
 * Classifies directives by keyword matching and routes them to the
 * appropriate executive based on orchestration configs.
 */

import type { CompanyAgentRole } from '@glyphor/agent-runtime';

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface RoutingDecision {
  strategy: 'self_orchestrate' | 'delegate_single' | 'delegate_multi';
  primary_delegate?: {
    executive_role: string;
    delegation_type: 'full' | 'decompose_only';
    context: string;
  };
  sub_directives?: Array<{
    executive_role: string;
    delegation_type: 'full' | 'decompose_only';
    scope: string;
    context: string;
    dependencies?: string[];
  }>;
  reasoning: string;
}

export interface ExecutiveOrchestrationConfig {
  executive_role: string;
  can_decompose: boolean;
  can_evaluate: boolean;
  can_create_sub_directives: boolean;
  allowed_assignees: string[];
  max_assignments_per_directive: number;
  requires_plan_verification: boolean;
  is_canary: boolean;
  canary_directive_count: number;
}

export interface DirectiveInput {
  id: string;
  title: string;
  description: string;
  priority: string;
  target_agents?: string[];
}

// ═══════════════════════════════════════════════════════════════════
// Department Definitions
// ═══════════════════════════════════════════════════════════════════

interface DepartmentDef {
  executive: CompanyAgentRole;
  team: CompanyAgentRole[];
  keywords: string[];
}

const DEPARTMENTS: Record<string, DepartmentDef> = {
  engineering: {
    executive: 'cto',
    team: ['platform-engineer', 'quality-engineer', 'devops-engineer', 'm365-admin'],
    keywords: ['deploy', 'build', 'code', 'github', 'ci/cd', 'infrastructure', 'migration', 'bug', 'test', 'api', 'backend', 'server', 'database', 'devops', 'pipeline', 'release', 'engineering'],
  },
  marketing: {
    executive: 'cmo',
    team: ['content-creator', 'social-media-manager', 'seo-analyst', 'marketing-intelligence-analyst'],
    keywords: ['content', 'social', 'seo', 'campaign', 'brand', 'launch', 'marketing', 'email marketing', 'newsletter', 'advertising', 'promotion'],
  },
  finance: {
    executive: 'cfo',
    team: [],
    keywords: ['cost', 'revenue', 'budget', 'billing', 'pricing', 'margin', 'financial', 'expense', 'forecast', 'profit', 'finance', 'cash flow'],
  },
  product: {
    executive: 'cpo',
    team: ['user-researcher', 'competitive-intel'],
    keywords: ['roadmap', 'feature', 'usage', 'competitive', 'user research', 'product', 'prioritization', 'backlog', 'requirements', 'specification'],
  },
  sales: {
    executive: 'vp-sales',
    team: [],
    keywords: ['pipeline', 'lead', 'enterprise', 'proposal', 'account', 'sales', 'prospect', 'deal', 'quota', 'crm', 'outbound'],
  },
  design: {
    executive: 'vp-design',
    team: ['ui-ux-designer', 'frontend-engineer', 'design-critic', 'template-architect'],
    keywords: ['design', 'ui', 'ux', 'frontend', 'component', 'template', 'wireframe', 'mockup', 'figma', 'layout', 'visual'],
  },
  research: {
    executive: 'vp-research',
    team: ['competitive-research-analyst', 'market-research-analyst'],
    keywords: ['research', 'analysis', 'market', 'competitive landscape', 'industry', 'trend', 'benchmark', 'study', 'intelligence'],
  },
  legal: {
    executive: 'clo',
    team: ['bob-the-tax-pro'],
    keywords: ['compliance', 'contract', 'ip', 'tax', 'regulation', 'legal', 'policy', 'audit', 'governance', 'liability', 'privacy', 'gdpr'],
  },
};

const MAX_ACTIVE_DELEGATIONS = 5;
const CANARY_MAX_DIRECTIVES = 20;
const SINGLE_DOMAIN_THRESHOLD = 0.6;
const MULTI_DOMAIN_THRESHOLD = 0.25;

// ═══════════════════════════════════════════════════════════════════
// Signal Scoring
// ═══════════════════════════════════════════════════════════════════

interface DepartmentSignals {
  [department: string]: number;
}

function countDepartmentSignals(directive: DirectiveInput): DepartmentSignals {
  const text = `${directive.title} ${directive.description}`.toLowerCase();
  const signals: DepartmentSignals = {};

  for (const [dept, def] of Object.entries(DEPARTMENTS)) {
    let score = 0;

    // Keyword matching
    for (const keyword of def.keywords) {
      if (text.includes(keyword.toLowerCase())) {
        score++;
      }
    }

    // Boost from target_agents if any match this department's team or executive
    if (directive.target_agents) {
      for (const agent of directive.target_agents) {
        if (agent === def.executive || def.team.includes(agent as CompanyAgentRole)) {
          score += 3; // Strong signal — explicit agent targeting
        }
      }
    }

    if (score > 0) {
      signals[dept] = score;
    }
  }

  return signals;
}

function classifyDomain(signals: DepartmentSignals): {
  type: 'single' | 'multi' | 'ambiguous';
  departments: Array<{ name: string; share: number }>;
} {
  const totalSignals = Object.values(signals).reduce((a, b) => a + b, 0);

  if (totalSignals === 0) {
    return { type: 'ambiguous', departments: [] };
  }

  const ranked = Object.entries(signals)
    .map(([name, count]) => ({ name, share: count / totalSignals }))
    .sort((a, b) => b.share - a.share);

  if (ranked[0].share >= SINGLE_DOMAIN_THRESHOLD) {
    return { type: 'single', departments: [ranked[0]] };
  }

  const multiDepts = ranked.filter(d => d.share >= MULTI_DOMAIN_THRESHOLD);
  if (multiDepts.length >= 2) {
    return { type: 'multi', departments: multiDepts };
  }

  return { type: 'ambiguous', departments: ranked };
}

// ═══════════════════════════════════════════════════════════════════
// Executive Availability Checks
// ═══════════════════════════════════════════════════════════════════

function findConfig(
  role: string,
  configs: ExecutiveOrchestrationConfig[],
): ExecutiveOrchestrationConfig | undefined {
  return configs.find(c => c.executive_role === role);
}

function isExecutiveAvailable(
  role: string,
  configs: ExecutiveOrchestrationConfig[],
  activeDelegationCounts: Map<string, number>,
): { available: boolean; reason?: string } {
  const config = findConfig(role, configs);

  if (!config) {
    return { available: false, reason: `${role} has no orchestration config` };
  }

  if (!config.can_decompose) {
    return { available: false, reason: `${role} cannot decompose directives` };
  }

  const activeCount = activeDelegationCounts.get(role) ?? 0;
  if (activeCount >= MAX_ACTIVE_DELEGATIONS) {
    return { available: false, reason: `${role} overloaded (${activeCount}/${MAX_ACTIVE_DELEGATIONS} active delegations)` };
  }

  if (config.is_canary && config.canary_directive_count >= CANARY_MAX_DIRECTIVES) {
    return { available: false, reason: `${role} canary limit reached (${config.canary_directive_count}/${CANARY_MAX_DIRECTIVES})` };
  }

  return { available: true };
}

// ═══════════════════════════════════════════════════════════════════
// Delegation Type
// ═══════════════════════════════════════════════════════════════════

function determineDelegationType(
  priority: string,
  config: ExecutiveOrchestrationConfig,
): 'full' | 'decompose_only' {
  if (priority === 'critical' || !config.can_evaluate) {
    return 'decompose_only';
  }
  return 'full';
}

// ═══════════════════════════════════════════════════════════════════
// Main Router
// ═══════════════════════════════════════════════════════════════════

export async function routeDirective(
  directive: DirectiveInput,
  orchestrationConfigs: ExecutiveOrchestrationConfig[],
  activeDelegationCounts: Map<string, number> = new Map(),
): Promise<RoutingDecision> {
  // Phase 1: Deterministic classification
  const signals = countDepartmentSignals(directive);
  const classification = classifyDomain(signals);

  // No signals at all → self-orchestrate
  if (classification.type === 'ambiguous') {
    return {
      strategy: 'self_orchestrate',
      reasoning: 'No clear department signals detected — Chief of Staff will orchestrate directly.',
    };
  }

  // Phase 2 & 3: Check availability and determine delegation
  if (classification.type === 'single') {
    const dept = classification.departments[0];
    const deptDef = DEPARTMENTS[dept.name];
    const availability = isExecutiveAvailable(deptDef.executive, orchestrationConfigs, activeDelegationCounts);

    if (!availability.available) {
      return {
        strategy: 'self_orchestrate',
        reasoning: `Single domain (${dept.name}, ${Math.round(dept.share * 100)}%) but executive unavailable: ${availability.reason}`,
      };
    }

    const config = findConfig(deptDef.executive, orchestrationConfigs)!;
    const delegationType = determineDelegationType(directive.priority, config);

    return {
      strategy: 'delegate_single',
      primary_delegate: {
        executive_role: deptDef.executive,
        delegation_type: delegationType,
        context: `Directive classified as ${dept.name} domain (${Math.round(dept.share * 100)}% signal strength). Keywords matched from title/description.`,
      },
      reasoning: `Clear single-domain match: ${dept.name} (${Math.round(dept.share * 100)}%). Delegating to ${deptDef.executive} with ${delegationType} authority.`,
    };
  }

  // Multi-domain: check all relevant executives
  if (classification.type === 'multi') {
    const availableDepts: Array<{
      name: string;
      share: number;
      executive: string;
      config: ExecutiveOrchestrationConfig;
    }> = [];
    const unavailableReasons: string[] = [];

    for (const dept of classification.departments) {
      const deptDef = DEPARTMENTS[dept.name];
      const availability = isExecutiveAvailable(deptDef.executive, orchestrationConfigs, activeDelegationCounts);

      if (availability.available) {
        const config = findConfig(deptDef.executive, orchestrationConfigs)!;
        availableDepts.push({ name: dept.name, share: dept.share, executive: deptDef.executive, config });
      } else {
        unavailableReasons.push(`${deptDef.executive}: ${availability.reason}`);
      }
    }

    // No executives available → self-orchestrate
    if (availableDepts.length === 0) {
      return {
        strategy: 'self_orchestrate',
        reasoning: `Cross-domain directive (${classification.departments.map(d => d.name).join(', ')}) but no executives available: ${unavailableReasons.join('; ')}`,
      };
    }

    // Only one available → delegate_single to that one, self-orchestrate the rest
    if (availableDepts.length === 1) {
      const dept = availableDepts[0];
      const delegationType = determineDelegationType(directive.priority, dept.config);

      return {
        strategy: 'delegate_single',
        primary_delegate: {
          executive_role: dept.executive,
          delegation_type: delegationType,
          context: `Cross-domain directive but only ${dept.executive} available. Other executives unavailable: ${unavailableReasons.join('; ')}`,
        },
        reasoning: `Cross-domain (${classification.departments.map(d => d.name).join(', ')}) but only ${dept.executive} available. Delegating ${dept.name} portion; CoS handles remainder.`,
      };
    }

    // Multiple available → delegate_multi
    const subDirectives = availableDepts.map((dept, idx) => {
      const delegationType = determineDelegationType(directive.priority, dept.config);
      return {
        executive_role: dept.executive,
        delegation_type: delegationType,
        scope: dept.name,
        context: `${dept.name} portion of cross-domain directive (${Math.round(dept.share * 100)}% signal share).`,
        dependencies: idx > 0 ? undefined : undefined, // No implicit dependencies between parallel sub-directives
      };
    });

    return {
      strategy: 'delegate_multi',
      sub_directives: subDirectives,
      reasoning: `Cross-domain directive spanning ${availableDepts.map(d => d.name).join(', ')}. Delegating sub-directives to ${availableDepts.map(d => d.executive).join(', ')}.`,
    };
  }

  // Fallback (should not reach here)
  return {
    strategy: 'self_orchestrate',
    reasoning: 'Unhandled classification state — defaulting to self-orchestration.',
  };
}

// ═══════════════════════════════════════════════════════════════════
// Exports for testing
// ═══════════════════════════════════════════════════════════════════

export { DEPARTMENTS, countDepartmentSignals, classifyDomain, isExecutiveAvailable, determineDelegationType };
