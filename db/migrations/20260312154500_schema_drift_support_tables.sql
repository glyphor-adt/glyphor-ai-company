-- Schema drift repair: add tables referenced by runtime and agent tools.
-- These objects are used by workflow waiting, design collaboration, social
-- trend caching, and product analytics, but were not yet defined in migrations.

CREATE TABLE IF NOT EXISTS design_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  variant TEXT,
  author TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_design_artifacts_type ON design_artifacts(type);
CREATE INDEX IF NOT EXISTS idx_design_artifacts_name ON design_artifacts(name);
CREATE INDEX IF NOT EXISTS idx_design_artifacts_status ON design_artifacts(status);
CREATE INDEX IF NOT EXISTS idx_design_artifacts_created_at ON design_artifacts(created_at DESC);

CREATE TABLE IF NOT EXISTS trending_topics_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  topics TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trending_topics_cache_category_fetched
  ON trending_topics_cache(category, fetched_at DESC);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  name TEXT,
  plan TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL UNIQUE,
  received BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_signals_reference ON webhook_signals(reference);
CREATE INDEX IF NOT EXISTS idx_webhook_signals_received ON webhook_signals(received, created_at DESC);
