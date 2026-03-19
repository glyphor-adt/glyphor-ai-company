-- Register Nexus (Platform Intelligence) as a first-class agent
INSERT INTO company_agents (
  role, display_name, model, status, config, created_at
) VALUES (
  'platform-intel',
  'Nexus',
  'claude-opus-4-6',
  'active',
  '{"department": "Operations", "title": "Platform Intelligence"}'::jsonb,
  NOW()
) ON CONFLICT (role) DO NOTHING;
