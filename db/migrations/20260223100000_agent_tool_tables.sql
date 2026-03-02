-- Agent Tool Tables — All sub-team agent data tables
-- These tables are referenced by agent tools but were missing from the schema.
-- They start empty; data is populated by external sync jobs or agent writes.

-- ─── Shared: agent activity log (many agents write here) ────────────────────
CREATE TABLE IF NOT EXISTS agent_activities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role  TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  summary     TEXT NOT NULL,
  details     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_activities_role    ON agent_activities(agent_role);
CREATE INDEX IF NOT EXISTS idx_agent_activities_created ON agent_activities(created_at DESC);

-- ─── Content Creator (Tyler Reed) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_drafts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT NOT NULL,          -- blog_post, social_post, case_study, email
  title           TEXT,
  content         TEXT NOT NULL,
  platform        TEXT,                   -- twitter, linkedin, threads (social only)
  tags            TEXT,
  meta_description TEXT,
  media_url       TEXT,
  campaign_type   TEXT,
  status          TEXT DEFAULT 'draft',   -- draft, approved, published, rejected
  author          TEXT DEFAULT 'content-creator',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_content_drafts_type    ON content_drafts(type);
CREATE INDEX IF NOT EXISTS idx_content_drafts_status  ON content_drafts(status);
CREATE INDEX IF NOT EXISTS idx_content_drafts_created ON content_drafts(created_at DESC);

CREATE TABLE IF NOT EXISTS content_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type    TEXT NOT NULL,          -- blog, social, email
  title           TEXT,
  url             TEXT,
  platform        TEXT,
  views           INT DEFAULT 0,
  shares          INT DEFAULT 0,
  engagement      DECIMAL(6,2) DEFAULT 0,
  conversions     INT DEFAULT 0,
  clicks          INT DEFAULT 0,
  recorded_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_content_metrics_type    ON content_metrics(content_type);
CREATE INDEX IF NOT EXISTS idx_content_metrics_views   ON content_metrics(views DESC);
CREATE INDEX IF NOT EXISTS idx_content_metrics_recorded ON content_metrics(recorded_at DESC);

