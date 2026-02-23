-- ════════════════════════════════════════════════════════════════════
-- Knowledge Management Migration
-- 
-- 1. company_knowledge_base — replaces static COMPANY_KNOWLEDGE_BASE.md
-- 2. founder_bulletins — broadcast messages from founders to agents
-- 3. Seeds knowledge base from current markdown content
-- 4. Seeds knowledge graph with foundational business nodes + edges
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. COMPANY KNOWLEDGE BASE TABLE ──────────────────────────────

CREATE TABLE IF NOT EXISTS company_knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all'
    CHECK (audience IN ('all', 'executives', 'engineering', 'finance',
           'product', 'marketing', 'sales', 'customer_success', 'design', 'operations')),
  last_edited_by TEXT DEFAULT 'system',
  version INT DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ckb_audience ON company_knowledge_base (audience) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_ckb_section ON company_knowledge_base (section);

-- ─── 2. FOUNDER BULLETINS TABLE ───────────────────────────────────

CREATE TABLE IF NOT EXISTS founder_bulletins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by TEXT NOT NULL,
  content TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all'
    CHECK (audience IN ('all', 'executives', 'engineering', 'finance',
           'product', 'marketing', 'sales', 'customer_success', 'design', 'operations')),
  priority TEXT DEFAULT 'normal'
    CHECK (priority IN ('fyi', 'normal', 'important', 'urgent')),
  active_from TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bulletins_active ON founder_bulletins (is_active, audience) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_bulletins_expires ON founder_bulletins (expires_at) WHERE is_active = true;

-- ─── 3. SEED KNOWLEDGE BASE ──────────────────────────────────────

INSERT INTO company_knowledge_base (section, title, content, audience) VALUES

('mission', 'Company Mission & Identity',
 E'**Glyphor** is an AI platform company. We build autonomous software that replaces entire development and creative teams. We are not a dev tool, not a copilot, not an assistant — we are the team itself.\n\n**Founded:** 2025\n**Headquarters:** Dallas, TX\n**Legal entity:** Glyphor Inc. (Delaware)',
 'all'),

('founders', 'Founders',
 E'**Kristina Denney** — CEO\n- Microsoft Director, Cloud & AI Platform Specialist — 6 years at Microsoft, leading cloud and AI platform strategy for Fortune 500 manufacturing and industrial enterprises\n- 25+ years in tech spanning North America, Europe, and Asia Pacific\n- Platinum Club (top 1% of 70,000+ sellers), 140% performance in FY24, $3M GitHub Copilot ACR, influenced $157M+ in technology investments\n- CliftonStrengths: Input, Analytical, Woo, Relator, Positivity\n- Available 5-10h/week for Glyphor (full-time at Microsoft)\n- Escalate to Kristina: Product direction, market positioning, brand voice, growth strategy, enterprise partnerships, content approval, competitive response, pricing, anything customer-facing\n\n**Andrew Zwelling** — COO\n- Microsoft Sr. Cloud & AI Platform Specialist, focused on Azure application development and ISV partnerships\n- MBA from Duke University (Fuqua), BA from Johns Hopkins University\n- Former Amazon Web Services — multiple leadership roles including Sr. Team Lead, Partnerships Manager for ISV Global Startups\n- Available 5-10h/week for Glyphor (full-time at Microsoft)\n- Escalate to Andrew: Spending decisions, infrastructure costs, operational risk, financial models, budget reallocation, partnership structures, production deploys',
 'all'),

('products', 'Products',
 E'**Fuse** — Autonomous Development Platform\nUsers describe what they want to build. Fuse''s AI agents design, code, and deploy complete web applications autonomously.\nTarget: Solo founders, small teams, non-technical builders, SMBs, enterprises replacing contractor teams\nTech stack: Next.js, TypeScript, Gemini 2.5 Pro/Flash, Supabase, Vercel, Cloud Run\nPricing: Free tier (3 builds/mo) → Pro $29/mo → Enterprise custom ($25K-50K/mo)\nColor identity: Electric blue (#60a5fa)\n\n**Pulse** — Autonomous Creative Platform\nAI agents create brand identities, marketing assets, social content, and design systems autonomously.\nTarget: Startups needing brand identity, marketing teams wanting to scale creative output\nStatus: Beta\nColor identity: Warm pink (#f472b6)',
 'all'),

