-- Add Microsoft Teams integration columns to customer_tenants.
-- Mirrors the existing Slack columns so a single customer_tenants row
-- can represent a Slack workspace, a Teams workspace, or both.
--
-- teams_tenant_id + teams_team_id together form the unique key for a Teams install.

ALTER TABLE customer_tenants
  ADD COLUMN IF NOT EXISTS teams_tenant_id       TEXT,
  ADD COLUMN IF NOT EXISTS teams_team_id         TEXT,
  ADD COLUMN IF NOT EXISTS teams_installer_aad_id TEXT,
  ADD COLUMN IF NOT EXISTS teams_service_url     TEXT,
  ADD COLUMN IF NOT EXISTS teams_conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS platform              TEXT NOT NULL DEFAULT 'slack'
    CHECK (platform IN ('slack', 'teams', 'both'));

-- Allow Teams-only rows (slack columns are nullable for Teams installs)
-- but ensure at least one platform identifier is present.
ALTER TABLE customer_tenants
  ALTER COLUMN slack_team_id DROP NOT NULL,
  ALTER COLUMN slack_team_name DROP NOT NULL,
  ALTER COLUMN bot_token DROP NOT NULL,
  ALTER COLUMN signing_secret DROP NOT NULL;

-- Unique constraint: one row per Teams tenant + team combination
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_tenants_teams
  ON customer_tenants (teams_tenant_id, teams_team_id)
  WHERE teams_tenant_id IS NOT NULL;

-- Lookup index
CREATE INDEX IF NOT EXISTS idx_customer_tenants_teams_tenant
  ON customer_tenants (teams_tenant_id)
  WHERE teams_tenant_id IS NOT NULL;

-- Ensure existing Slack rows keep their platform tag
UPDATE customer_tenants SET platform = 'slack' WHERE platform IS NULL;
