-- Sync Finance team skill playbooks from markdown source files.
-- Sources:
--   skills/finance/financial-reporting.md
--   skills/finance/budget-monitoring.md
--   skills/finance/revenue-analysis.md
--   skills/finance/tax-strategy.md

BEGIN;

WITH skill_payload (slug, name, category, description, methodology, tools_granted, version) AS (
  VALUES
    (
      'financial-reporting',
      'financial-reporting',
      'finance',
      'Produce structured financial reports covering revenue, costs, margins, runway, and unit economics for founder consumption, investor readiness, and strategic planning.',
      $financial_reporting$
# Financial Reporting

Produce reporting in six sections:
1. Executive summary
2. Revenue
3. Costs
4. Margins and unit economics
5. Cash position and runway
6. Recommendations

Always validate data freshness before reporting and escalate threshold breaches with clear decision-ready actions.
      $financial_reporting$,
      ARRAY[
        'query_financials',
        'query_costs',
        'query_stripe_mrr',
        'query_stripe_revenue',
        'query_stripe_subscriptions',
        'get_burn_rate',
        'get_cash_balance',
        'get_cash_flow',
        'get_margin_analysis',
        'get_mrr_breakdown',
        'get_unit_economics',
        'get_revenue_forecast',
        'query_agent_run_costs',
        'get_ai_model_costs',
        'get_gcp_costs',
        'get_infrastructure_costs',
        'query_gcp_billing',
        'get_cost_anomalies',
        'get_vendor_costs',
        'get_stripe_invoices',
        'get_subscription_details',
        'calculate_unit_economics',
        'calculate_ltv_cac',
        'forecast_revenue',
        'query_revenue_by_cohort',
        'query_revenue_by_product',
        'query_churn_revenue',
        'generate_financial_report',
        'write_financial_report',
        'file_decision',
        'save_memory',
        'send_agent_message',
        'propose_directive'
      ]::text[],
      2
    ),
    (
      'budget-monitoring',
      'budget-monitoring',
      'finance',
      'Monitor spend against budget in real time, detect anomalies early, and route cost-control decisions before overruns compound. Shared by CFO and Bob for operational plus tax treatment context.',
      $budget_monitoring$
# Budget Monitoring

Run a daily control loop:
1. Pull current spend by category.
2. Compare against budget and trend.
3. Detect anomalies and hypothesize root cause.
4. Escalate by variance threshold.
5. Recommend corrective action with expected dollar impact.

This skill is shared: CFO leads operational control and Bob adds tax treatment context.
      $budget_monitoring$,
      ARRAY[
        'query_costs',
        'get_cost_anomalies',
        'get_vendor_costs',
        'get_gcp_costs',
        'get_ai_model_costs',
        'get_infrastructure_costs',
        'get_burn_rate',
        'get_cash_flow',
        'get_pending_transactions',
        'create_budget',
        'check_budget_status',
        'query_agent_run_costs',
        'query_financials',
        'file_decision',
        'save_memory',
        'send_agent_message'
      ]::text[],
      2
    ),
    (
      'revenue-analysis',
      'revenue-analysis',
      'finance',
      'Analyze revenue streams, cohort behavior, pricing impact, expansion dynamics, and churn patterns to assess the quality and sustainability of Glyphor revenue.',
      $revenue_analysis$
# Revenue Analysis

Analyze revenue quality, not only top-line growth.

Core outputs:
1. MRR decomposition and NRR
2. Cohort behavior and churn patterns
3. Product and concentration risk
4. Pricing scenario implications
5. Forecast scenarios with assumptions and confidence

Escalate material concentration, churn, and unit-economics risks with explicit options.
      $revenue_analysis$,
      ARRAY[
        'query_financials',
        'query_stripe_mrr',
        'query_stripe_revenue',
        'query_stripe_subscriptions',
        'get_mrr_breakdown',
        'get_revenue_forecast',
        'get_unit_economics',
        'calculate_unit_economics',
        'calculate_ltv_cac',
        'forecast_revenue',
        'query_revenue_by_cohort',
        'query_revenue_by_product',
        'query_churn_revenue',
        'get_churn_analysis',
        'get_cohort_retention',
        'get_subscription_details',
        'get_stripe_invoices',
        'query_customers',
        'save_memory',
        'send_agent_message',
        'file_decision'
      ]::text[],
      2
    ),
    (
      'tax-strategy',
      'tax-strategy',
      'finance',
      'Manage tax obligations, tax calendar, and optimization strategy including estimated taxes, deductibility analysis, and R&D credit assessment for an AI-native company.',
      $tax_strategy$
# Tax Strategy

Apply CPA-level tax judgment to corporate finance data.

Core scope:
1. Estimated tax calculations
2. Deadline and compliance calendar management
3. Deductibility and capitalization treatment review
4. R&D credit qualification and documentation readiness
5. Cross-functional tax-impact recommendations

Default posture is defensible, documented, decision-ready tax strategy.
      $tax_strategy$,
      ARRAY[
        'calculate_tax_estimate',
        'get_tax_calendar',
        'get_tax_research',
        'review_tax_strategy',
        'query_financials',
        'query_costs',
        'get_stripe_invoices',
        'get_vendor_costs',
        'get_pending_transactions',
        'get_cash_flow',
        'get_infrastructure_costs',
        'get_ai_model_costs',
        'web_search',
        'save_memory',
        'send_agent_message',
        'file_decision'
      ]::text[],
      2
    )
)
INSERT INTO skills (slug, name, category, description, methodology, tools_granted, version)
SELECT slug, name, category, description, methodology, tools_granted, version
FROM skill_payload
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  methodology = EXCLUDED.methodology,
  tools_granted = EXCLUDED.tools_granted,
  version = EXCLUDED.version,
  updated_at = NOW();

