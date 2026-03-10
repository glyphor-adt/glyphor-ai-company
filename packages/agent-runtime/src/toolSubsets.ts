import type { CompanyAgentRole, GeminiToolDeclaration } from './types.js';

type ToolSubsetMap = Partial<Record<CompanyAgentRole, Record<string, string[] | null>>>;

const WORK_COMPLETION_TOOLS = [
  'save_memory',
  'recall_memories',
  'read_my_assignments',
  'submit_assignment_output',
  'flag_assignment_blocker',
  'send_agent_message',
  'check_messages',
  'request_tool_access',
];

function withWorkTools(...tools: string[]): string[] {
  return Array.from(new Set([...WORK_COMPLETION_TOOLS, ...tools]));
}

export const TOOL_SUBSETS: ToolSubsetMap = {
  cmo: {
    weekly_content_planning: withWorkTools(
      'web_search',
      'web_fetch',
      'mcp:marketing:schedule_social_post',
      'mcp:marketing:get_analytics',
    ),
    generate_content: withWorkTools(
      'web_search',
      'web_fetch',
      'mcp:marketing:schedule_social_post',
      'mcp:marketing:get_analytics',
      'mcp:marketing:get_search_console_data',
    ),
    proactive: null,
  },
  cpo: {
    weekly_usage_analysis: withWorkTools(
      'get_company_pulse',
      'get_org_knowledge',
      'query_knowledge_graph',
      'web_search',
      'web_fetch',
    ),
    proactive: null,
  },
  cfo: {
    daily_cost_check: withWorkTools(
      'get_financials',
      'calculate_unit_economics',
      'query_stripe_mrr',
      'query_stripe_subscriptions',
      'write_financial_report',
    ),
    proactive: null,
  },
  cto: {
    platform_health_check: withWorkTools(
      'get_platform_health',
      'get_cloud_run_metrics',
      'get_infrastructure_costs',
      'get_ci_health',
      'get_repo_stats',
      'query_vercel_health',
      'write_health_report',
    ),
    proactive: null,
  },
  ops: {
    health_check: withWorkTools(
      'get_platform_health',
      'get_cloud_run_metrics',
      'get_infrastructure_costs',
      'query_vercel_health',
      'write_health_report',
    ),
    freshness_check: withWorkTools(
      'get_recent_activity',
      'get_org_knowledge',
      'read_company_memory',
    ),
    cost_check: withWorkTools(
      'get_infrastructure_costs',
      'get_financials',
      'write_health_report',
    ),
    proactive: null,
  },
  'vp-customer-success': {
    daily_health_scoring: withWorkTools(
      'get_company_pulse',
      'get_org_knowledge',
      'query_knowledge_graph',
    ),
    proactive: null,
  },
  'vp-sales': {
    pipeline_review: withWorkTools(
      'get_company_pulse',
      'get_org_knowledge',
      'web_search',
      'web_fetch',
    ),
    proactive: null,
  },
  'chief-of-staff': {
    orchestrate: withWorkTools(
      'read_founder_directives',
      'create_work_assignments',
      'dispatch_assignment',
      'check_assignment_status',
      'update_directive_progress',
      'read_company_doctrine',
      'get_company_pulse',
    ),
    morning_briefing: withWorkTools(
      'get_company_pulse',
      'get_recent_activity',
      'get_pending_decisions',
      'get_financials',
      'read_company_memory',
      'send_briefing',
    ),
    eod_summary: withWorkTools(
      'get_recent_activity',
      'get_pending_decisions',
      'get_financials',
      'read_company_memory',
      'send_briefing',
    ),
    proactive: null,
  },
};

export function getToolSubset(role: CompanyAgentRole, task: string): Set<string> | null {
  const roleMap = TOOL_SUBSETS[role];
  if (!roleMap) return null;
  const subset = roleMap[task];
  if (subset == null) return subset ?? null;
  return new Set(subset);
}

export function filterToolDeclarations(
  declarations: GeminiToolDeclaration[],
  allowedNames: Set<string> | null,
): GeminiToolDeclaration[] {
  if (allowedNames == null) return declarations;
  return declarations.filter((declaration) => allowedNames.has(declaration.name));
}
