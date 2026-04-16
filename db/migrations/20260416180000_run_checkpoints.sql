-- Resumable checkpoints for long-running agent tasks.
-- Stores structured plan state + key tool results so continuation runs
-- can restore where the prior run left off instead of re-planning from scratch.

CREATE TABLE IF NOT EXISTS run_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  task TEXT NOT NULL,
  assignment_id TEXT,

  -- The execution plan from the planning phase
  execution_plan JSONB,

  -- Which steps have been completed (index into execution_plan.execution_steps)
  completed_steps INTEGER[] DEFAULT '{}',

  -- Key tool results keyed by step index: { "0": { tool, result_summary }, ... }
  step_results JSONB DEFAULT '{}'::jsonb,

  -- Acceptance criteria from the plan
  acceptance_criteria TEXT[] DEFAULT '{}',

  -- Which acceptance criteria have been satisfied
  satisfied_criteria INTEGER[] DEFAULT '{}',

  -- Cumulative action receipts (tool calls made)
  action_receipts JSONB DEFAULT '[]'::jsonb,

  -- The last text output from the agent
  last_output TEXT,

  -- Why the run stopped
  abort_reason TEXT,

  -- Turn number when checkpointed
  turn_number INTEGER NOT NULL DEFAULT 0,

  -- Token usage at checkpoint time
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup: find the latest checkpoint for a given agent+assignment
CREATE INDEX IF NOT EXISTS idx_run_checkpoints_agent_assignment
  ON run_checkpoints(agent_role, assignment_id, created_at DESC)
  WHERE assignment_id IS NOT NULL;

-- Fast lookup: find checkpoint by run_id
CREATE INDEX IF NOT EXISTS idx_run_checkpoints_run_id
  ON run_checkpoints(run_id);

-- Clean up old checkpoints (keep only recent ones)
CREATE INDEX IF NOT EXISTS idx_run_checkpoints_created
  ON run_checkpoints(created_at DESC);
