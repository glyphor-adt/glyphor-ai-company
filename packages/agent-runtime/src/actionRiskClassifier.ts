import type { ActionRiskLevel } from './types.js';

export interface ActionRiskAssessment {
  level: ActionRiskLevel;
  reason: string;
}

const AUTONOMOUS_PREFIXES = [
  'get_', 'read_', 'list_', 'search_', 'fetch_', 'query_', 'check_', 'discover_', 'inspect_', 'analyze_',
  'calculate_', 'summarize_', 'draft_', 'plan_', 'review_', 'monitor_', 'recall_', 'generate_',
];

const SOFT_GATE_EXACT = new Set([
  'post_to_slack',
  'post_to_deliverables',
  'send_email',
  'send_teams_message',
  'send_message',
  'create_calendar_event',
  'schedule_meeting',
  'publish_content',
]);

const SOFT_GATE_PREFIXES = [
  'post_', 'send_', 'announce_', 'notify_', 'publish_', 'share_', 'compose_', 'create_note_',
];

const HARD_GATE_EXACT = new Set([
  'create_or_update_file',
  'create_branch',
  'create_github_pr',
  'merge_github_pr',
  'create_github_issue',
  'apply_patch_call',
]);

const HARD_GATE_PREFIXES = [
  'delete_', 'remove_', 'deploy_', 'trigger_agent_', 'retry_failed_', 'pause_agent', 'resume_agent',
  'invoke_web_', 'run_migration',
];

function matchesPrefix(name: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => name.startsWith(prefix));
}

export function classifyActionRisk(toolName: string): ActionRiskAssessment {
  const normalized = toolName.toLowerCase();

  if (HARD_GATE_EXACT.has(normalized) || matchesPrefix(normalized, HARD_GATE_PREFIXES)) {
    return {
      level: 'HARD_GATE',
      reason: 'This tool mutates shared state or can trigger an externally visible side effect.',
    };
  }

  if (SOFT_GATE_EXACT.has(normalized) || matchesPrefix(normalized, SOFT_GATE_PREFIXES)) {
    return {
      level: 'SOFT_GATE',
      reason: 'This tool produces an external side effect that is usually reversible or socially visible.',
    };
  }

  if (matchesPrefix(normalized, AUTONOMOUS_PREFIXES)) {
    return {
      level: 'AUTONOMOUS',
      reason: 'This tool is read-only or computational and does not directly mutate shared state.',
    };
  }

  return {
    level: 'SOFT_GATE',
    reason: 'This tool is not explicitly classified, so it defaults to a cautious soft-gate review tier.',
  };
}