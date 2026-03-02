-- ═══════════════════════════════════════════════════════════
-- Skill Library — Shared Skills, Agent Assignments, Task Mapping
-- ═══════════════════════════════════════════════════════════

-- ── Layer 1: Shared Skill Definitions ─────────────────────
CREATE TABLE IF NOT EXISTS skills (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  category      text NOT NULL,         -- finance, engineering, marketing, product, customer-success, sales, design, leadership, operations, analytics
  description   text NOT NULL,
  methodology   text NOT NULL,         -- step-by-step instructions the agent follows
  tools_granted text[] NOT NULL DEFAULT '{}', -- tool names this skill unlocks
  version       int NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
CREATE INDEX IF NOT EXISTS idx_skills_slug     ON skills(slug);

-- ── Layer 2: Per-Agent Skill Assignments ──────────────────
CREATE TABLE IF NOT EXISTS agent_skills (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role        text NOT NULL REFERENCES company_agents(role),
  skill_id          uuid NOT NULL REFERENCES skills(id),
  proficiency       text NOT NULL DEFAULT 'learning'
                    CHECK (proficiency IN ('learning','competent','expert','master')),
  times_used        int NOT NULL DEFAULT 0,
  successes         int NOT NULL DEFAULT 0,
  failures          int NOT NULL DEFAULT 0,
  last_used_at      timestamptz,
  learned_refinements text[] NOT NULL DEFAULT '{}',  -- agent-specific tips
  failure_modes      text[] NOT NULL DEFAULT '{}',   -- known failure patterns
  assigned_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_role, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_role ON agent_skills(agent_role);

-- ── Layer 3: Task → Skill Mapping ─────────────────────────
CREATE TABLE IF NOT EXISTS task_skill_map (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_regex text NOT NULL,    -- regex pattern matched against task/prompt
  skill_slug text NOT NULL REFERENCES skills(slug),
  priority   int NOT NULL DEFAULT 0   -- higher = matched first
);

CREATE INDEX IF NOT EXISTS idx_task_skill_map_slug ON task_skill_map(skill_slug);

-- ═══════════════════════════════════════════════════════════
-- Seed: 22 Shared Skills
-- ═══════════════════════════════════════════════════════════

INSERT INTO skills (slug, name, category, description, methodology, tools_granted) VALUES

-- ── Finance (3) ──
('financial-reporting',
 'Financial Reporting',
 'finance',
 'Produce structured financial reports covering MRR, costs, margins, and runway.',
 E'1. Pull latest revenue data from Stripe via query_financials.\n2. Pull infrastructure costs via query_costs.\n3. Calculate unit economics (CAC, LTV, LTV:CAC ratio).\n4. Compare vs prior period — flag deltas > 10%.\n5. Produce a report with sections: Revenue, Costs, Margins, Runway, Recommendations.\n6. If any metric breaches a threshold, file_decision with tier yellow or red.',
 ARRAY['query_financials','query_costs','file_decision']),

('budget-monitoring',
 'Budget Monitoring',
 'finance',
 'Track spending against budgets and alert on anomalies.',
 E'1. Load current month spend from query_costs grouped by category.\n2. Compare vs allocated budget per category.\n3. Calculate burn rate and project month-end spend.\n4. If projected overspend > 15%, create an alert via file_decision.\n5. Identify top 3 cost drivers and suggest optimizations.\n6. Save cost pattern as memory for trend analysis.',
 ARRAY['query_costs','file_decision','save_memory']),

('revenue-analysis',
 'Revenue Analysis',
 'finance',
 'Analyze revenue streams, cohort behavior, and pricing impact.',
 E'1. Pull MRR, ARR, and churn data via query_financials.\n2. Segment by plan tier and customer cohort.\n3. Calculate net revenue retention (NRR) and expansion revenue.\n4. Identify top-growing and declining segments.\n5. Model pricing sensitivity if data allows.\n6. Produce insights with actionable recommendations.',
 ARRAY['query_financials','query_customers']),

-- ── Engineering (3) ──
('incident-response',
 'Incident Response',
 'engineering',
 'Detect, diagnose, and resolve production incidents following SRE best practices.',
 E'1. Acknowledge the incident and classify severity (P0-P3).\n2. Gather metrics: error rates, latency, affected services via check_system_health.\n3. Identify blast radius — which users/features are impacted?\n4. Formulate hypothesis and test via targeted queries.\n5. Apply mitigation (rollback, scale, config change).\n6. Write post-incident summary with timeline, root cause, and follow-ups.\n7. File incident_report and notify stakeholders.',
 ARRAY['check_system_health','query_logs','file_decision']),

('tech-spec-writing',
 'Technical Spec Writing',
 'engineering',
 'Write detailed technical specifications for proposed features or changes.',
 E'1. Understand the product requirement from the brief or task.\n2. Research existing architecture — what systems are affected?\n3. Define the proposed solution with component diagram.\n4. List API changes, DB schema changes, and migration steps.\n5. Identify risks, dependencies, and rollback strategy.\n6. Estimate effort in person-days and complexity.\n7. Output a structured spec document.',
 ARRAY['read_file','web_search']),

('platform-monitoring',
 'Platform Monitoring',
 'engineering',
 'Monitor infrastructure health, uptime, and performance metrics.',
 E'1. Run check_system_health across all services.\n2. Compare latency, error rate, and throughput vs baselines.\n3. Check resource utilization (CPU, memory, connections).\n4. Identify any degradation trends over the past 24h.\n5. If any metric is outside SLA, create an alert.\n6. Produce a health summary with green/yellow/red status per service.',
 ARRAY['check_system_health','query_logs']),

-- ── Marketing (3) ──
('content-creation',
 'Content Creation',
 'marketing',
 'Create blog posts, social content, and marketing copy aligned with brand voice.',
 E'1. Review the content brief or topic from the task.\n2. Research the topic — gather data points, quotes, examples.\n3. Outline the piece with a hook, body sections, and CTA.\n4. Write the first draft emphasizing Glyphor''s autonomous positioning.\n5. Self-edit for clarity, tone, and brand alignment.\n6. Add SEO metadata (title, description, keywords).\n7. Output the final piece in markdown format.',
 ARRAY['web_search','save_memory']),

('seo-optimization',
 'SEO Optimization',
 'marketing',
 'Optimize content and site structure for search engine visibility.',
 E'1. Identify target keywords via web_search and competitor analysis.\n2. Analyze current ranking positions if available.\n3. Review on-page factors: title tags, meta descriptions, headings, internal links.\n4. Check content quality signals: word count, readability, keyword density.\n5. Identify content gaps and opportunities.\n6. Produce a prioritized list of SEO improvements.',
 ARRAY['web_search']),

('social-media-management',
 'Social Media Management',
 'marketing',
 'Plan, create, and analyze social media content across platforms.',
 E'1. Review content calendar and upcoming company milestones.\n2. Draft posts tailored to each platform (Twitter/X, LinkedIn, etc.).\n3. Ensure brand voice consistency — autonomous, not assisted.\n4. Schedule posts with optimal timing based on engagement data.\n5. Analyze recent post performance metrics.\n6. Suggest content adjustments based on engagement trends.',
 ARRAY['web_search','save_memory']),

-- ── Product (3) ──
('user-research',
 'User Research',
 'product',
 'Gather and synthesize user insights to inform product decisions.',
 E'1. Define the research question from the task brief.\n2. Gather quantitative data: usage metrics, activation rates, feature adoption.\n3. Identify behavioral patterns and user segments.\n4. Synthesize findings into actionable insights.\n5. Map insights to product opportunities.\n6. Prioritize opportunities by impact and feasibility.',
 ARRAY['query_customers','query_financials']),

('competitive-analysis',
 'Competitive Analysis',
 'product',
 'Track competitors, analyze positioning, and identify market opportunities.',
 E'1. Identify the competitive set relevant to the task.\n2. Research each competitor: features, pricing, positioning, recent moves.\n3. Build a comparison matrix on key dimensions.\n4. Identify Glyphor''s differentiation and gaps.\n5. Analyze market trends affecting the competitive landscape.\n6. Produce strategic recommendations with evidence.',
 ARRAY['web_search','save_memory']),

('roadmap-management',
 'Roadmap Management',
 'product',
 'Maintain and prioritize the product roadmap using RICE scoring.',
 E'1. Load current roadmap items and their RICE scores.\n2. Gather new inputs: user feedback, competitive moves, strategic objectives.\n3. Score new items using RICE (Reach × Impact × Confidence / Effort).\n4. Re-rank the backlog based on updated scores.\n5. Identify dependencies and sequencing constraints.\n6. Produce an updated roadmap summary with rationale for changes.',
 ARRAY['query_customers','file_decision']),

-- ── Customer Success (3) ──
('health-scoring',
 'Customer Health Scoring',
 'customer-success',
 'Calculate and monitor customer health scores to predict churn risk.',
 E'1. Pull usage data: login frequency, feature adoption, support tickets.\n2. Calculate composite health score (0-100) using weighted signals.\n3. Classify customers: healthy (>70), at-risk (40-70), critical (<40).\n4. Compare vs previous period — flag significant deterioration.\n5. For at-risk/critical customers, identify specific risk factors.\n6. Recommend intervention strategy for each risk segment.',
 ARRAY['query_customers','save_memory']),

('churn-prevention',
 'Churn Prevention',
 'customer-success',
 'Identify and intervene with at-risk customers before they churn.',
 E'1. Query customers with health scores below 50 or declining trend.\n2. Analyze churn indicators: reduced usage, support escalations, contract timing.\n3. Segment at-risk customers by recovery potential.\n4. Draft personalized outreach messages addressing specific pain points.\n5. Recommend product or service adjustments to improve experience.\n6. Schedule follow-up check-ins and track intervention outcomes.',
 ARRAY['query_customers','send_agent_message','save_memory']),

('customer-onboarding',
 'Customer Onboarding',
 'customer-success',
 'Design and execute onboarding experiences that drive activation.',
 E'1. Identify new users who have not completed key activation steps.\n2. Determine which activation milestone they''re stuck at.\n3. Draft targeted guidance for the specific blocker.\n4. Personalize the outreach based on user profile and use case.\n5. Track activation rates and identify systemic bottlenecks.\n6. Recommend onboarding flow improvements based on data.',
 ARRAY['query_customers','save_memory']),

-- ── Sales (2) ──
('account-research',
 'Account Research',
 'sales',
 'Research enterprise prospects with depth to enable consultative selling.',
 E'1. Identify the target account from the task brief.\n2. Research company: size, industry, tech stack, recent news, leadership.\n3. Identify 5+ specific pain points relevant to Glyphor''s value prop.\n4. Find the right contacts and their roles in buying decisions.\n5. Build a tailored value proposition for this specific account.\n6. Produce a structured account brief with next steps.',
 ARRAY['web_search','save_memory']),

('proposal-generation',
 'Proposal Generation',
 'sales',
 'Create customized ROI models and sales proposals for enterprise prospects.',
 E'1. Load the account research brief for the target prospect.\n2. Calculate ROI model: time saved, cost reduced, revenue enabled.\n3. Build pricing recommendation based on usage estimates.\n4. Draft executive summary connecting their pain points to our solution.\n5. Create feature-benefit mapping specific to their use case.\n6. Produce a polished proposal document with clear next steps.',
 ARRAY['web_search','query_financials']),

-- ── Design (2) ──
('design-review',
 'Design Review',
 'design',
 'Audit UI outputs for quality, consistency, and anti-AI-smell patterns.',
 E'1. Load the design artifact (component, page, template) to review.\n2. Check against design system: spacing, typography, color palette.\n3. Scan for AI-smell patterns: generic layouts, stock-photo feel, bland copy.\n4. Evaluate accessibility: contrast ratios, touch targets, alt text.\n5. Score overall quality on a 0-100 scale with category breakdowns.\n6. Produce specific actionable feedback with before/after suggestions.',
 ARRAY['read_file','save_memory']),

('design-system-management',
 'Design System Management',
 'design',
 'Maintain and evolve the component library, tokens, and patterns.',
 E'1. Audit current design token usage across the codebase.\n2. Identify inconsistencies: color overrides, spacing violations, rogue fonts.\n3. Review component library for completeness and documentation.\n4. Propose new tokens or components based on usage patterns.\n5. Document any breaking changes with migration guides.\n6. Ensure all components have proper accessibility attributes.',
 ARRAY['read_file','web_search']),

-- ── Leadership (2) ──
('decision-routing',
 'Decision Routing',
 'leadership',
 'Classify decisions by impact tier and route for appropriate approval.',
 E'1. Analyze the decision: scope, reversibility, cost, strategic impact.\n2. Classify into tier: green (auto-approve), yellow (founder review), red (both founders).\n3. If yellow/red, prepare a decision brief with: context, options, recommendation, risks.\n4. File the decision via file_decision with appropriate tier.\n5. Track decision status and follow up on pending items.\n6. Log the decision outcome for pattern analysis.',
 ARRAY['file_decision','send_agent_message','save_memory']),

('cross-team-coordination',
 'Cross-Team Coordination',
 'leadership',
 'Coordinate work across departments, resolve conflicts, and align priorities.',
 E'1. Identify the cross-team initiative or conflict from the task.\n2. Gather context from all involved teams via messages or data.\n3. Map dependencies and potential blockers.\n4. Draft a coordination plan with clear owners and timelines.\n5. Send alignment messages to relevant agents.\n6. Schedule follow-ups and track completion.',
 ARRAY['send_agent_message','file_decision','save_memory']),

-- ── Operations (1) ──
('system-monitoring',
 'System Monitoring',
 'operations',
 'Monitor agent health, data freshness, and system-wide performance.',
 E'1. Check all agent statuses: last run time, success rate, error patterns.\n2. Verify data freshness: when were key tables last updated?\n3. Monitor cost trends: daily spend vs budget.\n4. Check for stuck or unresponsive agents.\n5. Produce a system health report with red/yellow/green status.\n6. If any agent is unhealthy, diagnose and recommend action.',
 ARRAY['check_system_health','query_logs','save_memory'])

ON CONFLICT (slug) DO NOTHING;


-- ═══════════════════════════════════════════════════════════
-- Seed: Agent → Skill Assignments
-- ═══════════════════════════════════════════════════════════

-- Helper: insert agent_skills by role + skill slug
INSERT INTO agent_skills (agent_role, skill_id, proficiency)
SELECT r.role, s.id, r.proficiency
FROM (VALUES
  -- CFO
  ('cfo', 'financial-reporting', 'expert'),
  ('cfo', 'budget-monitoring', 'expert'),
  ('cfo', 'revenue-analysis', 'expert'),
  -- CTO
  ('cto', 'incident-response', 'expert'),
  ('cto', 'tech-spec-writing', 'expert'),
  ('cto', 'platform-monitoring', 'expert'),
  -- CMO
  ('cmo', 'content-creation', 'expert'),
  ('cmo', 'seo-optimization', 'competent'),
  ('cmo', 'social-media-management', 'competent'),
  -- CPO
  ('cpo', 'user-research', 'expert'),
  ('cpo', 'competitive-analysis', 'expert'),
  ('cpo', 'roadmap-management', 'expert'),
  -- VP Customer Success
  ('vp-customer-success', 'health-scoring', 'expert'),
  ('vp-customer-success', 'churn-prevention', 'expert'),
  ('vp-customer-success', 'customer-onboarding', 'competent'),
  -- VP Sales
  ('vp-sales', 'account-research', 'expert'),
  ('vp-sales', 'proposal-generation', 'expert'),
  -- VP Design
  ('vp-design', 'design-review', 'expert'),
  ('vp-design', 'design-system-management', 'expert'),
  -- Chief of Staff
  ('chief-of-staff', 'decision-routing', 'expert'),
  ('chief-of-staff', 'cross-team-coordination', 'expert'),
  ('chief-of-staff', 'financial-reporting', 'competent'),
  -- Ops (Atlas)
  ('ops', 'system-monitoring', 'expert'),
  ('ops', 'incident-response', 'competent'),
  -- Sub-team: Engineering
  ('platform-engineer', 'platform-monitoring', 'competent'),
  ('platform-engineer', 'incident-response', 'learning'),
  ('quality-engineer', 'tech-spec-writing', 'competent'),
  ('devops-engineer', 'platform-monitoring', 'competent'),
  ('devops-engineer', 'incident-response', 'learning'),
  -- Sub-team: Product
  ('user-researcher', 'user-research', 'competent'),
  ('competitive-intel', 'competitive-analysis', 'competent'),
  -- Sub-team: Finance
  ('revenue-analyst', 'revenue-analysis', 'competent'),
  ('revenue-analyst', 'financial-reporting', 'learning'),
  ('cost-analyst', 'budget-monitoring', 'competent'),
  -- Sub-team: Marketing
  ('content-creator', 'content-creation', 'competent'),
  ('seo-analyst', 'seo-optimization', 'competent'),
  ('social-media-manager', 'social-media-management', 'competent'),
  -- Sub-team: Customer Success
  ('onboarding-specialist', 'customer-onboarding', 'competent'),
  ('support-triage', 'health-scoring', 'learning'),
  -- Sub-team: Sales
  ('account-research', 'account-research', 'competent'),
  -- Sub-team: Design
  ('ui-ux-designer', 'design-review', 'competent'),
  ('ui-ux-designer', 'design-system-management', 'learning'),
  ('frontend-engineer', 'design-system-management', 'learning'),
  ('design-critic', 'design-review', 'competent'),
  ('template-architect', 'design-system-management', 'competent')
) AS r(role, slug, proficiency)
JOIN skills s ON s.slug = r.slug
ON CONFLICT (agent_role, skill_id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════
-- Seed: Task → Skill Mapping
-- ═══════════════════════════════════════════════════════════

INSERT INTO task_skill_map (task_regex, skill_slug, priority) VALUES
  ('(?i)(financial|revenue|mrr|cost|margin|runway)', 'financial-reporting', 10),
  ('(?i)(budget|spend|overspend|burn)', 'budget-monitoring', 10),
  ('(?i)(revenue|cohort|pricing|arr|nrr)', 'revenue-analysis', 8),
  ('(?i)(incident|outage|down|error rate|p[0-3])', 'incident-response', 15),
  ('(?i)(spec|technical design|architecture|rfc)', 'tech-spec-writing', 10),
  ('(?i)(health check|uptime|latency|monitor)', 'platform-monitoring', 8),
  ('(?i)(blog|content|article|write|copy)', 'content-creation', 10),
  ('(?i)(seo|keyword|ranking|search engine)', 'seo-optimization', 10),
  ('(?i)(social|twitter|linkedin|post)', 'social-media-management', 10),
  ('(?i)(user research|interview|usability|persona)', 'user-research', 10),
  ('(?i)(competitor|competitive|market analysis)', 'competitive-analysis', 10),
  ('(?i)(roadmap|backlog|rice|prioriti)', 'roadmap-management', 10),
  ('(?i)(health score|engagement|usage pattern)', 'health-scoring', 10),
  ('(?i)(churn|at.risk|retention|renew)', 'churn-prevention', 10),
  ('(?i)(onboard|activation|welcome|new user)', 'customer-onboarding', 10),
  ('(?i)(prospect|account|enterprise|lead)', 'account-research', 10),
  ('(?i)(proposal|roi|deal|quote)', 'proposal-generation', 10),
  ('(?i)(design review|ui audit|quality score)', 'design-review', 10),
  ('(?i)(design system|token|component library)', 'design-system-management', 10),
  ('(?i)(decision|approval|escalat)', 'decision-routing', 10),
  ('(?i)(coordinat|cross.team|align)', 'cross-team-coordination', 8),
  ('(?i)(system status|agent health|data fresh)', 'system-monitoring', 10)
ON CONFLICT DO NOTHING;
