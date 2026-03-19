-- LinkedIn integration tool grants for marketing team agents
-- Tools: publish_linkedin_post, get_linkedin_posts, get_linkedin_post_analytics,
--         get_linkedin_followers, get_linkedin_page_stats, get_linkedin_demographics,
--         check_linkedin_status

INSERT INTO agent_tool_grants (agent_role, tool_name, granted_at, last_synced_at)
VALUES
  -- CMO (Maya Brooks) — full LinkedIn access
  ('cmo', 'publish_linkedin_post',          NOW(), NOW()),
  ('cmo', 'get_linkedin_posts',             NOW(), NOW()),
  ('cmo', 'get_linkedin_post_analytics',    NOW(), NOW()),
  ('cmo', 'get_linkedin_followers',         NOW(), NOW()),
  ('cmo', 'get_linkedin_page_stats',        NOW(), NOW()),
  ('cmo', 'get_linkedin_demographics',      NOW(), NOW()),
  ('cmo', 'check_linkedin_status',          NOW(), NOW()),

  -- Social Media Manager (Kai Johnson) — full LinkedIn access
  ('social-media-manager', 'publish_linkedin_post',          NOW(), NOW()),
  ('social-media-manager', 'get_linkedin_posts',             NOW(), NOW()),
  ('social-media-manager', 'get_linkedin_post_analytics',    NOW(), NOW()),
  ('social-media-manager', 'get_linkedin_followers',         NOW(), NOW()),
  ('social-media-manager', 'get_linkedin_page_stats',        NOW(), NOW()),
  ('social-media-manager', 'get_linkedin_demographics',      NOW(), NOW()),
  ('social-media-manager', 'check_linkedin_status',          NOW(), NOW()),

  -- Content Creator (Tyler Reed) — full LinkedIn access
  ('content-creator', 'publish_linkedin_post',          NOW(), NOW()),
  ('content-creator', 'get_linkedin_posts',             NOW(), NOW()),
  ('content-creator', 'get_linkedin_post_analytics',    NOW(), NOW()),
  ('content-creator', 'get_linkedin_followers',         NOW(), NOW()),
  ('content-creator', 'get_linkedin_page_stats',        NOW(), NOW()),
  ('content-creator', 'get_linkedin_demographics',      NOW(), NOW()),
  ('content-creator', 'check_linkedin_status',          NOW(), NOW())
ON CONFLICT (agent_role, tool_name) DO NOTHING;
