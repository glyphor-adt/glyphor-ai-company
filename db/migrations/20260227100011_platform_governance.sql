-- Platform Governance: IAM state tracking + platform-level audit log
-- Tracks actual vs desired platform permissions and logs all external API calls

-- ═══════════════════════════════════════════════════════
-- 1. Platform IAM State — tracks actual vs desired perms
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS platform_iam_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('gcp', 'm365', 'github', 'stripe', 'vercel')),
  credential_id TEXT NOT NULL,
  agent_role TEXT,

  -- Actual permissions (synced from platform)
  permissions JSONB NOT NULL DEFAULT '{}',

  -- Desired permissions (from governance config)
  desired_permissions JSONB,

  -- Drift detection
  in_sync BOOLEAN DEFAULT true,
  drift_details TEXT,
  last_synced TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(platform, credential_id)
);

ALTER TABLE platform_iam_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_dashboard_read_iam" ON platform_iam_state
  FOR SELECT USING (true);

-- ═══════════════════════════════════════════════════════
-- 2. Platform Audit Log — traces every external API call
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS platform_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  platform TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT,
  request_payload JSONB,
  response_code INT,
  response_summary TEXT,
  cost_estimate REAL,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_platform_audit_agent ON platform_audit_log(agent_role);
CREATE INDEX idx_platform_audit_platform ON platform_audit_log(platform);
CREATE INDEX idx_platform_audit_ts ON platform_audit_log(timestamp DESC);

ALTER TABLE platform_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_dashboard_read_audit" ON platform_audit_log
  FOR SELECT USING (true);
CREATE POLICY "allow_runtime_insert_audit" ON platform_audit_log
  FOR INSERT WITH CHECK (true);

-- ═══════════════════════════════════════════════════════
-- 3. Secret Rotation Tracking
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS platform_secret_rotation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  secret_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expiring', 'expired', 'rotated')),

  UNIQUE(platform, secret_name)
);

ALTER TABLE platform_secret_rotation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_dashboard_read_secrets" ON platform_secret_rotation
  FOR SELECT USING (true);

-- ═══════════════════════════════════════════════════════
-- 4. Seed IAM state with current service accounts
-- ═══════════════════════════════════════════════════════

