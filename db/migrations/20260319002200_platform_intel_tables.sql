-- Platform Intel persistence tables: actions log, reports, approval tokens

-- Actions log: everything Nexus does, autonomous or pending approval
CREATE TABLE IF NOT EXISTS platform_intel_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('autonomous', 'approval_required')),
  target_agent_id TEXT,
  description TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'executed', 'approved', 'rejected', 'failed')),
  teams_message_id TEXT,
  teams_conversation_id TEXT,
  executed_at TIMESTAMPTZ,
  approved_by TEXT,
  approval_response_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pia_status ON platform_intel_actions(status);
CREATE INDEX IF NOT EXISTS idx_pia_target_agent ON platform_intel_actions(target_agent_id);
CREATE INDEX IF NOT EXISTS idx_pia_created ON platform_intel_actions(created_at DESC);

-- Daily intel reports
CREATE TABLE IF NOT EXISTS platform_intel_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  gtm_status TEXT,
  agents_analyzed INTEGER,
  findings_count INTEGER,
  autonomous_actions_taken INTEGER,
  approval_requests_sent INTEGER,
  report_json JSONB NOT NULL,
  next_run_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pir_generated ON platform_intel_reports(generated_at DESC);

-- Approval webhook tokens (time-limited, single-use)
CREATE TABLE IF NOT EXISTS approval_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID NOT NULL REFERENCES platform_intel_actions(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',
  used_at TIMESTAMPTZ DEFAULT NULL
);
