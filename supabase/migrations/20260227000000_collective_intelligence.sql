-- ═══════════════════════════════════════════════════════════════════
-- COLLECTIVE INTELLIGENCE ARCHITECTURE
-- 6 new tables + 2 modified tables for organizational cognition
-- ═══════════════════════════════════════════════════════════════════

-- ─── LAYER 1: SHARED SITUATIONAL AWARENESS ──────────────────────

-- Company Pulse — singleton, real-time company vitals
CREATE TABLE IF NOT EXISTS company_pulse (
  id TEXT PRIMARY KEY DEFAULT 'current',

  -- Business vitals (updated by Nadia/Anna)
  mrr DECIMAL(10,2),
  mrr_change_pct DECIMAL(5,2),
  active_users INT,
  new_users_today INT,
  churn_events_today INT,

  -- Platform vitals (updated by Marcus/Atlas)
  platform_status TEXT DEFAULT 'green',         -- 'green', 'yellow', 'red'
  uptime_streak_days INT DEFAULT 0,
  active_incidents INT DEFAULT 0,
  avg_build_time_ms INT,

  -- Activity vitals (updated by Sarah)
  decisions_pending INT DEFAULT 0,
  meetings_today INT DEFAULT 0,
  messages_today INT DEFAULT 0,

  -- Highlights (top 3 things happening right now)
  highlights JSONB DEFAULT '[]'::JSONB,

  -- Mood (derived from recent agent reflections)
  company_mood TEXT DEFAULT 'steady',           -- 'thriving', 'steady', 'stressed', 'critical'

  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the singleton row
INSERT INTO company_pulse (id) VALUES ('current')
ON CONFLICT (id) DO NOTHING;

-- ─── LAYER 2: KNOWLEDGE CIRCULATION ─────────────────────────────

-- Company Knowledge — organizational knowledge (cross-functional)
CREATE TABLE IF NOT EXISTS company_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  knowledge_type TEXT NOT NULL CHECK (knowledge_type IN (
    'cross_functional', 'causal_link', 'policy',
    'constraint', 'capability', 'risk', 'opportunity'
  )),

  content TEXT NOT NULL,
  evidence TEXT,

  -- Provenance
  discovered_by TEXT,
  contributing_agents TEXT[] DEFAULT '{}',
  discovery_context TEXT,

  -- Scope
  departments_affected TEXT[] DEFAULT '{}',
  agents_who_need_this TEXT[] DEFAULT '{}',

  -- Lifecycle
  confidence DECIMAL(3,2) DEFAULT 0.70,
  times_validated INT DEFAULT 1,
  times_contradicted INT DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'deprecated')),
  superseded_by UUID REFERENCES company_knowledge(id),

  -- Retrieval
  embedding vector(768),
  tags TEXT[] DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_validated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for semantic search on company knowledge
CREATE INDEX IF NOT EXISTS idx_company_knowledge_embedding
  ON company_knowledge
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_company_knowledge_status
  ON company_knowledge (status);

CREATE INDEX IF NOT EXISTS idx_company_knowledge_type
  ON company_knowledge (knowledge_type);

