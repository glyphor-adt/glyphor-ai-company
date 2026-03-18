-- World State: Persistent, cross-agent knowledge store.
-- Agents read at task start, write on task completion.
-- Replaces hub-and-spoke context routing via Chief of Staff.

CREATE TABLE IF NOT EXISTS world_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'system',
  domain TEXT NOT NULL,           -- 'customer' | 'campaign' | 'strategy' | 'agent_output' | 'market'
  entity_id TEXT,                 -- customer_id, campaign_id, etc. NULL = global domain state
  key TEXT NOT NULL,              -- e.g. 'active_campaigns', 'customer_segment', 'brand_voice'
  value JSONB NOT NULL,
  written_by_agent TEXT,
  confidence NUMERIC DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  valid_until TIMESTAMPTZ DEFAULT NULL,  -- NULL = no expiry
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index using COALESCE for NULL entity_id support
CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_unique_key
  ON world_state(tenant_id, domain, COALESCE(entity_id, '__global__'), key);

CREATE INDEX IF NOT EXISTS idx_ws_domain_entity ON world_state(domain, entity_id);
CREATE INDEX IF NOT EXISTS idx_ws_updated_at ON world_state(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ws_valid_until ON world_state(valid_until) WHERE valid_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ws_tenant ON world_state(tenant_id);

-- Track write history (world_state itself is current state only)
CREATE TABLE IF NOT EXISTS world_state_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT 'system',
  world_state_id UUID REFERENCES world_state(id) ON DELETE CASCADE,
  previous_value JSONB,
  new_value JSONB,
  written_by_agent TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wsh_world_state ON world_state_history(world_state_id);
CREATE INDEX IF NOT EXISTS idx_wsh_changed_at ON world_state_history(changed_at DESC);

-- Auto-record history on UPDATE via trigger
CREATE OR REPLACE FUNCTION world_state_history_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.value IS DISTINCT FROM NEW.value THEN
    INSERT INTO world_state_history (tenant_id, world_state_id, previous_value, new_value, written_by_agent)
    VALUES (OLD.tenant_id, OLD.id, OLD.value, NEW.value, NEW.written_by_agent);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_world_state_history ON world_state;
CREATE TRIGGER trg_world_state_history
  BEFORE UPDATE ON world_state
  FOR EACH ROW
  EXECUTE FUNCTION world_state_history_trigger();
