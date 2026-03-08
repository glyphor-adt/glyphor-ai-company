-- Slack Customer Foundation
-- Customer-facing Slack operation: tenant workspaces, knowledge, and content
-- These tables power the slack-app package and future routing logic.

-- ─── customer_tenants ───────────────────────────────────────────────────────
-- One row per Slack workspace that has installed the Glyphor Slack app.
-- Linked to the core tenants table for billing/product context.
CREATE TABLE IF NOT EXISTS customer_tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slack_team_id   TEXT NOT NULL,
  slack_team_name TEXT NOT NULL,
  bot_user_id     TEXT,
  bot_token       TEXT NOT NULL,
  app_token       TEXT,
  signing_secret  TEXT NOT NULL,
  default_channel TEXT,
  scopes          TEXT[] DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'revoked')),
  installed_by    TEXT,
  settings        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (slack_team_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_tenants_tenant    ON customer_tenants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_tenants_team      ON customer_tenants(slack_team_id);
CREATE INDEX IF NOT EXISTS idx_customer_tenants_status    ON customer_tenants(status);

-- ─── customer_knowledge ─────────────────────────────────────────────────────
-- Tenant-scoped knowledge entries surfaced to customers via Slack.
-- Similar to company_knowledge_base but scoped to an external customer tenant.
CREATE TABLE IF NOT EXISTS customer_knowledge (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  section        TEXT NOT NULL,
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  content_type   TEXT NOT NULL DEFAULT 'text'
                   CHECK (content_type IN ('text', 'markdown', 'html', 'json')),
  audience       TEXT NOT NULL DEFAULT 'all',
  tags           TEXT[] DEFAULT '{}',
  is_active      BOOLEAN NOT NULL DEFAULT true,
  version        INT NOT NULL DEFAULT 1,
  last_edited_by TEXT NOT NULL DEFAULT 'system',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, section)
);

CREATE INDEX IF NOT EXISTS idx_customer_knowledge_tenant  ON customer_knowledge(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_knowledge_section ON customer_knowledge(tenant_id, section);
CREATE INDEX IF NOT EXISTS idx_customer_knowledge_active  ON customer_knowledge(tenant_id, is_active) WHERE is_active = true;

-- ─── customer_content ───────────────────────────────────────────────────────
-- Customer-submitted or agent-generated content artifacts linked to a Slack
-- tenant (e.g. uploaded files, processed documents, Slack thread summaries).
CREATE TABLE IF NOT EXISTS customer_content (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_tenant_id UUID REFERENCES customer_tenants(id) ON DELETE SET NULL,
  kind             TEXT NOT NULL
                     CHECK (kind IN ('file', 'thread_summary', 'document', 'snippet', 'faq', 'note')),
  title            TEXT,
  body             TEXT NOT NULL,
  source_url       TEXT,
  slack_channel_id TEXT,
  slack_message_ts TEXT,
  slack_file_id    TEXT,
  mime_type        TEXT,
  byte_size        BIGINT,
  submitted_by     TEXT,
  processed_at     TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'archived')),
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_content_tenant        ON customer_content(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_content_customer_tenant ON customer_content(customer_tenant_id);
CREATE INDEX IF NOT EXISTS idx_customer_content_kind          ON customer_content(tenant_id, kind);
CREATE INDEX IF NOT EXISTS idx_customer_content_status        ON customer_content(status) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS idx_customer_content_channel       ON customer_content(slack_channel_id) WHERE slack_channel_id IS NOT NULL;