('current_priorities', 'Current Priorities',
 E'1. Activate the AI agent workforce — all 27 agents running autonomously on schedules\n2. Fix telemetry blackout (P0) — platform reporting $0 costs and 0% build success\n3. Launch Fuse content marketing — blog posts, social, SEO\n4. Enterprise prospect research — identify first 5 target customers\n5. Establish data pipelines — Stripe, Mercury, GCP billing syncs running reliably',
 'all'),

('metrics', 'Current Metrics',
 E'MRR: $3,247 (+12% MoM)\nPaying users: 47 (Fuse: 39, Pulse: 8)\nBuild success rate: Fuse 91%, Pulse 89%\nInfrastructure cost MTD: $847\nGross margin: 62.3%\nActive agents: 27 (8 executives, 18 sub-team, 1 ops)\nSEO: ''ai website builder'' #11\nEnterprise pipeline: 3 prospects, $127K potential ARR',
 'all'),

('team_structure', 'Team Structure',
 E'CEO: Kristina Denney — strategy, sales, external\nCOO: Andrew Zwelling — operations, finance, infrastructure\n\nExecutive Team: Sarah (CoS), Marcus (CTO), Nadia (CFO), Elena (CPO), Maya (CMO), James (VP CS), Rachel (VP Sales), Mia (VP Design)\n\nEach executive manages 2-3 sub-team specialists. Atlas handles operations and system intelligence.\n\nThe Operating Model: Kristina and Andrew work full-time at Microsoft with 5-10 hours/week for Glyphor. Everything else is run by the AI executive team. Default to autonomous action. Batch communications. Decisions should arrive pre-analyzed.',
 'all'),

('culture', 'Culture & Communication',
 E'**Tone:** Direct. No filler. Data-first. Recommendation-included. Concise.\n**External content:** Bold, technical but accessible, authentic builder energy. Never disparage competitors.\n\nCommunication Rules:\n1. Morning briefings are sacred — Sarah delivers by 7:00/7:30 AM CT\n2. Decision cards, not paragraphs — use Adaptive Card format\n3. Tag the right person — Kristina: product/growth/brand. Andrew: cost/ops/risk\n4. Don''t spam — one structured message > five updates\n5. Weekly sync prep — Sarah prepares agenda, flag items by Sunday 6 PM CT',
 'all'),

('authority_model', 'Authority Model',
 E'**GREEN — Act Autonomously:** No approval needed. Log it. Mention in daily briefing.\nExamples: Routine monitoring, content within approved strategy, standard outreach, bug fixes to staging\n\n**YELLOW — One Founder Approval:** Post to #decisions with Adaptive Card. Auto-escalates to Red after 48h.\nExamples: Model changes >$50/mo (→Andrew), roadmap priority changes (→Kristina), infrastructure scaling >$200/mo (→Andrew), production deploys (→Andrew)\n\n**RED — Both Founders Required:** Discussed at weekly sync or ad-hoc if urgent.\nExamples: New product lines, pricing changes, architectural shifts, enterprise deals >$25K, budget reallocation, agent roster changes\n\nSub-team members: GREEN only. Executives: GREEN + can file YELLOW/RED decisions.',
 'all'),

('competitive_landscape', 'Competitive Landscape',
 E'Our position: We are NOT a copilot or code assistant. We are autonomous — the AI IS the team.\n\n| Competitor | What they do | Our advantage |\n|-----------|-------------|---------------|\n| Lovable | AI web app builder, co-pilot model | We''re autonomous, not assisted. Enterprise-grade. |\n| Bolt.new | Quick AI app prototyping | Speed-focused, no enterprise story |\n| Cursor | AI code editor | Developer tool, not a replacement |\n| Devin (Cognition) | Single AI software engineer | Single agent. We orchestrate teams. |\n| GitHub Copilot | Code completion | Augments devs, doesn''t replace them |\n| Canva AI / Runway | Creative AI tools | Pulse competes here — autonomous vs assisted |\n\nWhen discussing competitors: Be factual, not dismissive. Position on autonomy, enterprise readiness, and multi-product platform.',
 'all'),

