-- Knowledge system overhaul v2
-- Refresh company knowledge, founder directives, and remove deleted-agent leftovers.

DELETE FROM company_knowledge_base
WHERE section IN (
  'mission', 'operating_doctrine', 'current_priorities',
  'products', 'founders', 'team_structure', 'metrics',
  'culture', 'competitive_landscape', 'infrastructure',
  'pricing', 'authority_model', 'standing_orders'
);

INSERT INTO company_knowledge_base (section, title, content, audience, last_edited_by) VALUES
('mission', 'What We Are', $$Glyphor does not sell AI tools. Glyphor sells AI-powered departments that deliver outcomes.

Customers are buying functional work performed inside their organization. The AI Marketing Department shows up where customers already work, starting in Slack, and produces usable marketing output the same day.

Glyphor is operating revenue-first and capital-efficient. Durability precedes scale. Revenue precedes narrative. Execution precedes expansion.$$ , 'all', 'system'),
('operating_doctrine', 'Strategic Operating Doctrine', $$Core constraints:
- One external product until revenue and retention validate: the AI Marketing Department
- Slack is the wedge; Teams follows after validation
- No dashboard as the primary product experience
- Pricing target remains $500-750 per month with no usage billing
- Target market is founder-led SMBs with 5-50 employees
- No enterprise, regulated-industry, or procurement-heavy expansion in this phase

The work must stay productized. Agents should detect and prevent scope creep into consulting behavior.$$ , 'all', 'system'),
('current_priorities', 'Current Priorities — March 2026', $$1. Platform Health Stabilization — fix the CTO death loop, activate history compression, clear blocked assignments, and reduce abort rate below 10 percent.
2. Brand Voice and Identity System — make the brand guide operational across content and design.
3. Competitive Landscape Research — deliver an executive-ready market and threat assessment.
4. Slack AI Marketing Department Landing Page — ship a revenue-facing product page that converts skeptical marketing leaders.
5. Still You Campaign Launch — launch the campaign after brand and landing-page prerequisites are complete.$$ , 'all', 'system'),
('products', 'Products', $$AI Marketing Department is the only external revenue product.

Pulse is an internal creative engine. Web Build is an internal development acceleration engine. Revy remains future roadmap work. The Cockpit dashboard is an internal command center, not a customer-facing product.$$ , 'all', 'system'),
('founders', 'Founders', $$Kristina Denney is CEO and the sole technical architect. Andrew Zwelling is COO and owns operations, business development, and partnerships.

Technical architecture, infrastructure, and agent-system design escalate to Kristina. Business strategy, partnerships, pricing, and go-to-market escalate to Andrew. Red-tier decisions require both founders.$$ , 'all', 'system'),
('team_structure', 'Team Structure', $$Total headcount: 32 — 2 founders and 30 active AI agents.

Executives: Sarah Chen, Marcus Reeves, Nadia Okafor, Elena Vasquez, Maya Brooks, Rachel Kim, Mia Tanaka, Victoria Chase.
Research: Sophia Lin, Lena Park, Daniel Okafor.
Sub-team: Alex Park, Sam DeLuca, Jordan Hayes, Riley Morgan, Priya Sharma, Daniel Ortiz, Tyler Reed, Lisa Chen, Kai Johnson, Leo Vargas, Ava Chen, Sofia Marchetti, Ryan Park, Jasmine Rivera.
Operations: Atlas Vega, Morgan Blake.
Specialists: Robert Finley, Zara Petrov, Adi Rose.$$ , 'all', 'system'),
('authority_model', 'Authority Model', $$Green: routine execution within role scope.
Yellow: one founder approves significant external-facing, budget, publishing, or production-impacting actions.
Red: both founders approve high-stakes changes including financial commitments, legal agreements, global infra changes, data deletion, and authority-model changes.

When in doubt, file Yellow.$$ , 'all', 'system'),
('metrics', 'Current Metrics', $$Baselines only. Finance and revenue agents should query live tools for current values.

- MRR: about $1,240
- Customers: 3
- Monthly compute budget target: $150
- Active agents: 30
- Tool registry: 573 known tools$$ , 'all', 'system'),
('infrastructure', 'Infrastructure', $$GCP Cloud Run, Cloud SQL PostgreSQL, Cloud Scheduler, Cloud Tasks, Redis, Secret Manager, Artifact Registry, Cloud Storage, Microsoft Entra ID, Microsoft Teams, M365 shared mailboxes, internal MCP servers, and an OpenAI Realtime voice gateway.$$ , 'all', 'system'),
('pricing', 'Pricing Strategy', $$AI Marketing Department pricing target is $500-750 per month flat rate.

Keep pricing simple, predictable, and non-usage-based. Externally, use starting at $500 per month while validation continues.$$ , 'all', 'system'),
('competitive_landscape', 'Competitive Landscape', $$No single competitor combines multi-agent hierarchy, cross-model consensus, tiered governance, and persistent agent identity in the same way.

Key competitors include Sierra, Devin, Ema, Lindy, Viktor, 11x, Artisan, CrewAI, and Salesforce Agentforce. Full competitive analysis is an active directive.$$ , 'all', 'system'),
('culture', 'Communication & Culture', $$Use present tense, active voice, and specific language. Numbers beat adjectives. Avoid banned buzzwords. No exclamation marks in external content. No hedging. If you are blocked, flag it immediately.$$ , 'all', 'system'),
('standing_orders', 'Standing Orders', $$Weekly:
- Marketing: 3 LinkedIn posts plus one industry, product, and thought-leadership mix
- Research: one competitive monitoring sweep and split monitoring across core areas
- Sales: 3-5 new ICP-matched prospects
- Engineering: platform health, dependency, and CI/CD integrity reviews
- Legal: regulatory monitoring sweep
- Finance: provider and agent-role cost breakdown

Daily:
- Finance monitors spend and revenue changes
- SEO reviews keyword movement
- Social monitors engagement
- Operations runs health checks

Monthly:
- Finance updates unit economics
- Legal reviews compliance and tax obligations
- Research publishes industry trends summary$$ , 'all', 'system');

