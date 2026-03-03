-- Wave 1: Marketing team tool grants
-- Seeds agent_tool_grants for marketing agents with new shared tools
-- Safe to re-run: ON CONFLICT DO NOTHING

-- CMO (Maya Brooks) — gets ALL marketing tools
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  -- contentTools
  ('cmo', 'create_content_draft', 'system'),
  ('cmo', 'update_content_draft', 'system'),
  ('cmo', 'get_content_drafts', 'system'),
  ('cmo', 'publish_content', 'system'),
  ('cmo', 'get_content_metrics', 'system'),
  ('cmo', 'get_content_calendar', 'system'),
  ('cmo', 'generate_content_image', 'system'),
  -- seoTools (read access)
  ('cmo', 'get_search_performance', 'system'),
  ('cmo', 'get_seo_data', 'system'),
  ('cmo', 'track_keyword_rankings', 'system'),
  ('cmo', 'analyze_page_seo', 'system'),
  ('cmo', 'get_indexing_status', 'system'),
  ('cmo', 'get_backlink_profile', 'system'),
  -- socialMediaTools (read access)
  ('cmo', 'get_scheduled_posts', 'system'),
  ('cmo', 'get_social_metrics', 'system'),
  ('cmo', 'get_post_performance', 'system'),
  ('cmo', 'get_social_audience', 'system'),
  ('cmo', 'get_trending_topics', 'system'),
  -- emailMarketingTools (full access)
  ('cmo', 'get_mailchimp_lists', 'system'),
  ('cmo', 'get_mailchimp_members', 'system'),
  ('cmo', 'get_mailchimp_segments', 'system'),
  ('cmo', 'create_mailchimp_campaign', 'system'),
  ('cmo', 'set_campaign_content', 'system'),
  ('cmo', 'send_test_campaign', 'system'),
  ('cmo', 'send_campaign', 'system'),
  ('cmo', 'get_campaign_report', 'system'),
  ('cmo', 'get_campaign_list', 'system'),
  ('cmo', 'manage_mailchimp_tags', 'system'),
  ('cmo', 'send_transactional_email', 'system'),
  ('cmo', 'get_mandrill_stats', 'system'),
  ('cmo', 'search_mandrill_messages', 'system'),
  ('cmo', 'get_mandrill_templates', 'system'),
  ('cmo', 'render_mandrill_template', 'system'),
  -- marketingIntelTools
  ('cmo', 'create_experiment', 'system'),
  ('cmo', 'get_experiment_results', 'system'),
  ('cmo', 'monitor_competitor_marketing', 'system'),
  ('cmo', 'analyze_market_trends', 'system'),
  ('cmo', 'get_attribution_data', 'system'),
  ('cmo', 'capture_lead', 'system'),
  ('cmo', 'get_lead_pipeline', 'system'),
  ('cmo', 'score_lead', 'system'),
  ('cmo', 'get_marketing_dashboard', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Content Creator (Tyler Reed) — content + email marketing tools
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  -- contentTools
  ('content-creator', 'create_content_draft', 'system'),
  ('content-creator', 'update_content_draft', 'system'),
  ('content-creator', 'get_content_drafts', 'system'),
  ('content-creator', 'get_content_metrics', 'system'),
  ('content-creator', 'get_content_calendar', 'system'),
  ('content-creator', 'generate_content_image', 'system'),
  -- emailMarketingTools (content-related)
  ('content-creator', 'set_campaign_content', 'system'),
  ('content-creator', 'send_test_campaign', 'system'),
  ('content-creator', 'render_mandrill_template', 'system'),
  ('content-creator', 'get_mandrill_templates', 'system'),
  ('content-creator', 'search_mandrill_messages', 'system'),
  ('content-creator', 'get_campaign_report', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- SEO Analyst (Lisa Chen) — all SEO tools
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('seo-analyst', 'get_search_performance', 'system'),
  ('seo-analyst', 'get_seo_data', 'system'),
  ('seo-analyst', 'track_keyword_rankings', 'system'),
  ('seo-analyst', 'analyze_page_seo', 'system'),
  ('seo-analyst', 'get_indexing_status', 'system'),
  ('seo-analyst', 'submit_sitemap', 'system'),
  ('seo-analyst', 'update_seo_data', 'system'),
  ('seo-analyst', 'get_backlink_profile', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Social Media Manager (Kai Johnson) — all social media tools
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('social-media-manager', 'schedule_social_post', 'system'),
  ('social-media-manager', 'get_scheduled_posts', 'system'),
  ('social-media-manager', 'get_social_metrics', 'system'),
  ('social-media-manager', 'get_post_performance', 'system'),
  ('social-media-manager', 'get_social_audience', 'system'),
  ('social-media-manager', 'reply_to_social', 'system'),
  ('social-media-manager', 'get_trending_topics', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;
