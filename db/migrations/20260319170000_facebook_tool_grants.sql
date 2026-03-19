-- Facebook / Meta integration tool grants for marketing team agents
-- Tools: publish_facebook_post, schedule_facebook_post, get_facebook_posts,
--         get_facebook_insights, get_facebook_post_performance, get_facebook_audience,
--         check_facebook_status

INSERT INTO agent_tool_grants (agent_role, tool_name, granted_at,  last_synced_at)
VALUES
  -- CMO (Maya Brooks) — full Facebook access
  ('cmo', 'publish_facebook_post',          NOW(), NOW()),
  ('cmo', 'schedule_facebook_post',         NOW(), NOW()),
  ('cmo', 'get_facebook_posts',             NOW(), NOW()),
  ('cmo', 'get_facebook_insights',          NOW(), NOW()),
  ('cmo', 'get_facebook_post_performance',  NOW(), NOW()),
  ('cmo', 'get_facebook_audience',          NOW(), NOW()),
  ('cmo', 'check_facebook_status',          NOW(), NOW()),

  -- Social Media Manager (Kai Johnson) — full Facebook access
  ('social-media-manager', 'publish_facebook_post',          NOW(), NOW()),
  ('social-media-manager', 'schedule_facebook_post',         NOW(), NOW()),
  ('social-media-manager', 'get_facebook_posts',             NOW(), NOW()),
  ('social-media-manager', 'get_facebook_insights',          NOW(), NOW()),
  ('social-media-manager', 'get_facebook_post_performance',  NOW(), NOW()),
  ('social-media-manager', 'get_facebook_audience',          NOW(), NOW()),
  ('social-media-manager', 'check_facebook_status',          NOW(), NOW()),

  -- Content Creator (Tyler Reed) — read access + publish (approved content only)
  ('content-creator', 'publish_facebook_post',          NOW(), NOW()),
  ('content-creator', 'schedule_facebook_post',         NOW(), NOW()),
  ('content-creator', 'get_facebook_posts',             NOW(), NOW()),
  ('content-creator', 'get_facebook_insights',          NOW(), NOW()),
  ('content-creator', 'get_facebook_post_performance',  NOW(), NOW()),
  ('content-creator', 'get_facebook_audience',          NOW(), NOW()),
  ('content-creator', 'check_facebook_status',          NOW(), NOW())
ON CONFLICT (agent_role, tool_name) DO NOTHING;
