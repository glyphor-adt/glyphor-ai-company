-- Standing objectives for objective-driven autonomous work
-- Uses tenant_id to match the repository's multi-tenant pattern.

CREATE TABLE IF NOT EXISTS standing_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  objective TEXT NOT NULL,
  success_metric TEXT NOT NULL,
  check_frequency INTERVAL NOT NULL DEFAULT INTERVAL '4 hours',
  last_checked_at TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id),
  CONSTRAINT standing_objectives_agent_role_objective_key UNIQUE (tenant_id, agent_role, objective)
);

CREATE INDEX IF NOT EXISTS idx_standing_objectives_role ON standing_objectives(tenant_id, agent_role);
CREATE INDEX IF NOT EXISTS idx_standing_objectives_active ON standing_objectives(tenant_id, active) WHERE active = true;

ALTER TABLE standing_objectives ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'standing_objectives'
      AND policyname = 'tenant_isolation_standing_objectives'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY tenant_isolation_standing_objectives ON standing_objectives
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'standing_objectives'
      AND policyname = 'system_bypass_standing_objectives'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY system_bypass_standing_objectives ON standing_objectives
        TO glyphor_system USING (true) WITH CHECK (true)
    $policy$;
  END IF;
END
$$;

INSERT INTO standing_objectives (agent_role, objective, success_metric, check_frequency, priority)
VALUES
  ('cmo', 'Maintain a 2-week content pipeline with scheduled posts', 'Scheduled posts count > 10 for next 14 days', INTERVAL '6 hours', 'high'),
  ('cmo', 'Monitor brand mentions and competitor announcements', 'All brand mentions < 4 hours old have been reviewed', INTERVAL '2 hours', 'medium'),
  ('cmo', 'Keep social media engagement metrics trending up', 'Week-over-week engagement rate is stable or improving', INTERVAL '12 hours', 'medium'),
  ('cto', 'Keep all services healthy and deployed', 'Zero unresolved health check failures across all Cloud Run services', INTERVAL '2 hours', 'critical'),
  ('cto', 'Monitor CI/CD pipeline success rate', 'GitHub Actions success rate > 95% for last 24 hours', INTERVAL '4 hours', 'high'),
  ('cto', 'Track model provider latency and error rates', 'No provider error rate > 5% for last 6 hours', INTERVAL '4 hours', 'high'),
  ('cfo', 'Flag cost anomalies before they compound', 'No unreviewed spend spike > 20% persisting for > 6 hours', INTERVAL '4 hours', 'critical'),
  ('cfo', 'Track burn rate against monthly budget', 'Monthly spend projection is within 10% of budget', INTERVAL '8 hours', 'high'),
  ('cfo', 'Monitor revenue pipeline health', 'MRR, churn, and expansion metrics are current (< 24h old)', INTERVAL '12 hours', 'medium'),
  ('cpo', 'Track competitor feature launches and positioning changes', 'Competitor changelog reviewed within past 7 days', INTERVAL '24 hours', 'high'),
  ('cpo', 'Monitor product usage patterns for insights', 'Usage analysis completed within past 48 hours', INTERVAL '24 hours', 'medium'),
  ('vp-sales', 'Enrich pipeline with fresh account research', 'All active leads have research updated within 7 days', INTERVAL '12 hours', 'high'),
  ('vp-sales', 'Monitor enterprise prospect signals', 'Prospect monitoring report delivered within past 48 hours', INTERVAL '24 hours', 'medium'),
  ('vp-customer-success', 'Proactive churn risk outreach', 'All at-risk accounts (health score < 50) contacted within 48 hours', INTERVAL '8 hours', 'critical'),
  ('vp-customer-success', 'Track customer health scores', 'All active customer health scores refreshed within past 24 hours', INTERVAL '12 hours', 'high'),
  ('vp-design', 'Audit live pages against design system', 'Zero unresolved design drift findings older than 72 hours', INTERVAL '24 hours', 'medium'),
  ('vp-design', 'Review component quality and consistency', 'Design system compliance check completed within past 7 days', INTERVAL '48 hours', 'medium'),
  ('vp-research', 'Maintain current intelligence on key competitors', 'Competitive intelligence brief refreshed within past 7 days', INTERVAL '24 hours', 'high'),
  ('vp-research', 'Track emerging AI industry trends', 'Industry trend scan completed within past 14 days', INTERVAL '48 hours', 'medium'),
  ('chief-of-staff', 'Ensure all active directives are progressing', 'No directive has all assignments stalled for > 12 hours', INTERVAL '2 hours', 'critical'),
  ('chief-of-staff', 'Review and synthesize cross-department insights', 'Cross-department synthesis note produced within past 48 hours', INTERVAL '24 hours', 'high'),
  ('ops', 'Monitor system health and data freshness', 'All data syncs completed within their scheduled windows', INTERVAL '1 hour', 'critical'),
  ('ops', 'Track agent run success rates', 'No agent has > 30% failure rate over past 24 hours', INTERVAL '2 hours', 'high')
ON CONFLICT (tenant_id, agent_role, objective) DO UPDATE
SET
  success_metric = EXCLUDED.success_metric,
  check_frequency = EXCLUDED.check_frequency,
  priority = EXCLUDED.priority,
  active = true,
  updated_at = NOW();
