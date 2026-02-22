-- Add VP Design & Frontend agent (Mia Tanaka)
INSERT INTO company_agents (role, display_name, model, status, schedule_cron)
VALUES ('vp-design', 'Mia Tanaka', 'gemini-3-flash-preview', 'active', NULL)
ON CONFLICT (role) DO NOTHING;
