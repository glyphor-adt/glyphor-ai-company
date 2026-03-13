-- Agent knowledge-gap evaluation system
-- Scenario library + scheduled judge-model scoring for agent readiness.

CREATE TABLE IF NOT EXISTS agent_eval_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role TEXT NOT NULL,
  scenario_name TEXT NOT NULL,
  input_prompt TEXT NOT NULL,
  pass_criteria TEXT NOT NULL,
  fail_indicators TEXT NOT NULL,
  knowledge_tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id),
  CONSTRAINT agent_eval_scenarios_role_name_key UNIQUE (tenant_id, agent_role, scenario_name)
);

CREATE INDEX IF NOT EXISTS idx_agent_eval_scenarios_role
  ON agent_eval_scenarios(tenant_id, agent_role);

ALTER TABLE agent_eval_scenarios ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_eval_scenarios'
      AND policyname = 'tenant_isolation_agent_eval_scenarios'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY tenant_isolation_agent_eval_scenarios ON agent_eval_scenarios
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_eval_scenarios'
      AND policyname = 'system_bypass_agent_eval_scenarios'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY system_bypass_agent_eval_scenarios ON agent_eval_scenarios
        TO glyphor_system USING (true) WITH CHECK (true)
    $policy$;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS agent_eval_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES agent_eval_scenarios(id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL,
  run_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  agent_output TEXT NOT NULL,
  score TEXT NOT NULL CHECK (score IN ('PASS', 'SOFT_FAIL', 'HARD_FAIL')),
  reasoning TEXT,
  missing_knowledge TEXT[] NOT NULL DEFAULT '{}',
  knowledge_tags_failed TEXT[] NOT NULL DEFAULT '{}',
  model_used TEXT,
  eval_cost DECIMAL(10,6),
  tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000' REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_eval_results_role_run
  ON agent_eval_results(tenant_id, agent_role, run_date DESC);
CREATE INDEX IF NOT EXISTS idx_agent_eval_results_scenario
  ON agent_eval_results(scenario_id, run_date DESC);
CREATE INDEX IF NOT EXISTS idx_agent_eval_results_score
  ON agent_eval_results(tenant_id, score, run_date DESC);

ALTER TABLE agent_eval_results ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_eval_results'
      AND policyname = 'tenant_isolation_agent_eval_results'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY tenant_isolation_agent_eval_results ON agent_eval_results
        USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_eval_results'
      AND policyname = 'system_bypass_agent_eval_results'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY system_bypass_agent_eval_results ON agent_eval_results
        TO glyphor_system USING (true) WITH CHECK (true)
    $policy$;
  END IF;
END
$$;

CREATE OR REPLACE VIEW agent_readiness AS
WITH latest_runs AS (
  SELECT tenant_id, agent_role, MAX(run_date) AS latest_run_date
  FROM agent_eval_results
  GROUP BY tenant_id, agent_role
),
latest_results AS (
  SELECT r.*
  FROM agent_eval_results r
  JOIN latest_runs lr
    ON lr.tenant_id = r.tenant_id
   AND lr.agent_role = r.agent_role
   AND lr.latest_run_date = r.run_date
),
tag_rollup AS (
  SELECT
    lr.tenant_id,
    lr.agent_role,
    COALESCE(
      ARRAY_AGG(DISTINCT tag.tag) FILTER (WHERE tag.tag IS NOT NULL),
      ARRAY[]::TEXT[]
    ) AS gap_tags
  FROM latest_results lr
  LEFT JOIN LATERAL unnest(COALESCE(lr.knowledge_tags_failed, ARRAY[]::TEXT[])) AS tag(tag)
    ON TRUE
  GROUP BY lr.tenant_id, lr.agent_role
)
SELECT
  lr.tenant_id,
  lr.agent_role,
  COUNT(*) FILTER (WHERE lr.score = 'PASS') AS pass,
  COUNT(*) FILTER (WHERE lr.score = 'SOFT_FAIL') AS soft_fail,
  COUNT(*) FILTER (WHERE lr.score = 'HARD_FAIL') AS hard_fail,
  ROUND(
    COUNT(*) FILTER (WHERE lr.score = 'PASS')::DECIMAL
    / NULLIF(COUNT(*), 0) * 100
  ) AS pass_rate,
  tr.gap_tags
FROM latest_results lr
JOIN tag_rollup tr
  ON tr.tenant_id = lr.tenant_id
 AND tr.agent_role = lr.agent_role
GROUP BY lr.tenant_id, lr.agent_role, tr.gap_tags
ORDER BY pass_rate ASC NULLS LAST;

INSERT INTO agent_eval_scenarios (agent_role, scenario_name, input_prompt, pass_criteria, fail_indicators, knowledge_tags)
VALUES
  (
    'cmo',
    'Brand Voice Execution',
    $$Write a LinkedIn post announcing Glyphor's AI Marketing Department for SMBs.
This is the first public post about the product. Keep it under 200 words.$$,
    $$Present tense and active voice; no banned words or exclamation marks; no hedging or AI self-reference; mentions the Slack delivery model; focuses on outcomes and deliverables rather than technology; tone is confident, direct, and slightly dry.$$,
    $$Uses banned words or hype language; uses exclamation marks; leaks internal architecture; generic transformation fluff; mentions Teams instead of Slack.$$,
    ARRAY['brand_voice', 'product_positioning', 'channel_strategy']
  ),
  (
    'cmo',
    'Competitive Differentiation',
    $$A prospect on LinkedIn comments: "How is this different from just using Lindy AI
or hiring a virtual assistant?" Draft a reply. Keep it conversational but sharp.$$,
    $$Knows Lindy is a no-code single-agent tool, not a department; contrasts tool vs department and prompting vs outcomes; mentions concrete Glyphor deliverables; avoids trashing the competitor; stays in brand voice.$$,
    $$Cannot describe Lindy; generic AI-is-better framing; leaks internal architecture; mentions pricing in a public reply.$$,
    ARRAY['competitive_positioning', 'brand_voice', 'product_differentiation']
  ),
  (
    'cmo',
    'Brand Compliance Review',
    $$Tyler submitted this blog post opening paragraph for review. Is it on-brand?
Identify every issue:

"We're thrilled to announce that Glyphor is revolutionizing the marketing
landscape! By leveraging cutting-edge AI technology, we empower small businesses
to unlock their full marketing potential. Our innovative platform utilizes
advanced machine learning to drive unprecedented growth for our customers."$$,
    $$Flags the hype words and banned terms, the exclamation mark, vague phrasing, and "platform" positioning; identifies missing deliverables/outcomes; gives a rewrite or clear rewrite direction.$$,
    $$Misses more than two banned terms; says it mostly looks good; cannot rewrite; fails to catch the platform framing.$$,
    ARRAY['brand_voice', 'editing_rigor', 'product_positioning']
  ),
  (
    'cmo',
    'Content Strategy Decision',
    $$Kai wants to post a meme on the Glyphor LinkedIn about "copilot fatigue" —
it's a screenshot of someone yelling at Clippy with the caption
"me after my copilot suggests I write my own email."

Is this on-brand? Should we post it? Decide and explain your reasoning.$$,
    $$Connects the idea to the Still You campaign, evaluates tone and ICP fit, makes a clear yes or no decision, considers timing and sequencing, and flags trademark or IP risk around Clippy.$$,
    $$Does not know the Still You campaign; waffles; ignores ICP fit; ignores campaign sequencing; ignores trademark or image-IP risk.$$,
    ARRAY['campaign_context', 'brand_voice', 'icp', 'content_governance']
  ),
  (
    'cmo',
    'Channel Strategy',
    $$Andrew asks: "Should we be on TikTok?" Give him a recommendation he can
decide on in 30 seconds.$$,
    $$Gives a clear no or not-now recommendation with a concise reason; references the SMB founder and marketing-leader ICP, current team bandwidth, and the doctrine of no expansion without revenue milestones; respects the 30-second decision format.$$,
    $$Suggests testing TikTok without resource analysis; gives a long memo; cannot name current channels or team constraints; gives generic social advice.$$,
    ARRAY['channel_strategy', 'icp', 'resource_constraints', 'founder_communication']
  ),
  (
    'cto',
    'Incident Triage',
    $$Atlas flagged: agent abort rate jumped to 35% in the last 2 hours.
8 of the last 20 runs are aborting. Diagnose. What do you check first?$$,
    $$Starts with the failing agents and task types, checks token or history compression issues, checks MCP server health and init timeout loops, considers skipped_precheck misclassification, references cost risk, and responds as a prioritized checklist.$$,
    $$Generic check-the-logs answer; no mention of token context issues; no MCP timeout pattern; does not know to inspect agent_runs.$$,
    ARRAY['incident_response', 'agent_runs_schema', 'history_compression', 'mcp_operations']
  ),
  (
    'cto',
    'Architecture Decision',
    $$Kristina asks: "We need to add HubSpot integration for tracking prospects
that Rachel identifies. Should we build a new MCP server, add tools to an
existing one, or use a third-party connector? Give me a recommendation I
can approve in 30 seconds."$$,
    $$References the current MCP server inventory and Rachel's tool context, weighs maintenance burden against integration fit, considers third-party connectors, provides a concise recommendation, and includes cost or effort framing.$$,
    $$Does not know the MCP inventory; does not know Rachel's tool context; proposes something inconsistent with current architecture; overcomplicates the answer.$$,
    ARRAY['integration_architecture', 'mcp_inventory', 'tooling_strategy', 'founder_communication']
  ),
  (
    'cto',
    'Deploy Risk Assessment',
    $$Alex submitted a PR that upgrades pgvector from 0.5 to 0.7 on Cloud SQL.
He says it enables HNSW indexes which would speed up knowledge graph queries
by 10x. Should we merge and deploy? What's your risk assessment?$$,
    $$Knows the stack is Cloud SQL Postgres with pgvector, considers managed version support, migration impact on vector-backed tables, downtime and rollback risk, affected systems, and whether the gain matters at current scale, then gives a clear recommendation.$$,
    $$Thinks we self-manage Postgres; misses the scale or table impact; says test in staging without understanding our environment; cannot identify dependent systems.$$,
    ARRAY['database_architecture', 'cloud_sql', 'knowledge_graph', 'deployment_risk']
  ),
  (
    'cto',
    'Cost Investigation',
    $$Nadia flagged: yesterday's compute was $11.40, which is 2.3x the daily budget
($5/day for $150/month). The spike came from 3 agents. Investigate and recommend.$$,
    $$Understands the budget math, inspects agent_runs and model routing, distinguishes one-off spikes from trends, knows Nadia's budget ownership, and recommends specific operational levers such as model downgrade or reduced run cadence.$$,
    $$Cannot explain token-pricing cost structure; does not know model options or routing; gives generic reduce-usage advice; ignores Nadia's role.$$,
    ARRAY['cost_diagnostics', 'model_routing', 'budgeting', 'cross_functional_coordination']
  ),
  (
    'cto',
    'New Agent Request',
    $$Elena (CPO) wants to spin up a new "Customer Success" agent to monitor the
3 paying customers — wait, we have 0 customers. She seems to be working from
outdated information. How do you handle this?$$,
    $$Catches the stale customer count, corrects Elena directly, investigates why she has stale data, rejects expansion before revenue milestones, and escalates only if the stale-data issue is systemic.$$,
    $$Misses the zero-customer contradiction; approves the request anyway; does not investigate the stale-data source; routes it indirectly instead of addressing Elena.$$,
    ARRAY['company_metrics', 'operating_doctrine', 'data_freshness', 'cross_functional_coordination']
  ),
  (
    'cfo',
    'Unit Economics',
    $$Andrew asks: "If we get our first customer at $500/month, are we profitable
on that customer? What's the unit economics?" Produce the analysis.$$,
    $$Uses the current compute budget, estimates marginal customer cost, includes infrastructure and model costs, references the default model pricing, provides a simple margin estimate, and is explicit about what remains unknown.$$,
    $$Cannot produce numbers; relies on generic SaaS benchmarks; does not know model pricing; substitutes assumptions for a concrete estimate; says more data is needed without specifying which data.$$,
    ARRAY['unit_economics', 'model_pricing', 'infrastructure_costs', 'financial_reasoning']
  ),
  (
    'cfo',
    'Budget Alert',
    $$It's March 18. Month-to-date compute spend is $94. We're 58% through the
month and 63% through the budget. Is this a problem? What do you do?$$,
    $$Computes the month-end projection, judges severity proportionally, checks the drivers, prioritizes daily trend over a single spike, recommends concrete throttling or routing levers, and frames a specific founder ask.$$,
    $$Cannot do the projection math; overreacts by shutting things down; says let's monitor without a projection; does not know which cost levers exist.$$,
    ARRAY['budget_forecasting', 'cost_controls', 'financial_reasoning', 'founder_communication']
  ),
  (
    'cfo',
    'Billing Sync Failure',
    $$Your daily check shows the Stripe billing sync hasn't run in 48 hours.
The last sync was March 11 at midnight. What do you do?$$,
    $$Knows the sync cadence, notes that revenue impact is currently zero because we are pre-revenue, still treats the broken sync as important, distinguishes scheduler failure from runtime failure, routes to engineering, and checks related financial syncs.$$,
    $$Does not know the sync schedule; panics about current revenue impact; tries to fix it alone; ignores the possibility that related syncs may also be broken.$$,
    ARRAY['finance_operations', 'sync_monitoring', 'company_metrics', 'incident_routing']
  ),
  (
    'cfo',
    'Vendor Spend Audit',
    $$Kristina asks: "What are we paying for every month? List every vendor
subscription and its cost. I want the full picture."$$,
    $$Names the main infrastructure and SaaS vendors, separates known costs from items needing lookup, indicates which data can come from live billing systems, and formats the answer for fast scanning without making up missing numbers.$$,
    $$Can only name a few vendors; hallucinates numbers; does not know the billing sync sources; says more research is needed without a starting point.$$,
    ARRAY['vendor_spend', 'billing_systems', 'infrastructure_costs', 'financial_reporting']
  ),
  (
    'cfo',
    'Tax Obligation Check',
    $$Bob (Tax) hasn't run in 3 days. You're the CFO. What tax and compliance
obligations should you be tracking right now for a pre-revenue Delaware C-corp
with 0 employees and 2 founders who are full-time employed elsewhere?$$,
    $$Names the relevant Delaware and federal obligations, notes the Texas context appropriately, treats Bob as the specialist, checks whether the inactivity is a run issue versus no work, and stays within the CFO coordination role.$$,
    $$Does not know we are a Delaware C-corp or Texas-based; tries to act as the tax specialist; ignores Bob's availability and health.$$,
    ARRAY['tax_compliance', 'company_facts', 'role_boundaries', 'agent_operations']
  )
ON CONFLICT (tenant_id, agent_role, scenario_name) DO UPDATE
SET
  input_prompt = EXCLUDED.input_prompt,
  pass_criteria = EXCLUDED.pass_criteria,
  fail_indicators = EXCLUDED.fail_indicators,
  knowledge_tags = EXCLUDED.knowledge_tags;
