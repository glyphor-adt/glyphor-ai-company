-- LinkedIn integration tool grants for marketing team agents
-- Tools: publish_linkedin_post, get_linkedin_posts, get_linkedin_post_analytics,
--         get_linkedin_followers, get_linkedin_page_stats, get_linkedin_demographics,
--         check_linkedin_status

INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, last_synced_at)
VALUES
  -- CMO (Maya Brooks) — full LinkedIn access
  ('cmo', 'publish_linkedin_post',          'system', NOW()),
  ('cmo', 'get_linkedin_posts',             'system', NOW()),
  ('cmo', 'get_linkedin_post_analytics',    'system', NOW()),
  ('cmo', 'get_linkedin_followers',         'system', NOW()),
  ('cmo', 'get_linkedin_page_stats',        'system', NOW()),
  ('cmo', 'get_linkedin_demographics',      'system', NOW()),
  ('cmo', 'check_linkedin_status',          'system', NOW()),

  -- Social Media Manager (Kai Johnson) — full LinkedIn access
  ('social-media-manager', 'publish_linkedin_post',          'system', NOW()),
  ('social-media-manager', 'get_linkedin_posts',             'system', NOW()),
  ('social-media-manager', 'get_linkedin_post_analytics',    'system', NOW()),
  ('social-media-manager', 'get_linkedin_followers',         'system', NOW()),
  ('social-media-manager', 'get_linkedin_page_stats',        'system', NOW()),
  ('social-media-manager', 'get_linkedin_demographics',      'system', NOW()),
  ('social-media-manager', 'check_linkedin_status',          'system', NOW()),

  -- Content Creator (Tyler Reed) — full LinkedIn access
  ('content-creator', 'publish_linkedin_post',          'system', NOW()),
  ('content-creator', 'get_linkedin_posts',             'system', NOW()),
  ('content-creator', 'get_linkedin_post_analytics',    'system', NOW()),
  ('content-creator', 'get_linkedin_followers',         'system', NOW()),
  ('content-creator', 'get_linkedin_page_stats',        'system', NOW()),
  ('content-creator', 'get_linkedin_demographics',      'system', NOW()),
  ('content-creator', 'check_linkedin_status',          'system', NOW())
ON CONFLICT (agent_role, tool_name) DO NOTHING;
