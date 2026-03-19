-- Facebook / Meta integration tool grants for marketing team agents
-- Tools: publish_facebook_post, schedule_facebook_post, get_facebook_posts,
--         get_facebook_insights, get_facebook_post_performance, get_facebook_audience,
--         check_facebook_status

INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, last_synced_at)
VALUES
  -- CMO (Maya Brooks) — full Facebook access
  ('cmo', 'publish_facebook_post',          'system', NOW()),
  ('cmo', 'schedule_facebook_post',         'system', NOW()),
  ('cmo', 'get_facebook_posts',             'system', NOW()),
  ('cmo', 'get_facebook_insights',          'system', NOW()),
  ('cmo', 'get_facebook_post_performance',  'system', NOW()),
  ('cmo', 'get_facebook_audience',          'system', NOW()),
  ('cmo', 'check_facebook_status',          'system', NOW()),

  -- Social Media Manager (Kai Johnson) — full Facebook access
  ('social-media-manager', 'publish_facebook_post',          'system', NOW()),
  ('social-media-manager', 'schedule_facebook_post',         'system', NOW()),
  ('social-media-manager', 'get_facebook_posts',             'system', NOW()),
  ('social-media-manager', 'get_facebook_insights',          'system', NOW()),
  ('social-media-manager', 'get_facebook_post_performance',  'system', NOW()),
  ('social-media-manager', 'get_facebook_audience',          'system', NOW()),
  ('social-media-manager', 'check_facebook_status',          'system', NOW()),

  -- Content Creator (Tyler Reed) — read access + publish (approved content only)
  ('content-creator', 'publish_facebook_post',          'system', NOW()),
  ('content-creator', 'schedule_facebook_post',         'system', NOW()),
  ('content-creator', 'get_facebook_posts',             'system', NOW()),
  ('content-creator', 'get_facebook_insights',          'system', NOW()),
  ('content-creator', 'get_facebook_post_performance',  'system', NOW()),
  ('content-creator', 'get_facebook_audience',          'system', NOW()),
  ('content-creator', 'check_facebook_status',          'system', NOW())
ON CONFLICT (agent_role, tool_name) DO NOTHING;