DELETE FROM founder_directives
WHERE tenant_id = '00000000-0000-0000-0000-000000000000'
  AND source = 'founder'
  AND title IN (
    'Dashboard & Platform Health Stabilization',
    'Establish Brand Voice & Identity System',
    'Competitive Landscape Research',
    'Slack AI Marketing Department Landing Page',
    'Still You Marketing Campaign Launch'
  );

INSERT INTO founder_directives (
  tenant_id,
  created_by,
  title,
  description,
  priority,
  category,
  target_agents,
  status,
  due_date,
  source
) VALUES
(
  '00000000-0000-0000-0000-000000000000',
  'kristina',
  'Dashboard & Platform Health Stabilization',
  $$CRITICAL: Fix the CTO death loop, activate history compression, clear blocked assignments, and reduce abort rate below 10 percent.

Sarah should decompose work across Marcus, Alex, Jordan, Sam, and Atlas. Success means CTO runs complete reliably, token pressure stays under control, blocked assignments drop below 10, and abort rate falls below 10 percent.$$,
  'critical',
  'engineering',
  ARRAY['chief-of-staff', 'cto', 'ops'],
  'active',
  NOW() + INTERVAL '5 days',
  'founder'
),
(
  '00000000-0000-0000-0000-000000000000',
  'kristina',
  'Establish Brand Voice & Identity System',
  $$CRITICAL: Make the brand guide the source of truth for voice, tone, messaging, and visual identity.

Sarah should decompose work across Maya, Mia, Tyler, Sofia, and Leo so the quick-reference card, compliance checklist, campaign copy, and design assets all align.$$,
  'critical',
  'marketing',
  ARRAY['chief-of-staff', 'cmo', 'vp-design'],
  'active',
  NOW() + INTERVAL '7 days',
  'founder'
),
(
  '00000000-0000-0000-0000-000000000000',
  'kristina',
  'Competitive Landscape Research',
  $$HIGH: Deliver an executive-ready competitive analysis of the autonomous AI workforce landscape.

Sarah should route this through Sophia, Lena, Daniel Okafor, Daniel Ortiz, and Priya so the result covers competitor profiles, market sizing, technical landscape, buyer behavior, and an ongoing monitoring cadence.$$,
  'high',
  'product',
  ARRAY['chief-of-staff', 'vp-research', 'cpo'],
  'active',
  NOW() + INTERVAL '10 days',
  'founder'
),
(
  '00000000-0000-0000-0000-000000000000',
  'kristina',
  'Slack AI Marketing Department Landing Page',
  $$HIGH: Build the landing page for Glyphor's Slack-integrated AI Marketing Department.

Sarah should coordinate design, copy, frontend implementation, and Prism compliance so the page ships with a clear value proposition, strong CTA, and accessible execution.$$,
  'high',
  'marketing',
  ARRAY['chief-of-staff', 'cmo', 'vp-design'],
  'active',
  NOW() + INTERVAL '10 days',
  'founder'
),
(
  '00000000-0000-0000-0000-000000000000',
  'kristina',
  'Still You Marketing Campaign Launch',
  $$HIGH: Launch the Still You campaign across social and supporting web surfaces after brand and landing-page dependencies are ready.

Sarah should route campaign planning, scheduling, SEO support, follow-up content, and microsite work across Maya, Kai, Lisa, Tyler, and Leo.$$,
  'high',
  'marketing',
  ARRAY['chief-of-staff', 'cmo', 'vp-sales'],
  'active',
  NOW() + INTERVAL '14 days',
  'founder'
);

