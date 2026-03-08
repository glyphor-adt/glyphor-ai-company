-- GCP schema drift repair
-- Consolidates critical missing objects discovered after the Supabase -> GCP migration.
-- Safe to re-run: all operations are idempotent.

-- 1. work_assignments status drift: live DB was missing 'draft'
ALTER TABLE work_assignments
  DROP CONSTRAINT IF EXISTS work_assignments_status_check;

ALTER TABLE work_assignments
  ADD CONSTRAINT work_assignments_status_check
  CHECK (status IN ('draft', 'pending', 'dispatched', 'in_progress', 'completed', 'failed', 'blocked', 'needs_revision'));

-- 2. task run outcomes
CREATE TABLE IF NOT EXISTS task_run_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id),
  agent_role TEXT NOT NULL,
  directive_id UUID REFERENCES founder_directives(id),
  assignment_id UUID REFERENCES work_assignments(id),
  final_status TEXT NOT NULL,
  turn_count INTEGER NOT NULL,
  tool_call_count INTEGER NOT NULL,
  tool_failure_count INTEGER NOT NULL DEFAULT 0,
  had_partial_save BOOLEAN NOT NULL DEFAULT false,
  elapsed_ms INTEGER NOT NULL,
  cost_usd NUMERIC(8,4) NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  was_revised BOOLEAN,
  revision_count INTEGER DEFAULT 0,
  was_accepted BOOLEAN,
  downstream_agent_succeeded BOOLEAN,
  time_to_acceptance_ms BIGINT,
  batch_quality_score NUMERIC(3,1),
  batch_evaluated_at TIMESTAMPTZ,
  evaluation_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_run_outcomes_agent ON task_run_outcomes(agent_role);
CREATE INDEX IF NOT EXISTS idx_task_run_outcomes_assignment ON task_run_outcomes(assignment_id);
CREATE INDEX IF NOT EXISTS idx_task_run_outcomes_unevaluated ON task_run_outcomes(batch_evaluated_at) WHERE batch_evaluated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_run_outcomes_created ON task_run_outcomes(created_at);

-- 3. plan verifications
CREATE TABLE IF NOT EXISTS plan_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  directive_id UUID NOT NULL REFERENCES founder_directives(id),
  verdict TEXT NOT NULL,
  overall_score NUMERIC(3,2),
  checks JSONB NOT NULL,
  suggestions TEXT[],
  assignment_count INTEGER NOT NULL,
  llm_verified BOOLEAN NOT NULL DEFAULT false,
  cost_usd NUMERIC(8,4) DEFAULT 0,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_verifications_directive ON plan_verifications(directive_id);

-- 4. memory lifecycle tables
CREATE TABLE IF NOT EXISTS memory_lifecycle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  current_layer TEXT NOT NULL DEFAULT 'raw',
  promoted_to_table TEXT,
  promoted_to_id UUID,
  promoted_at TIMESTAMPTZ,
  promoted_by TEXT,
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_table, source_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_lifecycle_layer ON memory_lifecycle(current_layer);
CREATE INDEX IF NOT EXISTS idx_memory_lifecycle_source ON memory_lifecycle(source_table, source_id);

CREATE TABLE IF NOT EXISTS memory_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  content JSONB NOT NULL,
  agent_role TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memory_archive_source ON memory_archive(source_table);
CREATE INDEX IF NOT EXISTS idx_memory_archive_agent ON memory_archive(agent_role);

CREATE TABLE IF NOT EXISTS policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_type TEXT NOT NULL,
  agent_role TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  content JSONB NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  eval_score NUMERIC(3,2),
  eval_details JSONB,
  promoted_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  rollback_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(policy_type, agent_role, version)
);

CREATE INDEX IF NOT EXISTS idx_policy_versions_active ON policy_versions(policy_type, agent_role) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_policy_versions_canary ON policy_versions(status) WHERE status = 'canary';

-- 5. constitutional gates audit trail
CREATE TABLE IF NOT EXISTS constitutional_gate_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES agent_runs(id),
  agent_role TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  check_phase TEXT NOT NULL,
  result TEXT NOT NULL,
  violations JSONB,
  cost_usd NUMERIC(8,4) DEFAULT 0,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_constitutional_gates_agent ON constitutional_gate_events(agent_role);
CREATE INDEX IF NOT EXISTS idx_constitutional_gates_result ON constitutional_gate_events(result);

