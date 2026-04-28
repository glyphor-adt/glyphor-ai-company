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
    'post_to_deliverables',
  ],
  roles: {
    'chief-of-staff': [
      'create_work_assignments',
      'dispatch_assignment',
      'read_founder_directives',
      'get_pending_decisions',
      'send_briefing',
      'generate_pdf',
      'generate_word_doc',
      'web_fetch',
    ],
    /** Grant/registry pins are merged before _universal in getAlwaysLoadedTools('cto'). */
    cto: ['get_platform_health', 'get_github_pr_status', 'create_github_issue'],
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
    ops: [
      'get_platform_health',
      'query_agent_health',
      'trigger_agent_run',
      'pause_agent',
      'resume_agent',
    ],
    'vp-design': [
      // Pinned before CORE_PINNED_TOOLS: model tool-caps (e.g. 25–40) can fill with core pins only and
      // skip retrieval entirely — then invoke_web_build never reaches the LLM and "build an app" stalls.
      'normalize_design_brief',
      'invoke_web_build',
      'invoke_web_iterate',
      'invoke_web_coding_loop',
      // Keep branch/PR recovery tools always reachable so Mia can unblock GitHub flows
      // even when sandbox_shell is denied or retrieval budget is tight.
      'github_list_branches',
      'github_create_pull_request',
      'github_get_pull_request_status',
      'github_wait_for_pull_request_checks',
      'github_merge_pull_request',
    ],
  },
};

const GRANT_PRELUDE = ['grant_tool_access', 'revoke_tool_access'] as const;

/** Registry approval path for CTO — must stay ahead of universal pins under tight model tool caps. */
const CTO_REGISTRY_PRELUDE = [
  ...GRANT_PRELUDE,
  'list_tool_requests',
  'review_tool_request',
  'register_tool',
  'list_registered_tools',
] as const;

export function getAlwaysLoadedTools(role?: CompanyAgentRole): Set<string> {
  if (!role) {
    return new Set(ALWAYS_LOADED._universal);
  }

  const rolePins = ALWAYS_LOADED.roles[role] ?? [];

  if (role === 'cto') {
    return new Set([
      ...CTO_REGISTRY_PRELUDE,
      ...ALWAYS_LOADED._universal,
      ...rolePins,
    ]);
  }

  if (role === 'chief-of-staff') {
    return new Set([...GRANT_PRELUDE, ...ALWAYS_LOADED._universal, ...rolePins]);
  }

  return new Set([...ALWAYS_LOADED._universal, ...rolePins]);
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
  '- Pulse Creative: image generation, video, storyboards, brand kits',
  '- Communication: Teams, email, calendar, channels',
].join('\n');
