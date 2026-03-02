-- ═══════════════════════════════════════════════════════════════════
-- Voice Usage Tracking Table
-- ═══════════════════════════════════════════════════════════════════
-- Tracks voice session usage for both dashboard and Teams modes.
-- Written by the voice gateway when a session ends.

CREATE TABLE IF NOT EXISTS voice_usage (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id    TEXT        NOT NULL,
  agent_role    TEXT        NOT NULL,
  mode          TEXT        NOT NULL CHECK (mode IN ('dashboard', 'teams')),
  duration_sec  INTEGER     NOT NULL DEFAULT 0,
  estimated_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  user_id       TEXT        NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_voice_usage_agent ON voice_usage (agent_role);
CREATE INDEX idx_voice_usage_user ON voice_usage (user_id);
CREATE INDEX idx_voice_usage_started ON voice_usage (started_at);

-- Grant access to the app role
GRANT SELECT, INSERT ON voice_usage TO glyphor_app;
