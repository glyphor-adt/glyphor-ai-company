-- Grant create_git_branch to all design-team agents that already have create_design_branch
-- This new tool allows both feature/design-* and feature/frontend-* branch prefixes

INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by) VALUES
  ('vp-design',           'create_git_branch', 'system'),
  ('frontend-engineer',   'create_git_branch', 'system'),
  ('design-critic',       'create_git_branch', 'system'),
  ('template-architect',  'create_git_branch', 'system'),
  ('ui-ux-designer',      'create_git_branch', 'system')
ON CONFLICT (agent_role, tool_name) DO NOTHING;

-- Register create_git_branch in tool_registry
INSERT INTO tool_registry (tool_name, description, category, status) VALUES
  ('create_git_branch',
   'Create a new branch from main for frontend work. Supports feature/design-* and feature/frontend-* prefixes.',
   'code',
   'active')
ON CONFLICT (tool_name) DO UPDATE SET status = 'active', description = EXCLUDED.description;
