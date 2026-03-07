-- Hierarchical executive orchestration: enables domain executives to decompose 
-- and evaluate work within their departments. Sarah routes directives to executives
-- based on domain classification.

-- Add delegation fields to founder_directives
ALTER TABLE founder_directives 
  ADD COLUMN IF NOT EXISTS parent_directive_id UUID REFERENCES founder_directives(id),
  ADD COLUMN IF NOT EXISTS delegated_to TEXT,
  ADD COLUMN IF NOT EXISTS delegation_type TEXT,
  ADD COLUMN IF NOT EXISTS delegated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delegation_context TEXT;

CREATE INDEX IF NOT EXISTS idx_directives_parent ON founder_directives(parent_directive_id);
CREATE INDEX IF NOT EXISTS idx_directives_delegated ON founder_directives(delegated_to) WHERE delegated_to IS NOT NULL;

-- Track which executive created which assignments
ALTER TABLE work_assignments
  ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'chief-of-staff';

-- Executive orchestration permissions
CREATE TABLE IF NOT EXISTS executive_orchestration_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  executive_role TEXT NOT NULL UNIQUE,
  
  can_decompose BOOLEAN NOT NULL DEFAULT false,
  can_evaluate BOOLEAN NOT NULL DEFAULT false,
  can_create_sub_directives BOOLEAN NOT NULL DEFAULT false,
  
  allowed_assignees TEXT[] NOT NULL,
  max_assignments_per_directive INTEGER NOT NULL DEFAULT 10,
  requires_plan_verification BOOLEAN NOT NULL DEFAULT true,
  
  is_canary BOOLEAN NOT NULL DEFAULT false,
  canary_started_at TIMESTAMPTZ,
  canary_directive_count INTEGER NOT NULL DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: only CTO enabled for canary initially
INSERT INTO executive_orchestration_config 
  (executive_role, can_decompose, can_evaluate, can_create_sub_directives, allowed_assignees, is_canary)
VALUES 
  ('cto', true, true, false, 
   ARRAY['platform-engineer', 'quality-engineer', 'devops-engineer', 'm365-admin'],
   true)
ON CONFLICT (executive_role) DO NOTHING;
