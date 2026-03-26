-- Global strategy world_state rows (entity_id NULL). Partial index enables ON CONFLICT upsert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_global_tenant_domain_key
  ON world_state (tenant_id, domain, key)
  WHERE entity_id IS NULL;

INSERT INTO world_state (tenant_id, domain, entity_id, key, value, written_by_agent, confidence, valid_until)
VALUES
(
  'system',
  'strategy',
  NULL,
  'brand_voice',
  $brand_voice${
  "tone": "confident, clear, architectural",
  "not": "irreverent, corporate, technical-jargon-heavy",
  "rules": [
    "present tense, active voice",
    "numbers beat adjectives",
    "no exclamation marks in external copy",
    "no buzzwords",
    "no hedging",
    "lead with the outcome"
  ],
  "product_naming": {
    "external": "AI Marketing Department",
    "never_externally": ["Pulse", "Web Build", "Revy", "Cockpit"]
  }
}$brand_voice$::jsonb,
  'founder:kristina',
  1.0,
  NULL
),
(
  'system',
  'strategy',
  NULL,
  'marketing_strategy',
  $marketing_strategy${
  "phase": "pre-launch",
  "primary_channel": "Slack",
  "gtm_wedge": "Slack-first, Teams planned as parallel surface",
  "target": "founder-led SMBs, 5-50 employees",
  "positioning": "AI Marketing Department — a functioning team, not a tool",
  "current_focus": ["Still You campaign launch", "Slack landing page", "LinkedIn presence"],
  "not_yet": ["paid ads", "enterprise", "Teams-primary", "dashboard-primary"]
}$marketing_strategy$::jsonb,
  'founder:kristina',
  1.0,
  NULL
),
(
  'system',
  'strategy',
  NULL,
  'audience_segments',
  $audience_segments${
  "primary": {
    "description": "Founder-led SMBs, 5-50 employees",
    "pain": "Cannot justify full-time marketing hire or agency retainer",
    "evaluation": "Short decision cycle, practical, values speed and output quality",
    "channel": "Slack",
    "tone": "Speak directly to the founder, not to a marketing team"
  },
  "not_this_phase": ["enterprise", "regulated industries", "complex procurement"]
}$audience_segments$::jsonb,
  'founder:kristina',
  1.0,
  NULL
),
(
  'system',
  'strategy',
  NULL,
  'active_campaigns',
  $active_campaigns${
  "campaigns": [
    {
      "name": "Still You",
      "status": "pre-launch",
      "description": "6-ad campaign showing copilots leave you doing the work yourself. Glyphor builds departments.",
      "tagline": "Everyone else built a copilot. We built a department.",
      "formats": ["short-form video", "LinkedIn posts", "landing page"],
      "target_launch": "Q2 2026"
    }
  ]
}$active_campaigns$::jsonb,
  'founder:kristina',
  1.0,
  NULL
),
(
  'system',
  'strategy',
  NULL,
  'content_calendar',
  $content_calendar${
  "status": "pending",
  "weekly_targets": {
    "linkedin_posts": 3,
    "blog_drafts": 1,
    "email_campaign_drafts": 1
  },
  "current_priorities": [
    "Still You campaign assets",
    "Slack landing page copy",
    "AI Marketing Department launch content"
  ]
}$content_calendar$::jsonb,
  'founder:kristina',
  1.0,
  NULL
),
(
  'system',
  'strategy',
  NULL,
  'keyword_targets',
  $keyword_targets${
  "status": "research_needed",
  "seed_keywords": [
    "AI marketing department",
    "AI marketing team for small business",
    "automated marketing for startups",
    "replace marketing agency AI",
    "Slack marketing automation"
  ],
  "intent": "commercial investigation + bottom of funnel",
  "note": "SEO analyst should expand this list from research"
}$keyword_targets$::jsonb,
  'founder:kristina',
  1.0,
  NULL
),
(
  'system',
  'strategy',
  NULL,
  'social_calendar',
  $social_calendar${
  "status": "pending",
  "platforms": ["LinkedIn", "Twitter/X"],
  "not_yet": ["TikTok", "Instagram"],
  "posting_frequency": {
    "linkedin": "3x per week",
    "twitter": "daily when possible"
  },
  "current_focus": "pre-launch audience building and thought leadership"
}$social_calendar$::jsonb,
  'founder:kristina',
  1.0,
  NULL
)
ON CONFLICT (tenant_id, domain, key) WHERE (entity_id IS NULL)
DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW(),
  written_by_agent = EXCLUDED.written_by_agent,
  confidence = EXCLUDED.confidence,
  valid_until = EXCLUDED.valid_until;
