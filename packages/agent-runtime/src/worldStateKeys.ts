/**
 * World State Key Subscriptions — Defines which world state keys each agent reads.
 *
 * Launch scope: Marketing Department only (7 agents).
 * Keys listed here are read from world_state at task start and injected
 * into the agent's system prompt context.
 */

export const AGENT_WORLD_STATE_KEYS: Record<string, string[]> = {
  // ─── Marketing Department ─────────────────────────────────────
  'cmo': [
    'active_campaigns',
    'brand_voice',
    'marketing_strategy',
    'budget_status',
    'audience_segments',
  ],
  'marketing-intelligence-analyst': [
    'market_trends',
    'competitor_updates',
    'active_campaigns',
    'audience_segments',
  ],
  'chief-of-staff': [
    'brand_voice',
    'marketing_strategy',
    'active_campaigns',
    'content_calendar',
    'audience_segments',
    'social_calendar',
    'keyword_targets',
  ],
};

/**
 * Domain mapping for world state reads — determines which domain
 * to query for each agent's subscribed keys.
 */
export const AGENT_WORLD_STATE_DOMAIN: Record<string, string> = {
  'cmo': 'campaign',
  'marketing-intelligence-analyst': 'market',
  'chief-of-staff': 'strategy',
};