INSERT INTO platform_iam_state (platform, credential_id, agent_role, permissions, desired_permissions, in_sync) VALUES
  -- GCP Service Accounts
  ('gcp', 'sa-marcus@ai-glyphor-company.iam.gserviceaccount.com', 'cto',
   '{"roles": ["roles/run.admin", "roles/pubsub.admin", "roles/secretmanager.secretAccessor", "roles/storage.objectAdmin"]}',
   '{"roles": ["roles/run.developer", "roles/pubsub.publisher", "roles/pubsub.subscriber", "roles/secretmanager.secretAccessor", "roles/storage.objectAdmin"]}',
   false),
  ('gcp', 'sa-nadia@ai-glyphor-company.iam.gserviceaccount.com', 'cfo',
   '{"roles": ["roles/bigquery.dataViewer", "roles/billing.viewer", "roles/secretmanager.secretAccessor"]}',
   '{"roles": ["roles/bigquery.dataViewer", "roles/billing.viewer", "roles/secretmanager.secretAccessor"]}',
   true),
  ('gcp', 'sa-alex@ai-glyphor-company.iam.gserviceaccount.com', 'platform-engineer',
   '{"roles": ["roles/run.viewer", "roles/monitoring.viewer"]}',
   '{"roles": ["roles/run.viewer", "roles/monitoring.viewer"]}',
   true),
  ('gcp', 'sa-jordan@ai-glyphor-company.iam.gserviceaccount.com', 'devops-engineer',
   '{"roles": ["roles/run.viewer", "roles/cloudbuild.builds.viewer", "cloudrunStagingDeploy"]}',
   '{"roles": ["roles/run.viewer", "roles/cloudbuild.builds.viewer", "cloudrunStagingDeploy"]}',
   true),
  ('gcp', 'sa-omar@ai-glyphor-company.iam.gserviceaccount.com', 'cost-analyst',
   '{"roles": ["roles/billing.viewer", "roles/bigquery.dataViewer", "roles/secretmanager.secretAccessor"]}',
   '{"roles": ["roles/billing.viewer", "roles/bigquery.dataViewer", "roles/secretmanager.secretAccessor"]}',
   true),
  ('gcp', 'sa-elena@ai-glyphor-company.iam.gserviceaccount.com', 'cpo',
   '{"roles": ["roles/secretmanager.secretAccessor"]}',
   '{"roles": ["roles/secretmanager.secretAccessor"]}',
   true),
  ('gcp', 'sa-maya@ai-glyphor-company.iam.gserviceaccount.com', 'cmo',
   '{"roles": ["roles/secretmanager.secretAccessor"]}',
   '{"roles": ["roles/secretmanager.secretAccessor"]}',
   true),
  ('gcp', 'sa-rachel@ai-glyphor-company.iam.gserviceaccount.com', 'vp-sales',
   '{"roles": ["roles/secretmanager.secretAccessor"]}',
   '{"roles": ["roles/secretmanager.secretAccessor"]}',
   true),
  ('gcp', 'sa-mia@ai-glyphor-company.iam.gserviceaccount.com', 'vp-design',
   '{"roles": ["roles/secretmanager.secretAccessor"]}',
   '{"roles": ["roles/secretmanager.secretAccessor"]}',
   true),
  ('gcp', 'sa-sarah@ai-glyphor-company.iam.gserviceaccount.com', 'chief-of-staff',
   '{"roles": ["roles/secretmanager.secretAccessor"]}',
   '{"roles": ["roles/secretmanager.secretAccessor"]}',
   true),
  ('gcp', 'sa-production-deploy@ai-glyphor-company.iam.gserviceaccount.com', NULL,
   '{"roles": ["roles/run.admin"]}',
   '{"roles": ["roles/run.admin"]}',
   true),

  -- M365 / Entra ID App Registrations
  ('m365', 'glyphor-teams-channels', NULL,
   '{"scopes": ["ChannelMessage.Send"]}',
   '{"scopes": ["ChannelMessage.Send"]}',
   true),
  ('m365', 'glyphor-teams-bot', NULL,
   '{"scopes": ["Bot Framework"]}',
   '{"scopes": ["Bot Framework"]}',
   true),
  ('m365', 'glyphor-mail', NULL,
   '{"scopes": ["Mail.Send"]}',
   '{"scopes": ["Mail.Send"]}',
   true),
  ('m365', 'glyphor-files', NULL,
   '{"scopes": ["Sites.Selected"]}',
   '{"scopes": ["Sites.Selected"]}',
   true),
  ('m365', 'glyphor-users', NULL,
   '{"scopes": ["User.Read.All"]}',
   '{"scopes": ["User.Read.All"]}',
   true),

  -- GitHub
  ('github', 'glyphor-bot', 'cto',
   '{"repos": ["web-build", "pulse", "agent-runtime", "infra"], "permissions": {"contents": "write", "pull_requests": "write", "actions": "write", "deployments": "write"}}',
   '{"repos": ["web-build", "pulse", "agent-runtime", "infra"], "permissions": {"contents": "write", "pull_requests": "write", "actions": "write", "deployments": "write"}}',
   true),

  -- Stripe
  ('stripe', 'restricted-key-finance', 'cfo',
   '{"resources": ["subscriptions:read", "invoices:read", "charges:read", "balance:read", "payouts:read"]}',
   '{"resources": ["subscriptions:read", "invoices:read", "charges:read", "balance:read", "payouts:read"]}',
   true),
  ('stripe', 'restricted-key-reporting', NULL,
   '{"resources": ["subscriptions:read", "balance:read"]}',
   '{"resources": ["subscriptions:read", "balance:read"]}',
   true),
  ('stripe', 'restricted-key-cs', NULL,
   '{"resources": ["customers:read", "subscriptions:read"]}',
   '{"resources": ["customers:read", "subscriptions:read"]}',
   true),

  -- Vercel
  ('vercel', 'token-deploy', 'cto',
   '{"scopes": ["deployments.*", "projects.*", "domains.*"]}',
   '{"scopes": ["deployments.*", "projects.*", "domains.*"]}',
   true),
  ('vercel', 'token-monitoring', NULL,
   '{"scopes": ["deployments.list", "logs.read", "analytics.read"]}',
   '{"scopes": ["deployments.list", "logs.read", "analytics.read"]}',
   true),
  ('vercel', 'token-billing', NULL,
   '{"scopes": ["billing.read", "usage.read"]}',
   '{"scopes": ["billing.read", "usage.read"]}',
   true)
ON CONFLICT (platform, credential_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════
-- 5. Seed secret rotation tracking
-- ═══════════════════════════════════════════════════════

INSERT INTO platform_secret_rotation (platform, secret_name, created_at, expires_at, status) VALUES
  ('m365', 'azure/teams-channel-client-secret', '2026-01-15', '2027-01-15', 'active'),
  ('m365', 'azure/files-client-secret', '2026-02-20', '2027-02-20', 'active'),
  ('stripe', 'stripe/restricted-key-finance', '2025-11-01', NULL, 'active'),
  ('stripe', 'stripe/restricted-key-reporting', '2025-11-01', NULL, 'active'),
  ('stripe', 'stripe/restricted-key-cs', '2025-11-01', NULL, 'active'),
  ('github', 'github/app-private-key', '2025-12-01', NULL, 'active'),
  ('vercel', 'vercel/token-deploy', '2026-01-01', '2026-07-01', 'expiring'),
  ('vercel', 'vercel/token-monitoring', '2026-01-01', '2026-07-01', 'expiring'),
  ('vercel', 'vercel/token-billing', '2026-01-01', '2026-07-01', 'expiring'),
  ('gcp', 'google-ai-api-key', '2025-10-15', NULL, 'active')
ON CONFLICT (platform, secret_name) DO NOTHING;