WITH holder_payload AS (
  SELECT *
  FROM (VALUES
    ('cfo', 'financial-reporting', 'expert'),
    ('cfo', 'budget-monitoring', 'expert'),
    ('cfo', 'revenue-analysis', 'expert'),
    ('bob-the-tax-pro', 'budget-monitoring', 'competent'),
    ('bob-the-tax-pro', 'tax-strategy', 'expert')
  ) AS x(agent_role, skill_slug, proficiency)
),
target_slugs AS (
  SELECT DISTINCT skill_slug FROM holder_payload
),
existing_target AS (
  SELECT s.id AS skill_id, s.slug
  FROM skills s
  JOIN target_slugs t ON t.skill_slug = s.slug
)
DELETE FROM agent_skills ags
USING existing_target et
WHERE ags.skill_id = et.skill_id
  AND NOT EXISTS (
    SELECT 1
    FROM holder_payload hp
    WHERE hp.agent_role = ags.agent_role
      AND hp.skill_slug = et.slug
  );

WITH holder_payload AS (
  SELECT *
  FROM (VALUES
    ('cfo', 'financial-reporting', 'expert'),
    ('cfo', 'budget-monitoring', 'expert'),
    ('cfo', 'revenue-analysis', 'expert'),
    ('bob-the-tax-pro', 'budget-monitoring', 'competent'),
    ('bob-the-tax-pro', 'tax-strategy', 'expert')
  ) AS x(agent_role, skill_slug, proficiency)
)
INSERT INTO agent_skills (agent_role, skill_id, proficiency)
SELECT hp.agent_role, s.id, hp.proficiency
FROM holder_payload hp
JOIN skills s ON s.slug = hp.skill_slug
JOIN company_agents ca ON ca.role = hp.agent_role
ON CONFLICT (agent_role, skill_id) DO UPDATE SET
  proficiency = EXCLUDED.proficiency;

WITH mapping_payload AS (
  SELECT *
  FROM (VALUES
    ('(?i)(financial report|cash flow|runway|unit economics|gross margin|burn rate)', 'financial-reporting', 18),
    ('(?i)(budget monitor|cost anomaly|overspend|spike|budget variance|spend control)', 'budget-monitoring', 18),
    ('(?i)(revenue analysis|mrr|arr|nrr|cohort retention|churn revenue|pricing scenario)', 'revenue-analysis', 17),
    ('(?i)(tax strategy|estimated tax|r&d credit|section 174|deductibility|franchise tax)', 'tax-strategy', 17)
  ) AS x(task_regex, skill_slug, priority)
),
target_slugs AS (
  SELECT DISTINCT skill_slug FROM mapping_payload
)
DELETE FROM task_skill_map t
USING target_slugs s
WHERE t.skill_slug = s.skill_slug;

WITH mapping_payload AS (
  SELECT *
  FROM (VALUES
    ('(?i)(financial report|cash flow|runway|unit economics|gross margin|burn rate)', 'financial-reporting', 18),
    ('(?i)(budget monitor|cost anomaly|overspend|spike|budget variance|spend control)', 'budget-monitoring', 18),
    ('(?i)(revenue analysis|mrr|arr|nrr|cohort retention|churn revenue|pricing scenario)', 'revenue-analysis', 17),
    ('(?i)(tax strategy|estimated tax|r&d credit|section 174|deductibility|franchise tax)', 'tax-strategy', 17)
  ) AS x(task_regex, skill_slug, priority)
)
INSERT INTO task_skill_map (task_regex, skill_slug, priority)
SELECT task_regex, skill_slug, priority
FROM mapping_payload;

-- Bob should operate under Finance team/department while keeping legal reporting line.
UPDATE company_agents
SET department = 'Finance'
WHERE role IN ('bob-the-tax-pro', 'tax-strategy-specialist')
  AND (department IS NULL OR department IS DISTINCT FROM 'Finance');

UPDATE company_agents
SET team = 'Finance'
WHERE role IN ('bob-the-tax-pro', 'tax-strategy-specialist')
  AND (team IS NULL OR team IS DISTINCT FROM 'Finance');

COMMIT;