BEGIN;

DO $$ BEGIN
  CREATE TYPE handoff_escalation_policy AS ENUM ('return_to_issuer', 'escalate_to_chief_of_staff', 'escalate_to_human');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE handoff_contract_status AS ENUM ('issued', 'accepted', 'rejected', 'in_progress', 'completed', 'failed', 'escalated');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS agent_handoff_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requesting_agent_id TEXT NOT NULL,
  requesting_agent_name TEXT NOT NULL,
  receiving_agent_id TEXT NOT NULL,
  receiving_agent_name TEXT NOT NULL,
  task_id TEXT NOT NULL,
  parent_contract_id UUID REFERENCES agent_handoff_contracts(id) ON DELETE SET NULL,
  task_description TEXT NOT NULL,
  required_inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  expected_output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  deadline TIMESTAMPTZ,
  escalation_policy handoff_escalation_policy NOT NULL DEFAULT 'return_to_issuer',
  status handoff_contract_status NOT NULL DEFAULT 'issued',
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  output_payload JSONB,
  output_confidence_score DOUBLE PRECISION,
  rejection_reason TEXT,
  escalation_reason TEXT,
  sla_breached_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_handoff_contracts_status_deadline
  ON agent_handoff_contracts (status, deadline, sla_breached_at);

CREATE INDEX IF NOT EXISTS idx_agent_handoff_contracts_agents
  ON agent_handoff_contracts (requesting_agent_id, receiving_agent_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_handoff_contracts_task
  ON agent_handoff_contracts (task_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS agent_handoff_contract_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES agent_handoff_contracts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_handoff_contract_audit_log_contract
  ON agent_handoff_contract_audit_log (contract_id, created_at DESC);

INSERT INTO agent_handoff_contracts (
  issued_at,
  requesting_agent_id,
  requesting_agent_name,
  receiving_agent_id,
  receiving_agent_name,
  task_id,
  task_description,
  required_inputs,
  expected_output_schema,
  confidence_threshold,
  escalation_policy,
  status,
  accepted_at,
  completed_at,
  output_payload,
  output_confidence_score,
  rejection_reason,
  escalation_reason,
  sla_breached_at,
  updated_at
)
SELECT
  COALESCE(wa.created_at, NOW()),
  wa.assigned_by,
  COALESCE(req.display_name, req.name, wa.assigned_by),
  wa.assigned_to,
  COALESCE(rec.display_name, rec.name, wa.assigned_to),
  wa.id::text,
  wa.task_description,
  jsonb_build_array(
    jsonb_build_object('key', 'task_description', 'type', 'string', 'value', wa.task_description, 'provided', true),
    jsonb_build_object('key', 'expected_output', 'type', 'string', 'value', wa.expected_output, 'provided', wa.expected_output IS NOT NULL),
    jsonb_build_object('key', 'directive_id', 'type', 'string', 'value', wa.directive_id, 'provided', wa.directive_id IS NOT NULL)
  ),
  jsonb_build_object(
    'type', 'object',
    'additionalProperties', true,
    'properties', jsonb_build_object(
      'output', jsonb_build_object('type', 'string', 'minLength', 1),
      'assignmentId', jsonb_build_object('type', 'string'),
      'submittedBy', jsonb_build_object('type', 'string'),
      'status', jsonb_build_object('type', 'string')
    ),
    'required', jsonb_build_array('output')
  ),
  0.7,
  'return_to_issuer'::handoff_escalation_policy,
  CASE wa.status
    WHEN 'completed' THEN 'completed'::handoff_contract_status
    WHEN 'failed' THEN 'failed'::handoff_contract_status
    WHEN 'blocked' THEN 'escalated'::handoff_contract_status
    WHEN 'in_progress' THEN 'in_progress'::handoff_contract_status
    WHEN 'dispatched' THEN 'accepted'::handoff_contract_status
    ELSE 'issued'::handoff_contract_status
  END,
  CASE WHEN wa.status IN ('dispatched', 'in_progress', 'completed', 'failed', 'blocked') THEN COALESCE(wa.dispatched_at, wa.updated_at, wa.created_at, NOW()) ELSE NULL END,
  CASE WHEN wa.status IN ('completed', 'failed') THEN COALESCE(wa.completed_at, wa.updated_at, NOW()) ELSE NULL END,
  CASE WHEN wa.agent_output IS NOT NULL THEN jsonb_build_object('output', wa.agent_output, 'assignmentId', wa.id::text, 'status', wa.status) ELSE NULL END,
  CASE WHEN wa.status = 'completed' THEN 1.0 ELSE NULL END,
  CASE WHEN wa.status = 'failed' THEN 'Backfilled from failed work assignment' ELSE NULL END,
  CASE WHEN wa.status = 'blocked' THEN COALESCE(wa.blocker_reason, 'Backfilled from blocked work assignment') ELSE NULL END,
  NULL,
  COALESCE(wa.updated_at, wa.created_at, NOW())
FROM work_assignments wa
LEFT JOIN company_agents req ON req.role = wa.assigned_by
LEFT JOIN company_agents rec ON rec.role = wa.assigned_to
WHERE wa.assigned_by IS NOT NULL
  AND wa.assigned_to IS NOT NULL
  AND wa.assigned_by <> wa.assigned_to
  AND NOT EXISTS (
    SELECT 1
    FROM agent_handoff_contracts existing
    WHERE existing.task_id = wa.id::text
      AND existing.requesting_agent_id = wa.assigned_by
      AND existing.receiving_agent_id = wa.assigned_to
  );

UPDATE agent_handoff_contracts child
SET parent_contract_id = parent.id
FROM work_assignments wa_child
JOIN work_assignments wa_parent ON wa_parent.id = wa_child.parent_assignment_id
JOIN agent_handoff_contracts parent ON parent.task_id = wa_parent.id::text
WHERE child.task_id = wa_child.id::text
  AND child.parent_contract_id IS NULL;

COMMIT;