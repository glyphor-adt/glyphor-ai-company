import type { CompanyAgentRole, ToolDeclaration } from './types.js';

type ToolSubsetMap = Partial<Record<CompanyAgentRole, Record<string, string[] | null>>>;

/** Hard limit — OpenAI enforces 128 max, and large tool lists waste tokens. */
const MAX_TOOLS = 128;

const WORK_COMPLETION_TOOLS = [
  'save_memory',
  'recall_memories',
  'read_my_assignments',
  'submit_assignment_output',
  'flag_assignment_blocker',
  'send_agent_message',
  'check_messages',
  'request_tool_access',
  'check_tool_access',
  'list_my_tools',
  'tool_search',
];

/**
 * Keep these tools in the declaration set when capping to provider limits.
 * Includes core completion + common mail triage actions.
 */
const PINNED_CAP_TOOLS = new Set<string>([
  ...WORK_COMPLETION_TOOLS,
  'read_inbox',
  'send_email',
  'reply_to_email',
  'forward_email',
  'mark_email_as_read',
  'move_email',
  'get_email_by_id',
  'get_message',
  'list_emails',
  'list_messages',
  'list_inbox',
  'list_mail_folders',
]);

function isAgent365Declaration(decl: ToolDeclaration): boolean {
  const description = typeof decl.description === 'string' ? decl.description : '';
  return description.startsWith('[Agent365 mcp_') || description.startsWith('[Agent 365 mcp_');
}

function withWorkTools(...tools: string[]): string[] {
  return Array.from(new Set([...WORK_COMPLETION_TOOLS, ...tools]));
}

export const TOOL_SUBSETS: ToolSubsetMap = {
  cmo: {
    weekly_content_planning: withWorkTools(
      'web_search',
      'web_fetch',
    ),
    generate_content: withWorkTools(
      'web_search',
      'web_fetch',
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
      'write_health_report',
    ),
    proactive: null,
  },
  ops: {
    health_check: withWorkTools(
      'get_platform_health',
      'get_cloud_run_metrics',
      'get_infrastructure_costs',
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
  if (roleMap) {
    const subset = roleMap[task];
    if (subset != null) return new Set(subset);
    // null entry means "send nothing" for that task
    if (subset === null) return subset;
  }
  // No explicit subset defined — return null (apply hard cap only)
  return null;
}

/**
 * Filter tool declarations to the allowed subset, then enforce the MAX_TOOLS cap.
 * Static tools are registered before MCP tools in agent run.ts, so truncating
 * from the end preserves core tools and drops excess MCP server tools.
 */
export function filterToolDeclarations(
  declarations: ToolDeclaration[],
  allowedNames: Set<string> | null,
): ToolDeclaration[] {
  let result = allowedNames == null
    ? declarations
    : declarations.filter((d) => allowedNames.has(d.name));

  if (result.length > MAX_TOOLS) {
    console.warn(`[ToolSubsets] Capping tools from ${result.length} to ${MAX_TOOLS}`);
    const pinned = result.filter((d) => PINNED_CAP_TOOLS.has(d.name));
    const agent365 = result.filter((d) => !PINNED_CAP_TOOLS.has(d.name) && isAgent365Declaration(d));
    const nonPinned = result.filter((d) => !PINNED_CAP_TOOLS.has(d.name) && !isAgent365Declaration(d));
    result = [...pinned, ...agent365, ...nonPinned].slice(0, MAX_TOOLS);
  }

  return result;
}
