-- ═══════════════════════════════════════════════════════════════
-- Agent Wake Queue — Queued reactive wakes for heartbeat pickup
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_wake_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  task TEXT NOT NULL,
  reason TEXT NOT NULL,
  context JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'dispatched', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at TIMESTAMPTZ
);

-- Index for heartbeat polling: find pending wakes per agent
CREATE INDEX IF NOT EXISTS idx_wake_queue_pending
  ON agent_wake_queue(agent_role, status)
  WHERE status = 'pending';

-- Index for cleanup: find old dispatched/completed entries
CREATE INDEX IF NOT EXISTS idx_wake_queue_created
  ON agent_wake_queue(created_at DESC);