('infrastructure', 'Infrastructure',
 E'| Service | Purpose | Cost |\n|---------|---------|------|\n| GCP Cloud Run | Agent execution, builds | ~$187/mo |\n| Gemini API | All AI inference | ~$412/mo |\n| Supabase | Database, realtime, auth | $125/mo |\n| Vercel | Frontend hosting | ~$67/mo |\n| GCS | Document storage | ~$5/mo |\n| Cloud Scheduler | Agent cron jobs | Free tier |\n| Pub/Sub | Event routing | Free tier |\n| **Total** | | **~$850/mo** |\n\nCost rules: Gemini API is biggest variable cost. Any service spike >20% WoW → Nadia flags to Andrew. Infrastructure scaling >$200/mo is Yellow. New service >$100/mo is Yellow.',
 'all'),

('pricing', 'Pricing Strategy',
 E'Fuse: Free tier (3 builds/mo) → Pro $29/mo → Enterprise custom ($25K-50K/mo)\nTarget enterprise: $10K-$75K/month subscriptions\nSegments: Starter ($10K), Growth ($25K), Enterprise ($50K-75K)\nModel: Per-seat + platform fee\nNot finalized — Rachel and Nadia collaborating on final model.',
 'all')

ON CONFLICT (section) DO NOTHING;

-- ─── 4. SEED KNOWLEDGE GRAPH ─────────────────────────────────────

-- Products
INSERT INTO kg_nodes (node_type, title, content, department, importance, tags, created_by, confidence)
VALUES
('product', 'Fuse', 'AI-powered autonomous development platform. Users describe what they want to build, and Fuse''s AI agents design, code, and deploy complete web applications autonomously. Current: 39 paying users, $2,847 MRR, 91% build success rate.', 'product', 1.0, ARRAY['fuse', 'product', 'core', 'development'], 'system', 1.0),
('product', 'Pulse', 'Autonomous creative platform. AI agents create brand identities, marketing assets, social content, and design systems. Status: Beta, 8 paying users, $400 MRR.', 'product', 0.9, ARRAY['pulse', 'product', 'core', 'creative'], 'system', 1.0)
ON CONFLICT DO NOTHING;

-- Architecture & Concepts
INSERT INTO kg_nodes (node_type, title, content, department, importance, tags, created_by, confidence)
VALUES
('concept', 'Multi-Agent Orchestration', 'Core architecture: 27 AI agents with distinct roles, skills, and authority levels coordinated by scheduler, event bus, and inter-agent messaging. 8 executives, 18 sub-team specialists, 1 ops agent (Atlas).', 'engineering', 0.9, ARRAY['architecture', 'agents', 'orchestration', 'core'], 'system', 1.0),
('concept', 'Authority Model', 'Three-tier governance: Green (autonomous), Yellow (one founder), Red (both founders). Enforced at runtime. Sub-team = GREEN only. Executives = GREEN + can file YELLOW/RED.', 'operations', 1.0, ARRAY['governance', 'authority', 'security', 'core'], 'system', 1.0),
('concept', 'Target Market', 'Fortune 2000 companies with 500+ engineers. Key verticals: manufacturing, financial services, technology. Pain point: developer velocity at scale. Also: solo founders, SMBs, non-technical builders.', 'sales', 0.8, ARRAY['market', 'enterprise', 'target', 'ICP'], 'system', 0.9)
ON CONFLICT DO NOTHING;

-- Competitive Landscape
INSERT INTO kg_nodes (node_type, title, content, department, importance, tags, created_by, confidence)
VALUES
('concept', 'Devin (Cognition)', 'Direct competitor. Single AI software engineer. Raised $2B+. Our differentiation: team-level orchestration vs individual agent. They are one agent; we are 27 coordinated agents.', 'product', 0.7, ARRAY['competitor', 'devin', 'cognition'], 'system', 0.9),
('concept', 'GitHub Copilot Workspace', 'Adjacent competitor. IDE-level AI assistance expanding toward agentic workflows. Our differentiation: autonomous teams vs copilot assistance. We replace teams; they augment individuals.', 'product', 0.7, ARRAY['competitor', 'github', 'copilot'], 'system', 0.9),
('concept', 'Lovable', 'Direct competitor in AI web app building. Co-pilot model vs our autonomous model. We are enterprise-grade; they focus on individual builders.', 'product', 0.7, ARRAY['competitor', 'lovable'], 'system', 0.9)
ON CONFLICT DO NOTHING;

