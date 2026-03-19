-- Fix company_research table: add columns expected by competitive-intel tools
-- The original schema used `name`, `content`, and `updated_at`, but
-- competitiveIntelTools.ts references `company_name`, `category`, `details`,
-- and `created_at`.  Add the missing columns and backfill from existing data.

ALTER TABLE company_research
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS category     TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS details      JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ DEFAULT NOW();

-- Backfill company_name from the existing `name` column
UPDATE company_research
SET company_name = name
WHERE company_name IS NULL;

-- Backfill details from the existing `content` column (both are JSONB)
UPDATE company_research
SET details = content;

-- Backfill created_at from the existing `updated_at` column
UPDATE company_research
SET created_at = updated_at
WHERE created_at IS NULL;

-- Make company_name NOT NULL now that it has been backfilled
ALTER TABLE company_research
  ALTER COLUMN company_name SET NOT NULL;

-- Index to speed up the ILIKE / equality lookups used by the tools
CREATE INDEX IF NOT EXISTS idx_company_research_company_name
  ON company_research (company_name);

CREATE INDEX IF NOT EXISTS idx_company_research_category
  ON company_research (category);
