-- Prompt Versioning: Track every system prompt change per agent.
-- Enables self-improvement loop (reflection → mutation → shadow test → promotion).

CREATE TABLE IF NOT EXISTS agent_prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'system',
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,
  change_summary TEXT,                        -- what changed and why (from reflection agent)
  source TEXT NOT NULL DEFAULT 'manual'       -- 'manual' | 'reflection' | 'shadow_promoted'
    CHECK (source IN ('manual', 'reflection', 'shadow_promoted')),
  performance_score_at_deploy NUMERIC,        -- snapshot of score when this version went live
  deployed_at TIMESTAMPTZ DEFAULT NULL,       -- null = staged, not yet live
  retired_at TIMESTAMPTZ DEFAULT NULL,        -- null = current or staged
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, agent_id, version)
);

CREATE INDEX IF NOT EXISTS idx_apv_agent_id ON agent_prompt_versions(agent_id);
CREATE INDEX IF NOT EXISTS idx_apv_deployed ON agent_prompt_versions(agent_id, deployed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_apv_tenant_agent ON agent_prompt_versions(tenant_id, agent_id);