-- 6. workflow continuation tables
CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type TEXT NOT NULL,
  initiator_role TEXT NOT NULL,
  directive_id UUID REFERENCES founder_directives(id),
  status TEXT NOT NULL DEFAULT 'running',
  current_step_index INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER,
  workflow_context JSONB NOT NULL DEFAULT '{}',
  waiting_for TEXT,
  wait_reference TEXT,
  resume_at TIMESTAMPTZ,
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
CREATE INDEX IF NOT EXISTS idx_workflows_initiator ON workflows(initiator_role);
CREATE INDEX IF NOT EXISTS idx_workflows_directive ON workflows(directive_id);
CREATE INDEX IF NOT EXISTS idx_workflows_waiting ON workflows(status, resume_at) WHERE status = 'waiting';

CREATE TABLE IF NOT EXISTS workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  step_config JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  output JSONB,
  error TEXT,
  cloud_task_id TEXT,
  run_id UUID REFERENCES agent_runs(id),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  cost_usd NUMERIC(8,4) DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workflow_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow ON workflow_steps(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_status ON workflow_steps(status) WHERE status IN ('pending', 'running', 'waiting');
CREATE INDEX IF NOT EXISTS idx_workflow_steps_cloud_task ON workflow_steps(cloud_task_id);

-- 7. delegation/sub-directive fields
ALTER TABLE founder_directives
  ADD COLUMN IF NOT EXISTS parent_directive_id UUID REFERENCES founder_directives(id),
  ADD COLUMN IF NOT EXISTS delegated_to TEXT,
  ADD COLUMN IF NOT EXISTS delegation_type TEXT,
  ADD COLUMN IF NOT EXISTS delegated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delegation_context TEXT;

CREATE INDEX IF NOT EXISTS idx_directives_parent ON founder_directives(parent_directive_id);
CREATE INDEX IF NOT EXISTS idx_directives_delegated ON founder_directives(delegated_to) WHERE delegated_to IS NOT NULL;

ALTER TABLE work_assignments
  ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'chief-of-staff';

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

INSERT INTO executive_orchestration_config
  (executive_role, can_decompose, can_evaluate, can_create_sub_directives, allowed_assignees, is_canary)
VALUES
  ('cto', true, true, false, ARRAY['platform-engineer', 'quality-engineer', 'devops-engineer', 'm365-admin'], true)
ON CONFLICT (executive_role) DO NOTHING;

-- 8. delegation metrics
CREATE MATERIALIZED VIEW IF NOT EXISTS delegation_performance AS
SELECT
  wa.created_by,
  CASE WHEN wa.created_by = 'chief-of-staff' THEN 'sarah' ELSE 'executive' END AS orchestrator_type,
  wa.created_by AS orchestrator_role,
  COUNT(*) AS total_assignments,
  COUNT(*) FILTER (WHERE wa.status = 'completed') AS completed,
  COUNT(*) FILTER (WHERE wa.status = 'needs_revision') AS revised,
  COUNT(*) FILTER (WHERE wa.status = 'blocked') AS blocked,
  AVG(tro.batch_quality_score) FILTER (WHERE tro.batch_quality_score IS NOT NULL) AS avg_quality,
  AVG(tro.turn_count) AS avg_turns,
  AVG(tro.elapsed_ms) AS avg_elapsed_ms,
  AVG(tro.cost_usd) AS avg_cost,
  COUNT(*) FILTER (WHERE tro.was_revised = true)::FLOAT / NULLIF(COUNT(*), 0) AS revision_rate,
  COUNT(*) FILTER (WHERE tro.was_accepted = true AND tro.revision_count = 0)::FLOAT
    / NULLIF(COUNT(*) FILTER (WHERE tro.was_accepted IS NOT NULL), 0) AS first_time_accept_rate,
  COUNT(*) FILTER (WHERE tro.final_status IN ('aborted', 'failed'))::FLOAT
    / NULLIF(COUNT(*), 0) AS failure_rate
FROM work_assignments wa
LEFT JOIN task_run_outcomes tro ON tro.assignment_id = wa.id
WHERE wa.created_at > NOW() - INTERVAL '30 days'
GROUP BY wa.created_by;

CREATE UNIQUE INDEX IF NOT EXISTS idx_delegation_perf_role ON delegation_performance(orchestrator_role);

CREATE OR REPLACE FUNCTION refresh_delegation_metrics() RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY delegation_performance;
END;
$$ LANGUAGE plpgsql;

-- 9. chat_messages metadata for Ora and related chat features
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;