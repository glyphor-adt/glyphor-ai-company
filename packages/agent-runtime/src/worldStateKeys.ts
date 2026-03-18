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
  'content-creator': [
    'brand_voice',
    'active_campaigns',
    'content_calendar',
    'audience_segments',
  ],
  'seo-analyst': [
    'keyword_targets',
    'site_performance',
    'content_calendar',
  ],
  'social-media-manager': [
    'active_campaigns',
    'brand_voice',
    'social_calendar',
    'audience_segments',
  ],
  'competitive-intel': [
    'competitor_updates',
    'market_position',
    'pricing_intel',
  ],
  'user-researcher': [
    'audience_segments',
    'customer_feedback',
    'persona_updates',
  ],
  'market-research-analyst': [
    'market_trends',
    'competitor_updates',
    'industry_reports',
  ],
  'marketing-intelligence-analyst': [
    'market_trends',
    'competitor_updates',
    'active_campaigns',
    'audience_segments',
  ],
};

/**
 * Domain mapping for world state reads — determines which domain
 * to query for each agent's subscribed keys.
 */
export const AGENT_WORLD_STATE_DOMAIN: Record<string, string> = {
  'cmo': 'campaign',
  'content-creator': 'campaign',
  'seo-analyst': 'market',
  'social-media-manager': 'campaign',
  'competitive-intel': 'market',
  'user-researcher': 'customer',
  'market-research-analyst': 'market',
  'marketing-intelligence-analyst': 'market',
};
