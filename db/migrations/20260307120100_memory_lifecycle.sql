-- Memory lifecycle management for the three-layer memory hierarchy.
-- Tracks promotion through raw → distilled → operative → archived layers,
-- provides cold storage for archived traces, and versions governance policies.

-- Track the lifecycle stage of each memory-related record
CREATE TABLE IF NOT EXISTS memory_lifecycle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL,       -- 'agent_reflections', 'shared_episodes', 'agent_memory', etc.
  source_id UUID NOT NULL,
  current_layer TEXT NOT NULL DEFAULT 'raw',  -- 'raw' | 'distilled' | 'operative' | 'archived'
  promoted_to_table TEXT,           -- target table when promoted (e.g., 'shared_procedures')
  promoted_to_id UUID,
  promoted_at TIMESTAMPTZ,
  promoted_by TEXT,                  -- 'episodic_replay' | 'batch_evaluator' | 'manual'
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,               -- 'ttl_expired' | 'superseded' | 'manual'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(source_table, source_id)
);

CREATE INDEX idx_memory_lifecycle_layer ON memory_lifecycle(current_layer);
CREATE INDEX idx_memory_lifecycle_source ON memory_lifecycle(source_table, source_id);

-- Cold storage for archived raw traces
CREATE TABLE IF NOT EXISTS memory_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  content JSONB NOT NULL,            -- full row snapshot
  agent_role TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ             -- permanent deletion date (null = keep forever)
);

CREATE INDEX idx_memory_archive_source ON memory_archive(source_table);
CREATE INDEX idx_memory_archive_agent ON memory_archive(agent_role);

-- Policy version tracking (used by Track 4 but created here for schema coherence)
CREATE TABLE IF NOT EXISTS policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_type TEXT NOT NULL,         -- 'prompt' | 'rubric' | 'routing' | 'model_selection' | 'constitution'
  agent_role TEXT,                    -- null = org-wide
  version INTEGER NOT NULL DEFAULT 1,
  content JSONB NOT NULL,            -- the actual policy content
  source TEXT NOT NULL,              -- 'reflection' | 'constitutional_amendment' | 'batch_evaluator' | 'manual'
  status TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'candidate' | 'canary' | 'active' | 'rolled_back'
  eval_score NUMERIC(3,2),
  eval_details JSONB,
  promoted_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  rollback_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(policy_type, agent_role, version)
);

CREATE INDEX idx_policy_versions_active ON policy_versions(policy_type, agent_role) WHERE status = 'active';
CREATE INDEX idx_policy_versions_canary ON policy_versions(status) WHERE status = 'canary';
