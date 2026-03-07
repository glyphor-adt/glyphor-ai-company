-- Learning Governor: task_run_outcomes
-- Records deterministic and downstream signals for every agent task run,
-- enabling the batch evaluator to score quality and the governor to
-- adjust agent behaviour over time.

CREATE TABLE IF NOT EXISTS task_run_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id),
  agent_role TEXT NOT NULL,
  directive_id UUID REFERENCES founder_directives(id),
  assignment_id UUID REFERENCES work_assignments(id),

  -- Deterministic signals (captured immediately after run)
  final_status TEXT NOT NULL,  -- 'submitted' | 'flagged_blocker' | 'partial_progress' | 'aborted' | 'failed'
  turn_count INTEGER NOT NULL,
  tool_call_count INTEGER NOT NULL,
  tool_failure_count INTEGER NOT NULL DEFAULT 0,
  had_partial_save BOOLEAN NOT NULL DEFAULT false,
  elapsed_ms INTEGER NOT NULL,
  cost_usd NUMERIC(8,4) NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,

  -- Downstream signals (populated asynchronously by batch evaluator)
  was_revised BOOLEAN,
  revision_count INTEGER DEFAULT 0,
  was_accepted BOOLEAN,
  downstream_agent_succeeded BOOLEAN,
  time_to_acceptance_ms BIGINT,

  -- Batch evaluation fields (populated by nightly evaluator)
  batch_quality_score NUMERIC(3,1),  -- 1.0-5.0, null until evaluated
  batch_evaluated_at TIMESTAMPTZ,
  evaluation_notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_run_outcomes_agent ON task_run_outcomes(agent_role);
CREATE INDEX idx_task_run_outcomes_assignment ON task_run_outcomes(assignment_id);
CREATE INDEX idx_task_run_outcomes_unevaluated ON task_run_outcomes(batch_evaluated_at) WHERE batch_evaluated_at IS NULL;
CREATE INDEX idx_task_run_outcomes_created ON task_run_outcomes(created_at);
