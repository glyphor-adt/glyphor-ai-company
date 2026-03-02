-- Autonomous Operations: Agent Memory + Reflections
-- Persistent memory and self-reflection for agent learning

-- Agent memories — facts, learnings, observations, preferences
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  content TEXT NOT NULL,
  importance DECIMAL(3,2) DEFAULT 0.50,
  source_run_id TEXT,
  tags TEXT[] DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_role ON agent_memory(agent_role);
CREATE INDEX IF NOT EXISTS idx_agent_memory_created ON agent_memory(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memory_type ON agent_memory(agent_role, memory_type);
CREATE INDEX IF NOT EXISTS idx_agent_memory_expires ON agent_memory(expires_at) WHERE expires_at IS NOT NULL;

-- Agent reflections — self-assessment after each run
CREATE TABLE IF NOT EXISTS agent_reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  run_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  quality_score INT CHECK (quality_score >= 0 AND quality_score <= 100),
  what_went_well TEXT[] DEFAULT '{}',
  what_could_improve TEXT[] DEFAULT '{}',
  prompt_suggestions TEXT[] DEFAULT '{}',
  knowledge_gaps TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_reflections_role ON agent_reflections(agent_role);
CREATE INDEX IF NOT EXISTS idx_agent_reflections_created ON agent_reflections(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_reflections_score ON agent_reflections(agent_role, quality_score);
