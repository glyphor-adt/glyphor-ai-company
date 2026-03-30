BEGIN;

DO $$ BEGIN
  CREATE TYPE disclosure_level AS ENUM ('off', 'internal_only', 'all_communications');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS agent_disclosure_config (
  agent_id TEXT PRIMARY KEY REFERENCES company_agents(role) ON DELETE CASCADE,
  disclosure_level disclosure_level NOT NULL DEFAULT 'internal_only',
  email_signature_template TEXT,
  display_name_suffix TEXT,
  external_commitment_gate BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS disclosure_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  communication_type TEXT NOT NULL,
  recipient_type TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('injected', 'blocked', 'commitment_gate')),
  tool_name TEXT,
  reason TEXT,
  payload_preview JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disclosure_audit_log_created_at
  ON disclosure_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_disclosure_audit_log_filters
  ON disclosure_audit_log (agent_id, communication_type, event_type, created_at DESC);

INSERT INTO agent_disclosure_config
  (agent_id, disclosure_level, email_signature_template, display_name_suffix, external_commitment_gate, updated_at)
SELECT
  role,
  'internal_only'::disclosure_level,
  'This message was composed by {{agent_name}} ({{agent_role}}), an AI assistant operating on behalf of {{company_name}} using Glyphor''s Autonomous Development Teams platform.',
  ' (AI)',
  true,
  NOW()
FROM company_agents
WHERE role IS NOT NULL
ON CONFLICT (agent_id) DO NOTHING;

CREATE OR REPLACE FUNCTION sync_agent_disclosure_config_defaults()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO agent_disclosure_config
    (agent_id, disclosure_level, email_signature_template, display_name_suffix, external_commitment_gate, updated_at)
  VALUES
    (
      NEW.role,
      'internal_only',
      'This message was composed by {{agent_name}} ({{agent_role}}), an AI assistant operating on behalf of {{company_name}} using Glyphor''s Autonomous Development Teams platform.',
      ' (AI)',
      true,
      NOW()
    )
  ON CONFLICT (agent_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_company_agents_disclosure_defaults ON company_agents;

CREATE TRIGGER trg_company_agents_disclosure_defaults
AFTER INSERT ON company_agents
FOR EACH ROW
EXECUTE FUNCTION sync_agent_disclosure_config_defaults();

COMMIT;