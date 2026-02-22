-- Autonomous Operations: Events table
-- Persistent event bus for inter-agent communication

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  payload JSONB DEFAULT '{}',
  priority TEXT DEFAULT 'normal',
  processed_by TEXT[] DEFAULT '{}',
  correlation_id UUID
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id) WHERE correlation_id IS NOT NULL;
