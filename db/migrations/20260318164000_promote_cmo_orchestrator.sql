-- C.10: Promote CMO to OrchestratorRunner
-- CMO gets executive orchestration capabilities to decompose content/marketing directives
-- into assignments for content-creator, seo-analyst, social-media-manager, marketing-intelligence-analyst

INSERT INTO executive_orchestration_config (
  executive_role, can_decompose, can_evaluate, can_create_sub_directives,
  allowed_assignees, max_assignments_per_directive,
  requires_plan_verification, is_canary
) VALUES (
  'cmo', true, true, false,
  ARRAY['content-creator', 'seo-analyst', 'social-media-manager', 'marketing-intelligence-analyst'],
  8, true, true
)
ON CONFLICT (executive_role) DO UPDATE SET
  can_decompose = true,
  can_evaluate = true,
  allowed_assignees = ARRAY['content-creator', 'seo-analyst', 'social-media-manager', 'marketing-intelligence-analyst'],
  max_assignments_per_directive = 8,
  updated_at = NOW();
