BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kg_fact_source_type') THEN
    CREATE TYPE kg_fact_source_type AS ENUM ('human_input', 'mcp_tool', 'agent_output');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kg_contradiction_status') THEN
    CREATE TYPE kg_contradiction_status AS ENUM (
      'detected',
      'auto_resolved',
      'escalated_to_chief_of_staff',
      'escalated_to_human',
      'resolved_by_human',
      'dismissed'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kg_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  display_name TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, entity_key)
);

CREATE INDEX IF NOT EXISTS idx_kg_entities_type ON kg_entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_kg_entities_key ON kg_entities(entity_key);

CREATE TABLE IF NOT EXISTS kg_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  fact_key TEXT NOT NULL,
  fact_value JSONB NOT NULL,
  source_agent_id TEXT,
  source_type kg_fact_source_type NOT NULL DEFAULT 'agent_output',
  human_verified BOOLEAN NOT NULL DEFAULT FALSE,
  confidence NUMERIC NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  world_state_id UUID REFERENCES world_state(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kg_facts_entity_key ON kg_facts(entity_id, fact_key);
CREATE INDEX IF NOT EXISTS idx_kg_facts_open ON kg_facts(entity_id, fact_key, valid_until) WHERE valid_until IS NULL;
CREATE INDEX IF NOT EXISTS idx_kg_facts_source_agent ON kg_facts(source_agent_id);
CREATE INDEX IF NOT EXISTS idx_kg_facts_valid_from ON kg_facts(valid_from DESC);

CREATE TABLE IF NOT EXISTS kg_contradictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  fact_key TEXT NOT NULL,
  fact_a_id UUID NOT NULL REFERENCES kg_facts(id) ON DELETE CASCADE,
  fact_b_id UUID NOT NULL REFERENCES kg_facts(id) ON DELETE CASCADE,
  fact_a_value JSONB NOT NULL,
  fact_b_value JSONB NOT NULL,
  fact_a_agent_id TEXT,
  fact_b_agent_id TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status kg_contradiction_status NOT NULL DEFAULT 'detected',
  resolution_winner_fact_id UUID REFERENCES kg_facts(id) ON DELETE SET NULL,
  resolution_reason TEXT,
  provenance_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  CHECK (fact_a_id <> fact_b_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_contradictions_fact_pair
  ON kg_contradictions ((LEAST(fact_a_id, fact_b_id)), (GREATEST(fact_a_id, fact_b_id)));
CREATE INDEX IF NOT EXISTS idx_kg_contradictions_status ON kg_contradictions(status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_kg_contradictions_entity ON kg_contradictions(entity_id, fact_key);

CREATE TABLE IF NOT EXISTS decision_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contradiction_id UUID REFERENCES kg_contradictions(id) ON DELETE CASCADE,
  trace_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_traces_contradiction ON decision_traces(contradiction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_traces_type ON decision_traces(trace_type, created_at DESC);

INSERT INTO kg_entities (entity_type, entity_key, display_name, metadata)
SELECT DISTINCT
  ws.domain,
  COALESCE(ws.entity_id, '__global__'),
  NULLIF(ws.entity_id, ''),
  jsonb_build_object('backfilled_from', 'world_state')
FROM world_state ws
ON CONFLICT (entity_type, entity_key) DO UPDATE SET
  updated_at = NOW(),
  metadata = kg_entities.metadata || EXCLUDED.metadata;

INSERT INTO kg_facts (
  entity_id,
  fact_key,
  fact_value,
  source_agent_id,
  source_type,
  human_verified,
  confidence,
  valid_from,
  valid_until,
  world_state_id,
  metadata
)
SELECT
  ke.id,
  ws.key,
  ws.value,
  ws.written_by_agent,
  'agent_output'::kg_fact_source_type,
  FALSE,
  COALESCE(ws.confidence, 1.0),
  COALESCE(ws.updated_at, ws.created_at, NOW()),
  ws.valid_until,
  ws.id,
  jsonb_build_object('backfilled_from', 'world_state')
FROM world_state ws
JOIN kg_entities ke
  ON ke.entity_type = ws.domain
 AND ke.entity_key = COALESCE(ws.entity_id, '__global__')
WHERE NOT EXISTS (
  SELECT 1
  FROM kg_facts existing
  WHERE existing.world_state_id = ws.id
    AND existing.fact_key = ws.key
    AND existing.fact_value = ws.value
    AND existing.valid_until IS NOT DISTINCT FROM ws.valid_until
    AND existing.source_agent_id IS NOT DISTINCT FROM ws.written_by_agent
);

COMMIT;