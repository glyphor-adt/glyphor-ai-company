-- Insert all 17 sub-team agents into company_agents

INSERT INTO company_agents (role, display_name, name, title, model, status, reports_to, is_core)
VALUES
  -- Engineering → CTO
  ('platform-engineer',      'Alex Park',        'Alex Park',        'Platform Engineer',      'gemini-3-flash-preview', 'active', 'cto', true),
  ('quality-engineer',       'Sam DeLuca',       'Sam DeLuca',       'Quality Engineer',       'gemini-3-flash-preview', 'active', 'cto', true),
  ('devops-engineer',        'Jordan Hayes',     'Jordan Hayes',     'DevOps Engineer',        'gemini-3-flash-preview', 'active', 'cto', true),
  -- Product → CPO
  ('user-researcher',        'Priya Sharma',     'Priya Sharma',     'User Researcher',        'gemini-3-flash-preview', 'active', 'cpo', true),
  ('competitive-intel',      'Daniel Ortiz',     'Daniel Ortiz',     'Competitive Intel',      'gemini-3-flash-preview', 'active', 'cpo', true),
  -- Finance → CFO
  ('revenue-analyst',        'Anna Park',        'Anna Park',        'Revenue Analyst',        'gemini-3-flash-preview', 'active', 'cfo', true),
  ('cost-analyst',           'Omar Hassan',      'Omar Hassan',      'Cost Analyst',           'gemini-3-flash-preview', 'active', 'cfo', true),
  -- Marketing → CMO
  ('content-creator',        'Tyler Reed',       'Tyler Reed',       'Content Creator',        'gemini-3-flash-preview', 'active', 'cmo', true),
  ('seo-analyst',            'Lisa Chen',        'Lisa Chen',        'SEO Analyst',            'gemini-3-flash-preview', 'active', 'cmo', true),
  ('social-media-manager',   'Kai Johnson',      'Kai Johnson',      'Social Media Manager',   'gemini-3-flash-preview', 'active', 'cmo', true),
  -- Customer Success → VP CS
  ('onboarding-specialist',  'Emma Wright',      'Emma Wright',      'Onboarding Specialist',  'gemini-3-flash-preview', 'active', 'vp-customer-success', true),
  ('support-triage',         'David Santos',     'David Santos',     'Support Triage',         'gemini-3-flash-preview', 'active', 'vp-customer-success', true),
  -- Sales → VP Sales
  ('account-research',       'Nathan Cole',      'Nathan Cole',      'Account Research',       'gemini-3-flash-preview', 'active', 'vp-sales', true),
  -- Design & Frontend → VP Design
  ('ui-ux-designer',         'Leo Vargas',       'Leo Vargas',       'UI/UX Designer',         'gemini-3-flash-preview', 'active', 'vp-design', true),
  ('frontend-engineer',      'Ava Chen',         'Ava Chen',         'Frontend Engineer',      'gemini-3-flash-preview', 'active', 'vp-design', true),
  ('design-critic',          'Sofia Marchetti',  'Sofia Marchetti',  'Design Critic',          'gemini-3-flash-preview', 'active', 'vp-design', true),
  ('template-architect',     'Ryan Park',        'Ryan Park',        'Template Architect',     'gemini-3-flash-preview', 'active', 'vp-design', true)
ON CONFLICT (role) DO UPDATE SET
  name       = EXCLUDED.name,
  title      = EXCLUDED.title,
  reports_to = EXCLUDED.reports_to,
  is_core    = EXCLUDED.is_core;

-- Also backfill reports_to for executives
UPDATE company_agents SET reports_to = 'chief-of-staff' WHERE role IN ('cto','cpo','cfo','cmo','vp-customer-success','vp-sales','vp-design') AND reports_to IS NULL;
UPDATE company_agents SET reports_to = NULL WHERE role = 'chief-of-staff' AND reports_to IS NULL;
UPDATE company_agents SET reports_to = 'chief-of-staff' WHERE role = 'ops' AND reports_to IS NULL;
