-- Plan/context compliance manifests + observability-friendly counters on agent_runs

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS plan_manifest JSONB;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS context_manifest JSONB;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS fast_path_reason TEXT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS mutating_tool_calls INT;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS completion_gate_passed BOOLEAN;

COMMENT ON COLUMN agent_runs.plan_manifest IS 'Structured execution plan JSON (objective, criteria, steps) when planning produced a parseable plan';
COMMENT ON COLUMN agent_runs.context_manifest IS 'Audit trail of context injections: source, policy tag, char estimates (not full content)';
COMMENT ON COLUMN agent_runs.fast_path_reason IS 'When planning_mode=off, why (e.g. on_demand, heartbeat)';
COMMENT ON COLUMN agent_runs.mutating_tool_calls IS 'Count of tool invocations classified as mutating (non-read-only)';
COMMENT ON COLUMN agent_runs.completion_gate_passed IS 'Whether acceptance-criteria completion gate passed, when enabled';
