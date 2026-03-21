import type { CompanyAgentRole } from './types.js';

export const USE_TOOL_SEARCH_ANTHROPIC = process.env.USE_TOOL_SEARCH_ANTHROPIC === 'true';
export const USE_TOOL_SEARCH_OPENAI = process.env.USE_TOOL_SEARCH_OPENAI === 'true';

export const ANTHROPIC_TOOL_SEARCH_NAME = 'tool_search_tool_bm25';
export const ANTHROPIC_TOOL_SEARCH_TYPE = 'tool_search_tool_bm25_20251119';

const OPENAI_TOOL_SEARCH_MIN_MAJOR = 5;
const OPENAI_TOOL_SEARCH_MIN_MINOR = 4;

function parseGptVersion(model: string): { major: number; minor: number } | null {
  const match = model.match(/^gpt-(\d+)\.(\d+)(?:-|$)/i);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
  };
}

export function supportsOpenAIToolSearch(model: string): boolean {
  const version = parseGptVersion(model);
  if (!version) return false;
  if (version.major > OPENAI_TOOL_SEARCH_MIN_MAJOR) return true;
  if (version.major < OPENAI_TOOL_SEARCH_MIN_MAJOR) return false;
  return version.minor >= OPENAI_TOOL_SEARCH_MIN_MINOR;
}

export function supportsAnthropicToolSearch(model: string): boolean {
  // Anthropic server-side tool search: Sonnet 4+ and Opus 4+ (not Haiku).
  if (/^claude-sonnet-4/i.test(model)) return true;
  if (/^claude-opus-4/i.test(model)) return true;
  if (/^claude-(4|5|6|7|8|9)/i.test(model) && !/^claude-haiku-/i.test(model)) return true;
  return false;
}

export function shouldUseAnthropicToolSearch(model: string): boolean {
  return USE_TOOL_SEARCH_ANTHROPIC && supportsAnthropicToolSearch(model);
}

export function shouldUseOpenAIToolSearch(model: string): boolean {
  return USE_TOOL_SEARCH_OPENAI && supportsOpenAIToolSearch(model);
}

interface AlwaysLoadedMap {
  _universal: string[];
  roles: Partial<Record<CompanyAgentRole, string[]>>;
}

export const ALWAYS_LOADED: AlwaysLoadedMap = {
  _universal: [
    'save_memory',
    'recall_memories',
    'send_agent_message',
    'file_decision',
    'tool_search',
    'request_new_tool',
  ],
  roles: {
    'chief-of-staff': [
      'create_work_assignments',
      'dispatch_assignment',
      'read_founder_directives',
      'get_pending_decisions',
      'send_briefing',
    ],
    cto: [
      'get_platform_health',
      'query_logs',
      'check_pr_status',
      'create_github_issue',
    ],
    cfo: [
      'query_financials',
      'query_costs',
      'get_burn_rate',
    ],
    cmo: [
      'get_content_calendar',
      'approve_content_draft',
      'validate_brand_compliance',
    ],
    'content-creator': [
      'create_content_draft',
      'submit_content_for_review',
      'read_company_knowledge',
    ],
    'seo-analyst': [
      'analyze_content_seo',
      'analyze_page_seo',
      'discover_keywords',
      'read_company_knowledge',
    ],
    'social-media-manager': [
      'schedule_social_post',
      'reply_to_social',
      'read_company_knowledge',
    ],
    ops: [
      'get_platform_health',
      'query_agent_health',
      'trigger_agent_run',
      'pause_agent',
      'resume_agent',
    ],
    'platform-intel': [
      'read_gtm_report',
      'read_fleet_health',
      'read_agent_eval_detail',
      'read_handoff_health',
      'read_tool_failure_rates',
      'read_tool_call_errors',
      'read_tool_call_trace',
      'validate_tool_sql',
      'check_env_credentials',
      'trigger_reflection_cycle',
      'promote_prompt_version',
      'discard_prompt_version',
      'pause_agent',
      'resume_agent',
      'write_fleet_finding',
      'write_world_model_correction',
      'create_approval_request',
      'grant_tool_to_agent',
      'revoke_tool_from_agent',
      'emergency_block_tool',
      'register_dynamic_tool',
      'update_dynamic_tool',
      'deactivate_tool',
      'create_tool_fix_proposal',
      'list_tool_fix_proposals',
      'read_agent_config',
      'check_table_schema',
      'diagnose_column_error',
    ],
  },
};

export function getAlwaysLoadedTools(role?: CompanyAgentRole): Set<string> {
  return new Set([
    ...ALWAYS_LOADED._universal,
    ...(role ? ALWAYS_LOADED.roles[role] ?? [] : []),
  ]);
}

export const TOOL_CATEGORY_HINT = [
  '## Available Tool Categories',
  'Use tool search when you need tools outside your always-loaded set.',
  '- Finance: revenue, costs, billing, subscriptions, burn rate, unit economics',
  '- Engineering: system health, logs, deployments, CI/CD, pull requests, tests',
  '- Marketing: content, SEO, social, campaigns, brand compliance',
  '- Design: tokens, components, Figma, accessibility, templates, Storybook',
  '- Research: competitors, market data, briefs, monitoring',
  '- Operations: agent health, event bus, retries, data freshness',
  '- Legal: contracts, compliance, IP, regulations, privacy',
  '- M365/Entra: users, groups, licenses, directory roles, sign-in audits',
  '- Pulse Creative: image generation, video, storyboards, brand kits',
  '- Communication: Teams, email, calendar, channels',
].join('\n');
