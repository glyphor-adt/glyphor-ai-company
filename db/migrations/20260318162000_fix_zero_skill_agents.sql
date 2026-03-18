-- C.7: Fix zero-skill agents — add missing company_agents rows and assign skills
-- Three agents have runner code but no company_agents entry: competitive-intel, user-researcher, vp-sales
-- These need both: (1) company_agents row creation, (2) skill assignments

-- 1. Insert missing agents into company_agents
INSERT INTO company_agents (role, display_name, model, status, department, name, title, reports_to, is_core, temperature, max_turns, team, thinking_enabled)
VALUES
  ('competitive-intel', 'Daniel Ortiz', 'gpt-5-mini-2025-08-07', 'active', 'Product', 'Daniel Ortiz', 'Competitive Intelligence Analyst', 'cpo', true, 0.3, 50, 'Product', true),
  ('user-researcher', 'Priya Sharma', 'gpt-5-mini-2025-08-07', 'active', 'Product', 'Priya Sharma', 'User Researcher', 'cpo', true, 0.3, 50, 'Product', true),
  ('vp-sales', 'James Mitchell', 'gpt-5-mini-2025-08-07', 'active', 'Sales', 'James Mitchell', 'VP of Sales', 'chief-of-staff', true, 0.3, 50, 'Sales', true)
ON CONFLICT (role) DO UPDATE SET status = 'active', model = EXCLUDED.model;

-- 2. Assign skills to vp-sales
INSERT INTO agent_skills (agent_role, skill_id)
SELECT 'vp-sales', id FROM skills WHERE slug IN ('account-research', 'proposal-generation')
ON CONFLICT DO NOTHING;

-- 3. Assign skills to user-researcher
INSERT INTO agent_skills (agent_role, skill_id)
SELECT 'user-researcher', id FROM skills WHERE slug = 'user-research'
ON CONFLICT DO NOTHING;

-- 4. Assign skills to competitive-intel
INSERT INTO agent_skills (agent_role, skill_id)
SELECT 'competitive-intel', id FROM skills WHERE slug IN ('competitive-analysis', 'competitive-intelligence')
ON CONFLICT DO NOTHING;
