-- Fix agents created at runtime without proper display names or profiles.
-- Assigns real persona names, titles, and creates missing profiles.

-- ── Ensure these agents exist (they may have been created at runtime) ──
INSERT INTO company_agents (role, display_name, name, title, model, status, reports_to, is_core)
VALUES
  ('enterprise-account-researcher', 'Ethan Morse', 'Ethan Morse', 'Enterprise Account Researcher', 'gemini-3-flash-preview', 'active', 'vp-sales', true),
  ('bob-the-tax-pro', 'Robert "Bob" Finley', 'Robert Finley', 'CPA & Tax Strategist', 'gemini-3-flash-preview', 'active', 'clo', true),
  ('data-integrity-auditor', 'Grace Hwang', 'Grace Hwang', 'Data Integrity Auditor', 'gemini-3-flash-preview', 'active', 'clo', true),
  ('tax-strategy-specialist', 'Mariana Solis', 'Mariana Solis', 'CPA & Tax Strategist', 'gemini-3-flash-preview', 'active', 'clo', true),
  ('lead-gen-specialist', 'Derek Owens', 'Derek Owens', 'Lead Generation Specialist', 'gemini-3-flash-preview', 'active', 'chief-of-staff', true),
  ('marketing-intelligence-analyst', 'Zara Petrov', 'Zara Petrov', 'Marketing Intelligence Analyst', 'gemini-3-flash-preview', 'active', 'cmo', true),
  ('adi-rose', 'Adi Rose', 'Adi Rose', 'Executive Assistant to COO', 'gemini-3-flash-preview', 'active', 'chief-of-staff', true)
ON CONFLICT (role) DO NOTHING;

-- ── Fix display_name and name for agents that were using their role as name ──
UPDATE company_agents SET
  display_name = 'Ethan Morse',
  name = 'Ethan Morse',
  title = 'Enterprise Account Researcher'
WHERE role = 'enterprise-account-researcher' AND display_name = 'Enterprise Account Researcher';

UPDATE company_agents SET
  display_name = 'Robert "Bob" Finley',
  name = 'Robert Finley',
  title = 'CPA & Tax Strategist'
WHERE role = 'bob-the-tax-pro' AND display_name = 'Bob the Tax Pro';

UPDATE company_agents SET
  display_name = 'Grace Hwang',
  name = 'Grace Hwang',
  title = 'Data Integrity Auditor'
WHERE role = 'data-integrity-auditor' AND display_name = 'Data Integrity Auditor';

UPDATE company_agents SET
  display_name = 'Mariana Solis',
  name = 'Mariana Solis',
  title = 'CPA & Tax Strategist'
WHERE role = 'tax-strategy-specialist' AND display_name = 'Tax Strategy Specialist';

UPDATE company_agents SET
  display_name = 'Derek Owens',
  name = 'Derek Owens',
  title = 'Lead Generation Specialist'
WHERE role = 'lead-gen-specialist' AND display_name = 'Lead Gen Specialist';

UPDATE company_agents SET
  display_name = 'Zara Petrov',
  name = 'Zara Petrov',
  title = 'Marketing Intelligence Analyst'
WHERE role = 'marketing-intelligence-analyst' AND display_name = 'Marketing Intelligence Analyst';

-- ── Create missing agent_profiles with avatar_url ──
INSERT INTO agent_profiles (agent_id, avatar_url, personality_summary)
VALUES
  ('enterprise-account-researcher', '/avatars/enterprise-account-researcher.png', 'Methodical researcher who builds comprehensive account dossiers.'),
  ('bob-the-tax-pro', '/avatars/bob-the-tax-pro.png', 'Pragmatic tax strategist with an eye for optimization opportunities.'),
  ('data-integrity-auditor', '/avatars/data-integrity-auditor.png', 'Detail-oriented auditor who ensures data accuracy across all systems.'),
  ('tax-strategy-specialist', '/avatars/tax-strategy-specialist.png', 'Strategic tax planner focused on compliance and minimization.'),
  ('lead-gen-specialist', '/avatars/lead-gen-specialist.png', 'Driven specialist who identifies and qualifies high-value prospects.'),
  ('marketing-intelligence-analyst', '/avatars/marketing-intelligence-analyst.png', 'Analytical mind that turns market signals into actionable insights.'),
  ('adi-rose', '/avatars/adi-rose.png', 'Efficient executive assistant with a knack for keeping operations running smoothly.')
ON CONFLICT (agent_id) DO UPDATE SET
  avatar_url = EXCLUDED.avatar_url
WHERE agent_profiles.avatar_url IS NULL OR agent_profiles.avatar_url = '';

-- ── Fix existing profiles that have NULL avatar_url ──
UPDATE agent_profiles SET avatar_url = '/avatars/' || agent_id || '.png'
WHERE avatar_url IS NULL OR avatar_url = '';
