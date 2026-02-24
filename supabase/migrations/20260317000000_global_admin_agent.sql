-- Insert Global Admin agent (Morgan Blake)
INSERT INTO company_agents (role, display_name, name, title, model, status, reports_to, is_core)
VALUES (
  'global-admin',
  'Morgan Blake',
  'Morgan Blake',
  'Global Administrator',
  'gemini-3-flash-preview',
  'active',
  'chief-of-staff',
  true
)
ON CONFLICT (role) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  name         = EXCLUDED.name,
  title        = EXCLUDED.title,
  reports_to   = EXCLUDED.reports_to,
  is_core      = EXCLUDED.is_core;