-- Infrastructure
INSERT INTO kg_nodes (node_type, title, content, department, importance, tags, created_by, confidence)
VALUES
('concept', 'GCP Infrastructure', 'Platform runs on Google Cloud: Cloud Run (agents), Pub/Sub (events), Cloud Scheduler (cron), Cloud Storage (reports), Secret Manager (credentials). Region: us-central1.', 'engineering', 0.8, ARRAY['infrastructure', 'gcp', 'cloud-run'], 'system', 1.0),
('metric', 'Infrastructure Cost', 'Current spend ~$850/mo. Gemini API is largest line item (~$412/mo). Cloud Run ~$187/mo. Supabase ~$125/mo. Vercel ~$67/mo. Gross margin: 62.3%.', 'finance', 0.7, ARRAY['cost', 'infrastructure', 'budget', 'monthly'], 'system', 0.9)
ON CONFLICT DO NOTHING;

-- Risks
INSERT INTO kg_nodes (node_type, title, content, department, importance, tags, created_by, confidence)
VALUES
('risk', 'Telemetry Blackout', 'Platform reporting $0 costs, 0% build success rate, Teams integration failing HTTP 400. Suspected credential or Pub/Sub configuration issue. P0 priority — cannot monitor or optimize what we cannot see.', 'engineering', 1.0, ARRAY['incident', 'telemetry', 'p0', 'critical'], 'system', 1.0),
('risk', 'Pre-Revenue Risk', 'Company is pre-revenue at scale with ~$850/mo burn. MRR at $3,247 but need to reach sustainable revenue. First enterprise customer within 3-6 months to validate market.', 'finance', 0.8, ARRAY['revenue', 'runway', 'risk'], 'system', 0.9)
ON CONFLICT DO NOTHING;

-- Opportunities
INSERT INTO kg_nodes (node_type, title, content, department, importance, tags, created_by, confidence)
VALUES
('opportunity', 'Enterprise Pipeline', 'Three active prospects with $127K potential ARR. Enterprise motion leverages founders'' Microsoft relationships and Fortune 500 advisory experience.', 'sales', 0.9, ARRAY['enterprise', 'pipeline', 'revenue'], 'system', 0.8)
ON CONFLICT DO NOTHING;

-- ─── 5. SEED KNOWLEDGE GRAPH EDGES ───────────────────────────────
-- Connect nodes with meaningful relationships

-- Fuse → Target Market (enables)
INSERT INTO kg_edges (source_id, target_id, edge_type, strength, confidence, evidence)
SELECT s.id, t.id, 'enables', 0.9, 0.9, 'Fuse is the primary revenue product targeting the enterprise market'
FROM kg_nodes s, kg_nodes t
WHERE s.title = 'Fuse' AND s.node_type = 'product'
  AND t.title = 'Target Market' AND t.node_type = 'concept'
ON CONFLICT DO NOTHING;

-- Multi-Agent → GCP Infrastructure (depends_on)
INSERT INTO kg_edges (source_id, target_id, edge_type, strength, confidence, evidence)
SELECT s.id, t.id, 'depends_on', 0.95, 1.0, 'All 27 agents run on GCP Cloud Run infrastructure'
FROM kg_nodes s, kg_nodes t
WHERE s.title = 'Multi-Agent Orchestration' AND s.node_type = 'concept'
  AND t.title = 'GCP Infrastructure' AND t.node_type = 'concept'
ON CONFLICT DO NOTHING;

