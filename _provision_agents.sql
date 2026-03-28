-- Provision marketing department agents
INSERT INTO tenant_agents (tenant_id, agent_role, display_name, title, model_tier, brief_template, is_active, created_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'cmo', 'Maya Brooks', 'Chief Marketing Officer', 'high', 'Review customer brand knowledge, plan content calendar, and coordinate the marketing team.', true, NOW()),
  ('00000000-0000-0000-0000-000000000000', 'content-creator', 'Tyler Reed', 'Content Creator', 'default', 'Create blog posts, social media copy, and marketing collateral based on the content calendar.', true, NOW()),
  ('00000000-0000-0000-0000-000000000000', 'seo-analyst', 'Lisa Chen', 'SEO Analyst', 'default', 'Analyze search performance, track keyword rankings, and recommend SEO improvements.', true, NOW()),
  ('00000000-0000-0000-0000-000000000000', 'social-media-manager', 'Kai Johnson', 'Social Media Manager', 'default', 'Schedule and publish social media content, monitor engagement, and optimize posting cadence.', true, NOW())
ON CONFLICT (tenant_id, agent_role) DO NOTHING;

-- Update onboarding phase to awaiting_channel
UPDATE customer_tenants
SET settings = COALESCE(settings, '{}'::jsonb) || '{"onboarding_phase": "awaiting_channel"}'::jsonb,
    updated_at = NOW()
WHERE id = 'acf2a335-bdc4-4d33-96a6-060be1358076'
RETURNING settings->>'onboarding_phase' AS phase;

-- Verify agents were created
SELECT agent_role, display_name, title FROM tenant_agents WHERE tenant_id = '00000000-0000-0000-0000-000000000000';