-- ─── SEO Analyst (Lisa Chen) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS seo_data (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_type     TEXT NOT NULL,          -- ranking, keyword_research, keyword_discovery,
                                          -- competitor_ranking, backlinks, search_console, content_audit
  keyword         TEXT,
  url             TEXT,
  position        INT,
  search_volume   INT,
  difficulty      DECIMAL(5,2),
  cpc             DECIMAL(8,2),
  clicks          INT,
  impressions     INT,
  ctr             DECIMAL(6,4),
  competitor_domain TEXT,
  seed_topic      TEXT,
  link_type       TEXT,                   -- new, lost (backlinks)
  dimension       TEXT,                   -- query, page, device, country (search_console)
  content         JSONB,                  -- flexible extra data
  recorded_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_seo_data_type     ON seo_data(metric_type);
CREATE INDEX IF NOT EXISTS idx_seo_data_keyword  ON seo_data(keyword);
CREATE INDEX IF NOT EXISTS idx_seo_data_recorded ON seo_data(recorded_at DESC);

-- ─── Social Media Manager (Kai Johnson) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  TEXT NOT NULL,
  text        TEXT NOT NULL,
  platform    TEXT,
  scheduled_at TIMESTAMPTZ,
  media_url   TEXT,
  status      TEXT DEFAULT 'queued',      -- queued, published, failed, cancelled
  buffer_id   TEXT,                       -- Buffer post ID after scheduling
  agent       TEXT DEFAULT 'social-media-manager',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status  ON scheduled_posts(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_created ON scheduled_posts(created_at DESC);

CREATE TABLE IF NOT EXISTS social_metrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_type   TEXT NOT NULL,            -- aggregate, post_performance, optimal_times,
                                          -- demographics, mention
  platform      TEXT NOT NULL,            -- twitter, linkedin, threads
  followers     INT,
  engagement    DECIMAL(6,2),
  reach         INT,
  impressions   INT,
  clicks        INT,
  content       TEXT,                     -- post text / mention content
  post_url      TEXT,
  demographics  JSONB,
  recorded_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_social_metrics_type     ON social_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_social_metrics_platform ON social_metrics(platform);
CREATE INDEX IF NOT EXISTS idx_social_metrics_recorded ON social_metrics(recorded_at DESC);

-- ─── Support Triage (David Santos) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id     TEXT UNIQUE,            -- Intercom conversation ID
  subject         TEXT,
  body            TEXT,
  status          TEXT DEFAULT 'open',    -- open, closed, snoozed, escalated
  priority        TEXT,                   -- p0, p1, p2, p3
  category        TEXT,                   -- billing, technical, account, feature_request, bug
  customer_email  TEXT,
  customer_name   TEXT,
  classified_by   TEXT,
  classified_at   TIMESTAMPTZ,
  escalated_to    TEXT,
  escalation_reason TEXT,
  escalated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status   ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON support_tickets(priority);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created  ON support_tickets(created_at DESC);

CREATE TABLE IF NOT EXISTS support_responses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID REFERENCES support_tickets(id),
  message     TEXT NOT NULL,
  kb_articles TEXT,
  status      TEXT DEFAULT 'draft',       -- draft, sent, rejected
  author      TEXT DEFAULT 'support-triage',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_responses_ticket ON support_responses(ticket_id);

CREATE TABLE IF NOT EXISTS knowledge_base (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  category    TEXT,
  tags        TEXT[],
  views       INT DEFAULT 0,
  helpful     INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_category ON knowledge_base(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_views    ON knowledge_base(views DESC);

-- ─── Onboarding Specialist (Emma Wright) + User Researcher (Priya Sharma) ───
CREATE TABLE IF NOT EXISTS analytics_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID,
  event_type  TEXT NOT NULL,              -- signup, profile_complete, first_build, activated,
                                          -- onboarding_drop_off, template_used, etc.
  channel     TEXT,                       -- acquisition channel
  plan        TEXT,
  template_id TEXT,
  properties  JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type    ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user    ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at DESC);

CREATE TABLE IF NOT EXISTS email_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_type   TEXT NOT NULL,          -- onboarding, feature_launch, re_engagement, newsletter
  template_name   TEXT,
  subject         TEXT,
  sends           INT DEFAULT 0,
  opens           INT DEFAULT 0,
  clicks          INT DEFAULT 0,
  unsubscribes    INT DEFAULT 0,
  bounces         INT DEFAULT 0,
  open_rate       DECIMAL(6,4),
  click_rate      DECIMAL(6,4),
  recorded_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_metrics_campaign  ON email_metrics(campaign_type);
CREATE INDEX IF NOT EXISTS idx_email_metrics_recorded  ON email_metrics(recorded_at DESC);

CREATE TABLE IF NOT EXISTS experiment_designs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent               TEXT NOT NULL,
  hypothesis          TEXT NOT NULL,
  variant_description TEXT NOT NULL,
  primary_metric      TEXT NOT NULL,
  duration            TEXT,
  status              TEXT DEFAULT 'proposed', -- proposed, approved, running, completed, rejected
  results             JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_experiment_designs_status  ON experiment_designs(status);
CREATE INDEX IF NOT EXISTS idx_experiment_designs_created ON experiment_designs(created_at DESC);

-- ─── Account Research (Nathan Cole) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_research (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  domain      TEXT,
  source      TEXT NOT NULL,             -- crunchbase, wappalyzer, jobs, apollo
  content     JSONB DEFAULT '{}',        -- flexible payload per source
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_company_research_name   ON company_research(name);
CREATE INDEX IF NOT EXISTS idx_company_research_domain ON company_research(domain);
CREATE INDEX IF NOT EXISTS idx_company_research_source ON company_research(source);

CREATE TABLE IF NOT EXISTS contact_research (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company     TEXT NOT NULL,
  name        TEXT,
  title       TEXT,
  email       TEXT,
  linkedin    TEXT,
  source      TEXT DEFAULT 'apollo',
  content     JSONB DEFAULT '{}',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_research_company ON contact_research(company);
CREATE INDEX IF NOT EXISTS idx_contact_research_title   ON contact_research(title);

CREATE TABLE IF NOT EXISTS account_dossiers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company             TEXT NOT NULL,
  domain              TEXT,
  summary             TEXT NOT NULL,
  opportunity_estimate TEXT,
  buying_signals      TEXT,
  compiled_by         TEXT DEFAULT 'account-research',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_account_dossiers_company ON account_dossiers(company);
CREATE INDEX IF NOT EXISTS idx_account_dossiers_created ON account_dossiers(created_at DESC);

-- ─── Cost Analyst (Omar Hassan) + DevOps (Jordan Hayes) ─────────────────────
CREATE TABLE IF NOT EXISTS gcp_billing (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service     TEXT NOT NULL,             -- cloud-run, cloud-storage, gemini, etc.
  cost_usd    DECIMAL(10,4) NOT NULL,
  usage       JSONB DEFAULT '{}',        -- units, requests, etc.
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gcp_billing_service  ON gcp_billing(service);
CREATE INDEX IF NOT EXISTS idx_gcp_billing_recorded ON gcp_billing(recorded_at DESC);

CREATE TABLE IF NOT EXISTS infrastructure_metrics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    TEXT NOT NULL,             -- gcp, supabase, vercel
  service     TEXT NOT NULL,
  metric_type TEXT NOT NULL,             -- utilization, latency, requests, errors, cache_hit_rate
  value       DECIMAL(12,4) NOT NULL,
  unit        TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_infra_metrics_provider ON infrastructure_metrics(provider);
CREATE INDEX IF NOT EXISTS idx_infra_metrics_type     ON infrastructure_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_infra_metrics_recorded ON infrastructure_metrics(recorded_at DESC);

CREATE TABLE IF NOT EXISTS cost_metrics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_type   TEXT NOT NULL,             -- per_build, per_api_call, per_user, per_agent_run
  cost_usd    DECIMAL(10,6) NOT NULL,
  volume      INT,
  period      TEXT,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cost_metrics_unit     ON cost_metrics(unit_type);
CREATE INDEX IF NOT EXISTS idx_cost_metrics_recorded ON cost_metrics(recorded_at DESC);

-- ─── Revenue Analyst (Anna Park) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stripe_data (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type     TEXT NOT NULL,          -- subscription, charge, refund, mrr_snapshot,
                                          -- cohort, attribution
  customer_id     TEXT,
  product         TEXT,
  plan            TEXT,
  amount_usd      DECIMAL(10,2),
  status          TEXT,
  cohort_month    TEXT,                   -- YYYY-MM for cohort analysis
  channel         TEXT,                   -- acquisition channel for attribution
  properties      JSONB DEFAULT '{}',
  recorded_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stripe_data_type     ON stripe_data(record_type);
CREATE INDEX IF NOT EXISTS idx_stripe_data_product  ON stripe_data(product);
CREATE INDEX IF NOT EXISTS idx_stripe_data_recorded ON stripe_data(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_data_cohort   ON stripe_data(cohort_month);