-- Semantic search function for company knowledge
CREATE OR REPLACE FUNCTION match_company_knowledge(
  query_embedding vector(768),
  match_agent TEXT DEFAULT NULL,
  match_department TEXT DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 15
)
RETURNS TABLE (
  id UUID,
  knowledge_type TEXT,
  content TEXT,
  evidence TEXT,
  discovered_by TEXT,
  departments_affected TEXT[],
  agents_who_need_this TEXT[],
  confidence DECIMAL,
  tags TEXT[],
  created_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    ck.id,
    ck.knowledge_type,
    ck.content,
    ck.evidence,
    ck.discovered_by,
    ck.departments_affected,
    ck.agents_who_need_this,
    ck.confidence,
    ck.tags,
    ck.created_at,
    1 - (ck.embedding <=> query_embedding) AS similarity
  FROM company_knowledge ck
  WHERE ck.status = 'active'
    AND ck.embedding IS NOT NULL
    AND (
      match_agent IS NULL
      OR match_agent = ANY(ck.agents_who_need_this)
      OR array_length(ck.agents_who_need_this, 1) IS NULL
    )
    AND (
      match_department IS NULL
      OR match_department = ANY(ck.departments_affected)
      OR array_length(ck.departments_affected, 1) IS NULL
    )
    AND 1 - (ck.embedding <=> query_embedding) > match_threshold
  ORDER BY ck.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Knowledge Routes — rules for automatic knowledge circulation
CREATE TABLE IF NOT EXISTS knowledge_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Routing rule
  source_agent TEXT,                           -- who generates (null = any)
  source_tags TEXT[] DEFAULT '{}',             -- tag patterns that trigger routing
  source_type TEXT,                            -- knowledge type that triggers routing

  target_agents TEXT[] DEFAULT '{}',           -- who should receive
  target_departments TEXT[] DEFAULT '{}',      -- or route to entire departments

  -- Delivery
  delivery_method TEXT DEFAULT 'inject' CHECK (delivery_method IN ('inject', 'message', 'alert')),

  -- Metadata
  description TEXT,
  active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial knowledge routes
INSERT INTO knowledge_routes (source_tags, source_type, target_agents, delivery_method, description)
VALUES
  ('{cost,infrastructure,spike}', 'pattern', '{cfo,ops}', 'inject',
   'Cost-related patterns always reach CFO and Ops'),
  ('{security,incident,outage}', 'caution', '{cto,ops}', 'alert',
   'Security and incident warnings immediately reach CTO and Ops'),
  ('{competitor,market,threat}', 'pattern', '{cpo,cmo,vp-sales}', 'inject',
   'Competitive patterns reach Product, Marketing, and Sales'),
  ('{quality,design,output}', 'pattern', '{vp-design,design-critic,cpo}', 'inject',
   'Quality patterns reach Design leadership and Product'),
  ('{churn,customer,satisfaction}', 'pattern', '{vp-customer-success,vp-sales,cpo}', 'inject',
   'Customer signals reach CS, Sales, and Product'),
  ('{revenue,pricing,conversion}', 'pattern', '{cfo,vp-sales}', 'inject',
   'Revenue patterns reach Finance and Sales')
ON CONFLICT DO NOTHING;

-- Knowledge Inbox — pending knowledge deliveries
CREATE TABLE IF NOT EXISTS knowledge_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_agent TEXT NOT NULL,
  knowledge_id UUID,                           -- optional reference to agent_memory
  source_agent TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'consumed', 'dismissed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_inbox_target
  ON knowledge_inbox (target_agent, status);

-- ─── LAYER 3: ORGANIZATIONAL LEARNING ───────────────────────────

-- Process Patterns — discovered workflow/bottleneck/collaboration patterns
CREATE TABLE IF NOT EXISTS process_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  pattern_type TEXT NOT NULL CHECK (pattern_type IN (
    'workflow', 'bottleneck', 'collaboration',
    'failure_chain', 'success_chain', 'waste'
  )),

  description TEXT NOT NULL,
  evidence TEXT NOT NULL,
  frequency INT DEFAULT 1,

  -- Impact
  impact_type TEXT CHECK (impact_type IN ('efficiency', 'quality', 'cost', 'speed', 'risk')),
  impact_magnitude TEXT CHECK (impact_magnitude IN ('high', 'medium', 'low')),

  -- Response
  suggested_action TEXT,
  action_type TEXT CHECK (action_type IN ('automate', 'eliminate', 'restructure', 'monitor')),
  implemented BOOLEAN DEFAULT false,

  agents_involved TEXT[] DEFAULT '{}',
  departments_involved TEXT[] DEFAULT '{}',

  discovered_by TEXT DEFAULT 'chief-of-staff',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Authority Proposals — evidence-based governance changes
CREATE TABLE IF NOT EXISTS authority_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  agent_id TEXT NOT NULL,
  current_tier TEXT NOT NULL,
  proposed_tier TEXT NOT NULL,
  action TEXT NOT NULL,

  -- Evidence
  evidence TEXT NOT NULL,
  success_count INT,
  total_count INT,
  approval_rate DECIMAL(5,2),
  avg_wait_hours DECIMAL(5,2),
  negative_outcomes INT DEFAULT 0,

  status TEXT DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected')),
  proposed_by TEXT DEFAULT 'chief-of-staff',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── RLS POLICIES ───────────────────────────────────────────────

ALTER TABLE company_pulse ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE authority_proposals ENABLE ROW LEVEL SECURITY;

-- Service role (agents) gets full access
CREATE POLICY "Service role full access" ON company_pulse
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON company_knowledge
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON knowledge_routes
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON knowledge_inbox
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON process_patterns
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON authority_proposals
  FOR ALL USING (auth.role() = 'service_role');

-- Anon (dashboard) gets read access
CREATE POLICY "Anon read access" ON company_pulse
  FOR SELECT USING (auth.role() = 'anon');
CREATE POLICY "Anon read access" ON company_knowledge
  FOR SELECT USING (auth.role() = 'anon');
CREATE POLICY "Anon read access" ON knowledge_routes
  FOR SELECT USING (auth.role() = 'anon');
CREATE POLICY "Anon read access" ON knowledge_inbox
  FOR SELECT USING (auth.role() = 'anon');
CREATE POLICY "Anon read access" ON process_patterns
  FOR SELECT USING (auth.role() = 'anon');
CREATE POLICY "Anon read access" ON authority_proposals
  FOR SELECT USING (auth.role() = 'anon');