DELETE FROM agent_briefs
WHERE tenant_id = '00000000-0000-0000-0000-000000000000'
  AND agent_id = ANY(ARRAY[
    'revenue-analyst', 'cost-analyst', 'support-triage', 'onboarding-specialist',
    'lead-gen-specialist', 'enterprise-account-researcher', 'account-research',
    'data-integrity-auditor', 'technical-research-analyst', 'industry-research-analyst',
    'tax-strategy-specialist', 'vp-customer-success', 'ai-impact-analyst', 'org-analyst'
  ]);

DELETE FROM agent_profiles
WHERE agent_id = ANY(ARRAY[
  'revenue-analyst', 'cost-analyst', 'support-triage', 'onboarding-specialist',
  'lead-gen-specialist', 'enterprise-account-researcher', 'account-research',
  'data-integrity-auditor', 'technical-research-analyst', 'industry-research-analyst',
  'tax-strategy-specialist', 'vp-customer-success', 'ai-impact-analyst', 'org-analyst'
]);

DELETE FROM agent_skills
WHERE agent_role = ANY(ARRAY[
  'revenue-analyst', 'cost-analyst', 'support-triage', 'onboarding-specialist',
  'lead-gen-specialist', 'enterprise-account-researcher', 'account-research',
  'data-integrity-auditor', 'technical-research-analyst', 'industry-research-analyst',
  'tax-strategy-specialist', 'vp-customer-success', 'ai-impact-analyst', 'org-analyst'
]);

DELETE FROM agent_reasoning_config
WHERE agent_role = ANY(ARRAY[
  'revenue-analyst', 'cost-analyst', 'support-triage', 'onboarding-specialist',
  'lead-gen-specialist', 'enterprise-account-researcher', 'account-research',
  'data-integrity-auditor', 'technical-research-analyst', 'industry-research-analyst',
  'tax-strategy-specialist', 'vp-customer-success', 'ai-impact-analyst', 'org-analyst'
]);

DELETE FROM proposed_skills
WHERE source_agent = ANY(ARRAY[
  'revenue-analyst', 'cost-analyst', 'support-triage', 'onboarding-specialist',
  'lead-gen-specialist', 'enterprise-account-researcher', 'account-research',
  'data-integrity-auditor', 'technical-research-analyst', 'industry-research-analyst',
  'tax-strategy-specialist', 'vp-customer-success', 'ai-impact-analyst', 'org-analyst'
]);

DELETE FROM company_agents
WHERE role = ANY(ARRAY[
  'revenue-analyst', 'cost-analyst', 'support-triage', 'onboarding-specialist',
  'lead-gen-specialist', 'enterprise-account-researcher', 'account-research',
  'data-integrity-auditor', 'technical-research-analyst', 'industry-research-analyst',
  'tax-strategy-specialist', 'vp-customer-success', 'ai-impact-analyst', 'org-analyst'
]);