-- Telemetry Blackout → Infrastructure Cost (causes)
INSERT INTO kg_edges (source_id, target_id, edge_type, strength, confidence, evidence)
SELECT s.id, t.id, 'causes', 1.0, 1.0, 'Cannot monitor or optimize costs without working telemetry'
FROM kg_nodes s, kg_nodes t
WHERE s.title = 'Telemetry Blackout' AND s.node_type = 'risk'
  AND t.title = 'Infrastructure Cost' AND t.node_type = 'metric'
ON CONFLICT DO NOTHING;

-- Enterprise Pipeline → Pre-Revenue Risk (mitigates)
INSERT INTO kg_edges (source_id, target_id, edge_type, strength, confidence, evidence)
SELECT s.id, t.id, 'mitigates', 0.8, 0.8, 'Closing enterprise deals would address pre-revenue risk and validate market'
FROM kg_nodes s, kg_nodes t
WHERE s.title = 'Enterprise Pipeline' AND s.node_type = 'opportunity'
  AND t.title = 'Pre-Revenue Risk' AND t.node_type = 'risk'
ON CONFLICT DO NOTHING;

-- Authority Model → Multi-Agent Orchestration (enables)
INSERT INTO kg_edges (source_id, target_id, edge_type, strength, confidence, evidence)
SELECT s.id, t.id, 'enables', 0.9, 1.0, 'Authority model governs what agents can do autonomously vs requiring approval'
FROM kg_nodes s, kg_nodes t
WHERE s.title = 'Authority Model' AND s.node_type = 'concept'
  AND t.title = 'Multi-Agent Orchestration' AND t.node_type = 'concept'
ON CONFLICT DO NOTHING;

-- Fuse enables Pulse (related products)
INSERT INTO kg_edges (source_id, target_id, edge_type, strength, confidence, evidence)
SELECT s.id, t.id, 'relates_to', 0.7, 0.9, 'Same core runtime powers both products; shared infrastructure and agent architecture'
FROM kg_nodes s, kg_nodes t
WHERE s.title = 'Fuse' AND s.node_type = 'product'
  AND t.title = 'Pulse' AND t.node_type = 'product'
ON CONFLICT DO NOTHING;

-- Devin → Fuse (relates_to competitive)
INSERT INTO kg_edges (source_id, target_id, edge_type, strength, confidence, evidence)
SELECT s.id, t.id, 'relates_to', 0.8, 0.9, 'Direct competitor — single agent vs our multi-agent orchestration approach'
FROM kg_nodes s, kg_nodes t
WHERE s.title = 'Devin (Cognition)' AND s.node_type = 'concept'
  AND t.title = 'Fuse' AND t.node_type = 'product'
ON CONFLICT DO NOTHING;

-- ─── 6. SEED COMPANY PULSE (if not already populated) ────────────
-- Ensure the pulse row exists with current real values

INSERT INTO company_pulse (id, mrr, mrr_change_pct, active_users, platform_status, company_mood, highlights, updated_at)
VALUES (
  'current',
  3247,
  12.0,
  47,
  'degraded',
  'building',
  '[{"agent": "system", "type": "alert", "text": "Telemetry blackout under investigation (P0)"},{"agent": "system", "type": "positive", "text": "27 agents configured with roles and authority"},{"agent": "system", "type": "positive", "text": "Platform deployed on GCP Cloud Run"},{"agent": "system", "type": "neutral", "text": "Enterprise pipeline: 3 prospects, $127K potential ARR"}]'::jsonb,
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  mrr = EXCLUDED.mrr,
  mrr_change_pct = EXCLUDED.mrr_change_pct,
  active_users = EXCLUDED.active_users,
  platform_status = EXCLUDED.platform_status,
  company_mood = EXCLUDED.company_mood,
  highlights = EXCLUDED.highlights,
  updated_at = NOW();

-- ─── 7. ENABLE RLS ───────────────────────────────────────────────

ALTER TABLE company_knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder_bulletins ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Authenticated users can read knowledge base"
  ON company_knowledge_base FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage knowledge base"
  ON company_knowledge_base FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can read bulletins"
  ON founder_bulletins FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage bulletins"
  ON founder_bulletins FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Also allow service_role (for agents running server-side)
CREATE POLICY "Service role full access on knowledge base"
  ON company_knowledge_base FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access on bulletins"
  ON founder_bulletins FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
