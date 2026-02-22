-- Mark core agents that can't be deleted from dashboard
UPDATE company_agents SET is_core = true WHERE id IN (
  'chief-of-staff', 'cto', 'cfo', 'cpo', 'cmo',
  'vp-customer-success', 'vp-sales', 'vp-design', 'ops',
  'platform-engineer', 'quality-engineer', 'devops-engineer',
  'user-researcher', 'competitive-intel', 'revenue-analyst',
  'cost-analyst', 'content-creator', 'seo-analyst',
  'social-media-manager', 'onboarding-specialist', 'support-triage',
  'account-research', 'ui-ux-designer', 'frontend-engineer',
  'design-critic', 'template-architect'
);
