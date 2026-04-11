/**
 * Canonical tool allowlists for live "critical" roles — kept in sync with
 * scripts/config/live-role-tool-requirements.json (critical_roles only).
 *
 * Used by runtimeExecutionPolicy so child tools (e.g. github_push_files inside
 * invoke_web_build) stay authorized even when agent_tool_grants rows were
 * narrowed or deactivated by static tool-array auto-sync.
 */

const VP_DESIGN_BASELINE = [
  // required
  'normalize_design_brief',
  'build_website_foundation',
  'plan_website_build',
  'invoke_web_build',
  'invoke_web_iterate',
  'github_create_from_template',
  'github_push_files',
  'github_create_pull_request',
  'vercel_create_project',
  'vercel_get_preview_url',
  'deploy_preview',
  'save_memory',
  // recommended
  'list_my_tools',
  'tool_search',
  'invoke_web_coding_loop',
  'github_merge_pull_request',
  'github_get_pull_request_status',
  'github_wait_for_pull_request_checks',
  'vercel_wait_for_preview_ready',
  'vercel_get_production_url',
  'vercel_get_deployment_logs',
  'get_file_contents',
  'list_open_prs',
  'comment_on_pr',
  'screenshot_page',
  'run_accessibility_audit',
  'check_ai_smell',
  'send_agent_message',
  'check_messages',
  'read_inbox',
  'reply_to_email',
  'create_git_branch',
] as const;

const CHIEF_OF_STAFF_BASELINE = [
  'read_founder_directives',
  'create_work_assignments',
  'dispatch_assignment',
  'check_assignment_status',
  'update_directive_progress',
  'save_memory',
  'send_agent_message',
  'check_messages',
  'read_my_assignments',
  'submit_assignment_output',
  'flag_assignment_blocker',
  'read_inbox',
  'reply_to_email',
  'evaluate_assignment',
  'create_decision',
  'grant_tool_access',
  'revoke_tool_access',
  'get_pending_decisions',
  'log_activity',
  'read_company_memory',
  'get_recent_activity',
  'github_create_from_template',
  'github_push_files',
  'github_create_pull_request',
  'vercel_create_project',
  'vercel_get_preview_url',
] as const;

const CTO_BASELINE = [
  'get_platform_health',
  'save_memory',
  'send_agent_message',
  'check_messages',
  'read_company_memory',
  'log_activity',
  'get_recent_activity',
  'read_my_assignments',
  'get_cloud_run_metrics',
  'get_infrastructure_costs',
  'create_github_issue',
  'get_file_contents',
  'create_decision',
  'flag_assignment_blocker',
  'submit_assignment_output',
  'get_ci_health',
  'get_github_pr_status',
  'read_inbox',
  'reply_to_email',
  'send_email',
  'normalize_design_brief',
  'build_website_foundation',
  'invoke_web_build',
] as const;

const OPS_BASELINE = [
  'query_agent_health',
  'trigger_agent_run',
  'save_memory',
  'send_agent_message',
  'check_messages',
  'pause_agent',
  'resume_agent',
  'retry_failed_run',
  'query_agent_runs',
  'query_cost_trends',
  'query_events_backlog',
  'read_my_assignments',
] as const;

const BASELINE_BY_ROLE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['vp-design', new Set(VP_DESIGN_BASELINE)],
  ['chief-of-staff', new Set(CHIEF_OF_STAFF_BASELINE)],
  ['cto', new Set(CTO_BASELINE)],
  ['ops', new Set(OPS_BASELINE)],
]);

export function isCriticalBaselineTool(agentRole: string, toolName: string): boolean {
  return BASELINE_BY_ROLE.get(agentRole)?.has(toolName) ?? false;
}

export function getCriticalBaselineToolNames(agentRole: string): string[] {
  const s = BASELINE_BY_ROLE.get(agentRole);
  return s ? Array.from(s) : [];
}
