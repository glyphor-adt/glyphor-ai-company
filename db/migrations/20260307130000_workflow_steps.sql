-- Durable workflow continuation: multi-step processes that span multiple Cloud Tasks dispatches.
-- Each step runs as an independent Cloud Run request. Intermediate state persisted to PostgreSQL.

CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  workflow_type TEXT NOT NULL,  
    -- 'directive_orchestration' | 'research_chain' | 'deep_dive' | 
    -- 'strategy_lab' | 'code_evolution' | 'approval_wait' | 'custom'
  
  initiator_role TEXT NOT NULL,
  directive_id UUID REFERENCES founder_directives(id),
  
  status TEXT NOT NULL DEFAULT 'running',  
    -- 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'paused'
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

CREATE INDEX idx_workflows_status ON workflows(status);
CREATE INDEX idx_workflows_initiator ON workflows(initiator_role);
CREATE INDEX idx_workflows_directive ON workflows(directive_id);
CREATE INDEX idx_workflows_waiting ON workflows(status, resume_at) WHERE status = 'waiting';

CREATE TABLE IF NOT EXISTS workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  
  step_index INTEGER NOT NULL,
  step_type TEXT NOT NULL,  
    -- 'agent_run' | 'parallel_agents' | 'wait_approval' | 'wait_webhook' |
    -- 'wait_delay' | 'evaluate' | 'synthesize' | 'enqueue_subtasks'
  step_config JSONB NOT NULL,
  
  status TEXT NOT NULL DEFAULT 'pending',  
    -- 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting'
  
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

CREATE INDEX idx_workflow_steps_workflow ON workflow_steps(workflow_id);
CREATE INDEX idx_workflow_steps_status ON workflow_steps(status) WHERE status IN ('pending', 'running', 'waiting');
CREATE INDEX idx_workflow_steps_cloud_task ON workflow_steps(cloud_task_id);
