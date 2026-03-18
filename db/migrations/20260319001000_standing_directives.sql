-- ============================================================
-- STANDING DIRECTIVES — Permanent, never-completing
-- ============================================================
-- These exist to ensure the proactive directive gate always passes.
-- They are tagged source='standing' so the work loop can distinguish
-- them from regular founder directives.

-- 1. Expand the source CHECK constraint to include 'standing'
ALTER TABLE founder_directives
  DROP CONSTRAINT IF EXISTS founder_directives_source_check;

ALTER TABLE founder_directives
  ADD CONSTRAINT founder_directives_source_check
  CHECK (source IN ('founder', 'agent_proposed', 'initiative_derived', 'external_a2a', 'standing'));

-- 2. Insert 9 standing directives covering all departments
INSERT INTO founder_directives
  (title, description, priority, category, status, created_by, source, target_agents)
VALUES
  -- Engineering
  (
    'Standing: Engineering Health & Reliability',
    'Continuous mandate: Monitor platform health, investigate degradation, '
    'maintain CI/CD pipeline reliability, ensure infrastructure cost efficiency, '
    'and proactively identify technical debt. This is a standing directive — '
    'do not mark complete.',
    'medium',
    'engineering',
    'active',
    'system',
    'standing',
    ARRAY['cto', 'platform-engineer', 'quality-engineer', 'devops-engineer']
  ),
  -- Product
  (
    'Standing: Product Intelligence & User Research',
    'Continuous mandate: Monitor competitive landscape, track product usage '
    'patterns, maintain user research pipeline, update roadmap priorities '
    'based on market signals. This is a standing directive — do not mark complete.',
    'medium',
    'product',
    'active',
    'system',
    'standing',
    ARRAY['cpo', 'user-researcher', 'competitive-intel']
  ),
  -- Marketing
  (
    'Standing: Content & Growth Operations',
    'Continuous mandate: Execute content calendar, monitor SEO performance, '
    'manage social media presence, track brand consistency, identify growth '
    'opportunities. This is a standing directive — do not mark complete.',
    'medium',
    'marketing',
    'active',
    'system',
    'standing',
    ARRAY['cmo', 'content-creator', 'seo-analyst', 'social-media-manager']
  ),
  -- Finance
  (
    'Standing: Financial Monitoring & Cost Optimization',
    'Continuous mandate: Monitor infrastructure costs, track AI API spend, '
    'identify cost anomalies, maintain financial reporting cadence, flag '
    'budget concerns. This is a standing directive — do not mark complete.',
    'medium',
    'revenue',
    'active',
    'system',
    'standing',
    ARRAY['cfo']
  ),
  -- Research & Intelligence
  (
    'Standing: Market & Competitive Research',
    'Continuous mandate: Monitor competitor movements, track market trends, '
    'maintain research repository freshness, produce weekly intelligence '
    'summaries. This is a standing directive — do not mark complete.',
    'medium',
    'general',
    'active',
    'system',
    'standing',
    ARRAY['vp-research', 'competitive-research-analyst', 'market-research-analyst']
  ),
  -- Design & Frontend
  (
    'Standing: Design System & Quality Assurance',
    'Continuous mandate: Maintain design system consistency, audit UI quality, '
    'review component library, ensure brand alignment across all surfaces. '
    'This is a standing directive — do not mark complete.',
    'medium',
    'design',
    'active',
    'system',
    'standing',
    ARRAY['vp-design', 'ui-ux-designer', 'frontend-engineer', 'design-critic', 'template-architect']
  ),
  -- Legal
  (
    'Standing: Compliance & IP Protection',
    'Continuous mandate: Monitor regulatory changes, review compliance posture, '
    'track IP portfolio status, flag emerging legal risks. '
    'This is a standing directive — do not mark complete.',
    'medium',
    'general',
    'active',
    'system',
    'standing',
    ARRAY['clo']
  ),
  -- Operations
  (
    'Standing: Operational Excellence & System Health',
    'Continuous mandate: Monitor agent fleet health, track data pipeline '
    'freshness, investigate system anomalies, maintain operational dashboards, '
    'coordinate cross-team operational issues. '
    'This is a standing directive — do not mark complete.',
    'medium',
    'operations',
    'active',
    'system',
    'standing',
    ARRAY['ops', 'global-admin', 'm365-admin']
  ),
  -- Sales
  (
    'Standing: Pipeline & Market Development',
    'Continuous mandate: Research target accounts, monitor market sizing data, '
    'maintain prospect pipeline, track competitive positioning for sales use cases. '
    'This is a standing directive — do not mark complete.',
    'medium',
    'sales',
    'active',
    'system',
    'standing',
    ARRAY['vp-sales']
  )
ON CONFLICT DO NOTHING;

-- 3. Add a completion guard trigger — standing directives can never be completed
CREATE OR REPLACE FUNCTION prevent_standing_directive_completion()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.source = 'standing' AND NEW.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot complete or cancel a standing directive (source=standing). '
      'Standing directives are permanent operational mandates.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guard_standing_directives ON founder_directives;
CREATE TRIGGER guard_standing_directives
  BEFORE UPDATE ON founder_directives
  FOR EACH ROW
  WHEN (OLD.source = 'standing')
  EXECUTE FUNCTION prevent_standing_directive_completion();

-- 4. Create system_config table for emergency overrides
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- 5. Index for fast standing directive lookups
CREATE INDEX IF NOT EXISTS idx_directives_standing
  ON founder_directives(source, status)
  WHERE source = 'standing' AND status = 'active';
