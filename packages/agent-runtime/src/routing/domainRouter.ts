import type { CompanyAgentRole } from '../types.js';

export type RoutingDomain =
  | 'engineering'
  | 'marketing'
  | 'finance'
  | 'product'
  | 'sales'
  | 'design'
  | 'research'
  | 'legal'
  | 'operations';

export interface DomainRoutingContext {
  role: CompanyAgentRole | string;
  task: string;
  message: string;
  toolNames: string[];
  department?: string | null;
}

export interface DomainSignal {
  domain: RoutingDomain;
  score: number;
  share: number;
}

export interface DomainRoutingResult {
  primaryDomain: RoutingDomain | null;
  crossDomain: boolean;
  domains: DomainSignal[];
  totalSignals: number;
}

const PRIMARY_DOMAIN_THRESHOLD = 0.45;
const CROSS_DOMAIN_THRESHOLD = 0.22;
const CROSS_DOMAIN_MIN_SCORE = 2;

const ROLE_DOMAIN: Record<string, RoutingDomain> = {
  'chief-of-staff': 'operations',
  'ops': 'operations',
  'adi-rose': 'operations',
  'cto': 'engineering',
  'platform-engineer': 'engineering',
  'quality-engineer': 'engineering',
  'devops-engineer': 'engineering',
  'm365-admin': 'engineering',
  'cfo': 'finance',
  'cmo': 'marketing',
  'content-creator': 'marketing',
  'seo-analyst': 'marketing',
  'social-media-manager': 'marketing',
  'marketing-intelligence-analyst': 'marketing',
  'cpo': 'product',
  'user-researcher': 'product',
  'competitive-intel': 'product',
  'vp-sales': 'sales',
  'vp-design': 'design',
  'ui-ux-designer': 'design',
  'frontend-engineer': 'design',
  'design-critic': 'design',
  'template-architect': 'design',
  'vp-research': 'research',
  'competitive-research-analyst': 'research',
  'market-research-analyst': 'research',
  'clo': 'legal',
  'bob-the-tax-pro': 'legal',
};

const DEPARTMENT_DOMAIN: Record<string, RoutingDomain> = {
  engineering: 'engineering',
  platform: 'engineering',
  devops: 'engineering',
  technology: 'engineering',
  marketing: 'marketing',
  product: 'product',
  sales: 'sales',
  design: 'design',
  research: 'research',
  intelligence: 'research',
  legal: 'legal',
  finance: 'finance',
  operations: 'operations',
};

const DOMAIN_KEYWORDS: Record<RoutingDomain, string[]> = {
  engineering: [
    'code', 'typescript', 'javascript', 'bug', 'fix', 'patch', 'refactor', 'deploy', 'build',
    'compile', 'test', 'ci', 'pipeline', 'migration', 'database', 'api', 'backend', 'frontend',
    'infrastructure', 'release',
  ],
  marketing: [
    'campaign', 'content', 'social', 'seo', 'brand', 'copy', 'newsletter', 'email', 'launch',
    'promotion', 'audience', 'engagement',
  ],
  finance: [
    'budget', 'revenue', 'margin', 'forecast', 'pricing', 'cost', 'mrr', 'ltv', 'churn',
    'cash flow', 'burn', 'expense',
  ],
  product: [
    'roadmap', 'feature', 'backlog', 'requirements', 'spec', 'ux research', 'prioritization',
    'adoption', 'product strategy',
  ],
  sales: [
    'pipeline', 'lead', 'prospect', 'deal', 'crm', 'quota', 'outbound', 'inbound', 'account',
    'sales enablement',
  ],
  design: [
    'design', 'ui', 'ux', 'wireframe', 'mockup', 'layout', 'figma', 'visual', 'component', 'template',
  ],
  research: [
    'research', 'analysis', 'benchmark', 'market', 'competitive', 'trend', 'citation', 'source',
    'intelligence', 'study',
  ],
  legal: [
    'legal', 'contract', 'compliance', 'regulation', 'policy', 'privacy', 'gdpr', 'terms',
    'governance', 'liability', 'tax',
  ],
  operations: [
    'orchestrate', 'assignment', 'dispatch', 'workflow', 'coordination', 'escalation', 'triage',
    'incident', 'runbook', 'heartbeat',
  ],
};

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s:-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function countKeywordMatches(text: string, keywords: string[]): number {
  let score = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      score += 1;
    }
  }
  return score;
}

function toDepartmentDomain(rawDepartment?: string | null): RoutingDomain | null {
  if (!rawDepartment) return null;
  const key = normalizeText(rawDepartment).replace(/\s+/g, '');
  return DEPARTMENT_DOMAIN[key] ?? DEPARTMENT_DOMAIN[normalizeText(rawDepartment)] ?? null;
}

export function inferDomainRouting(context: DomainRoutingContext): DomainRoutingResult {
  const role = String(context.role ?? '').toLowerCase();
  const roleDomain = ROLE_DOMAIN[role] ?? null;
  const departmentDomain = toDepartmentDomain(context.department);

  const normalizedTask = normalizeText(context.task ?? '');
  const normalizedMessage = normalizeText(context.message ?? '');
  const normalizedTools = normalizeText((context.toolNames ?? []).join(' '));
  const combined = `${normalizedTask} ${normalizedMessage} ${normalizedTools}`.trim();

  const scores = new Map<RoutingDomain, number>();
  for (const domain of Object.keys(DOMAIN_KEYWORDS) as RoutingDomain[]) {
    let score = countKeywordMatches(combined, DOMAIN_KEYWORDS[domain]);
    if (roleDomain === domain) score += 3;
    if (departmentDomain === domain) score += 4;
    if (score > 0) scores.set(domain, score);
  }

  const totalSignals = Array.from(scores.values()).reduce((sum, value) => sum + value, 0);
  if (totalSignals === 0) {
    return {
      primaryDomain: roleDomain ?? departmentDomain,
      crossDomain: false,
      domains: roleDomain || departmentDomain
        ? [{ domain: (roleDomain ?? departmentDomain) as RoutingDomain, score: 1, share: 1 }]
        : [],
      totalSignals: roleDomain || departmentDomain ? 1 : 0,
    };
  }

  const domains = Array.from(scores.entries())
    .map(([domain, score]) => ({
      domain,
      score,
      share: score / totalSignals,
    }))
    .sort((left, right) => right.share - left.share);

  const primary = domains[0]?.share >= PRIMARY_DOMAIN_THRESHOLD
    ? domains[0].domain
    : domains[0]?.domain ?? null;
  const crossDomain = domains.length >= 2
    && domains[1].share >= CROSS_DOMAIN_THRESHOLD
    && domains[1].score >= CROSS_DOMAIN_MIN_SCORE;

  return {
    primaryDomain: primary,
    crossDomain,
    domains,
    totalSignals,
  };
}
