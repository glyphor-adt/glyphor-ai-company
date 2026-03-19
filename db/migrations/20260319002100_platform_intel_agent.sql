-- Register Nexus (Platform Intelligence) as a first-class agent
INSERT INTO agents (
  id, name, title, department, model, status, created_at
) VALUES (
  'platform-intel',
  'Nexus',
  'Platform Intelligence',
  'Operations',
  'claude-opus-4-6',
  'active',
  NOW()
) ON CONFLICT (id) DO NOTHING;
