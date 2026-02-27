-- ═══════════════════════════════════════════════════════════════════
-- KNOWLEDGE GRAPH: NODES + EDGES + RPCs + SEED DATA
-- ═══════════════════════════════════════════════════════════════════
-- Connected memory for connected agents. Stores events, facts,
-- patterns, metrics, entities and their causal/structural relationships
-- as a graph in PostgreSQL using recursive CTEs for traversal.

-- ═══════════════════════════════════════════════════════════════════
-- TABLE: kg_nodes
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS kg_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Node classification
  node_type TEXT NOT NULL,
  -- 'event'        — something that happened
  -- 'fact'         — verified knowledge
  -- 'observation'  — something an agent noticed
  -- 'pattern'      — a recurring phenomenon
  -- 'decision'     — a decision made
  -- 'metric'       — a measurable value at a point in time
  -- 'entity'       — a person, company, product, service
  -- 'goal'         — a company or department goal
  -- 'risk'         — an identified risk
  -- 'action'       — something an agent did
  -- 'hypothesis'   — an unverified theory

  -- Content
  title TEXT NOT NULL,
  content TEXT NOT NULL,

  -- Provenance
  created_by TEXT NOT NULL,

  -- Confidence and validation
  confidence DECIMAL(3,2) DEFAULT 0.7,
  times_validated INT DEFAULT 0,
  times_contradicted INT DEFAULT 0,

  -- Temporal
  occurred_at TIMESTAMPTZ,
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,

  -- Classification
  department TEXT,
  importance DECIMAL(3,2) DEFAULT 0.5,
  status TEXT DEFAULT 'active',

  -- Search
  embedding VECTOR(768),
  tags TEXT[] DEFAULT '{}',

  -- Metadata
  source_run_id UUID,
  source_type TEXT,
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kg_nodes_type ON kg_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_created_by ON kg_nodes(created_by);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_department ON kg_nodes(department);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_status ON kg_nodes(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_kg_nodes_tags ON kg_nodes USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_occurred ON kg_nodes(occurred_at DESC) WHERE occurred_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kg_nodes_embedding ON kg_nodes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ═══════════════════════════════════════════════════════════════════
-- TABLE: kg_edges
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS kg_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  source_id UUID NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,

  edge_type TEXT NOT NULL,
  -- CAUSAL: caused, contributed_to, prevented, mitigated
  -- TEMPORAL: preceded, followed, co_occurred
  -- KNOWLEDGE: supports, contradicts, supersedes, derived_from, validates
  -- STRUCTURAL: belongs_to, depends_on, affects, related_to
  -- AGENT: discovered_by, owned_by, assigned_to, resolved_by
  -- ACTION: responded_to, resulted_in, blocked_by

  strength DECIMAL(3,2) DEFAULT 0.7,
  confidence DECIMAL(3,2) DEFAULT 0.7,

  created_by TEXT NOT NULL,
  evidence TEXT,

  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(source_id, target_id, edge_type)
);

-- Traversal indexes
CREATE INDEX IF NOT EXISTS idx_kg_edges_source ON kg_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_target ON kg_edges(target_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_type ON kg_edges(edge_type);
CREATE INDEX IF NOT EXISTS idx_kg_edges_source_type ON kg_edges(source_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_kg_edges_target_type ON kg_edges(target_id, edge_type);

-- ═══════════════════════════════════════════════════════════════════
-- BACKFILL COLUMN: link agent_memory rows to their graph node
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS graph_node_id UUID REFERENCES kg_nodes(id);

-- ═══════════════════════════════════════════════════════════════════
-- RPC: match_kg_nodes — Semantic search on graph nodes
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION match_kg_nodes(
  query_embedding VECTOR(768),
  match_threshold DECIMAL DEFAULT 0.7,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  node_type TEXT,
  title TEXT,
  content TEXT,
  similarity DECIMAL
) AS $$
  SELECT
    n.id,
    n.node_type,
    n.title,
    n.content,
    (1 - (n.embedding <=> query_embedding))::DECIMAL AS similarity
  FROM kg_nodes n
  WHERE n.status = 'active'
    AND n.embedding IS NOT NULL
    AND 1 - (n.embedding <=> query_embedding) > match_threshold
  ORDER BY n.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE sql STABLE;

-- ═══════════════════════════════════════════════════════════════════
-- RPC: kg_trace_causes — Recursive backward causal traversal
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION kg_trace_causes(
  start_node_id UUID,
  max_depth INT DEFAULT 5
)
RETURNS TABLE (
  node_id UUID,
  node_type TEXT,
  title TEXT,
  content TEXT,
  depth INT,
  edge_type TEXT,
  edge_strength DECIMAL,
  path UUID[]
) AS $$
WITH RECURSIVE causal_chain AS (
  SELECT
    n.id AS node_id,
    n.node_type,
    n.title,
    n.content,
    0 AS depth,
    NULL::TEXT AS edge_type,
    NULL::DECIMAL AS edge_strength,
    ARRAY[n.id] AS path
  FROM kg_nodes n
  WHERE n.id = start_node_id

  UNION ALL

  SELECT
    n.id,
    n.node_type,
    n.title,
    n.content,
    cc.depth + 1,
    e.edge_type,
    e.strength,
    cc.path || n.id
  FROM causal_chain cc
  JOIN kg_edges e ON e.target_id = cc.node_id
    AND e.edge_type IN ('caused', 'contributed_to')
    AND e.valid_until IS NULL
  JOIN kg_nodes n ON n.id = e.source_id
    AND n.status = 'active'
  WHERE cc.depth < max_depth
    AND NOT (n.id = ANY(cc.path))
)
SELECT * FROM causal_chain
WHERE depth > 0
ORDER BY depth;
$$ LANGUAGE sql STABLE;

-- ═══════════════════════════════════════════════════════════════════
-- RPC: kg_trace_impact — Recursive forward impact traversal
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION kg_trace_impact(
  start_node_id UUID,
  max_depth INT DEFAULT 5
)
RETURNS TABLE (
  node_id UUID,
  node_type TEXT,
  title TEXT,
  content TEXT,
  depth INT,
  edge_type TEXT,
  edge_strength DECIMAL,
  path UUID[]
) AS $$
WITH RECURSIVE impact_chain AS (
  SELECT
    n.id AS node_id,
    n.node_type,
    n.title,
    n.content,
    0 AS depth,
    NULL::TEXT AS edge_type,
    NULL::DECIMAL AS edge_strength,
    ARRAY[n.id] AS path
  FROM kg_nodes n
  WHERE n.id = start_node_id

  UNION ALL

  SELECT
    n.id,
    n.node_type,
    n.title,
    n.content,
    ic.depth + 1,
    e.edge_type,
    e.strength,
    ic.path || n.id
  FROM impact_chain ic
  JOIN kg_edges e ON e.source_id = ic.node_id
    AND e.edge_type IN ('caused', 'contributed_to', 'resulted_in', 'affects')
    AND e.valid_until IS NULL
  JOIN kg_nodes n ON n.id = e.target_id
    AND n.status = 'active'
  WHERE ic.depth < max_depth
    AND NOT (n.id = ANY(ic.path))
)
SELECT * FROM impact_chain
WHERE depth > 0
ORDER BY depth;
$$ LANGUAGE sql STABLE;

-- ═══════════════════════════════════════════════════════════════════
-- RPC: kg_neighborhood — N-hop neighborhood expansion
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION kg_neighborhood(
  start_node_id UUID,
  max_depth INT DEFAULT 2
)
RETURNS TABLE (
  node_id UUID,
  node_type TEXT,
  title TEXT,
  content TEXT,
  depth INT,
  relationship TEXT,
  direction TEXT
) AS $$
WITH RECURSIVE neighborhood AS (
  SELECT
    n.id AS node_id,
    n.node_type,
    n.title,
    n.content,
    0 AS depth,
    NULL::TEXT AS relationship,
    NULL::TEXT AS direction,
    ARRAY[n.id] AS visited
  FROM kg_nodes n
  WHERE n.id = start_node_id

  UNION ALL

  SELECT
    n.id, n.node_type, n.title, n.content,
    nb.depth + 1,
    e.edge_type,
    CASE WHEN e.source_id = nb.node_id THEN 'outgoing' ELSE 'incoming' END,
    nb.visited || n.id
  FROM neighborhood nb
  JOIN kg_edges e
    ON (e.source_id = nb.node_id OR e.target_id = nb.node_id)
    AND e.valid_until IS NULL
  JOIN kg_nodes n
    ON n.id = CASE WHEN e.source_id = nb.node_id THEN e.target_id ELSE e.source_id END
    AND n.status = 'active'
  WHERE nb.depth < max_depth AND NOT (n.id = ANY(nb.visited))
)
SELECT DISTINCT ON (node_id) node_id, node_type, title, content, depth, relationship, direction
FROM neighborhood
WHERE depth > 0
ORDER BY node_id, depth;
$$ LANGUAGE sql STABLE;

-- ═══════════════════════════════════════════════════════════════════
-- RPC: kg_semantic_search_with_context — Hybrid semantic + graph
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION kg_semantic_search_with_context(
  query_embedding VECTOR(768),
  match_threshold DECIMAL DEFAULT 0.7,
  match_count INT DEFAULT 5,
  expand_hops INT DEFAULT 1
)
RETURNS TABLE (
  node_id UUID,
  node_type TEXT,
  title TEXT,
  content TEXT,
  similarity DECIMAL,
  is_direct_match BOOLEAN,
  connected_via TEXT,
  connected_from TEXT
) AS $$
WITH
direct_matches AS (
  SELECT
    n.id,
    n.node_type,
    n.title,
    n.content,
    (1 - (n.embedding <=> query_embedding))::DECIMAL AS similarity
  FROM kg_nodes n
  WHERE n.status = 'active'
    AND n.embedding IS NOT NULL
    AND 1 - (n.embedding <=> query_embedding) > match_threshold
  ORDER BY n.embedding <=> query_embedding
  LIMIT match_count
),
expanded AS (
  SELECT DISTINCT ON (n.id)
    n.id,
    n.node_type,
    n.title,
    n.content,
    (dm.similarity * e.strength)::DECIMAL AS similarity,
    FALSE AS is_direct_match,
    e.edge_type AS connected_via,
    dm.title AS connected_from
  FROM direct_matches dm
  JOIN kg_edges e ON (e.source_id = dm.id OR e.target_id = dm.id) AND e.valid_until IS NULL
  JOIN kg_nodes n ON n.id = CASE
    WHEN e.source_id = dm.id THEN e.target_id
    ELSE e.source_id
  END
  WHERE n.status = 'active'
    AND n.id NOT IN (SELECT id FROM direct_matches)
    AND expand_hops >= 1
  ORDER BY n.id, (dm.similarity * e.strength)::DECIMAL DESC
)
SELECT id, node_type, title, content, similarity, TRUE, NULL::TEXT, NULL::TEXT FROM direct_matches
UNION ALL
SELECT id, node_type, title, content, similarity, is_direct_match, connected_via, connected_from FROM expanded
ORDER BY similarity DESC;
$$ LANGUAGE sql STABLE;

-- ═══════════════════════════════════════════════════════════════════
-- RPC: find_unconnected_similar_nodes — For auto-connect backfill
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION find_unconnected_similar_nodes(
  similarity_threshold DECIMAL DEFAULT 0.8,
  max_pairs INT DEFAULT 50
)
RETURNS TABLE (
  node_a_id UUID, node_a_title TEXT, node_a_content TEXT,
  node_b_id UUID, node_b_title TEXT, node_b_content TEXT,
  similarity DECIMAL
) AS $$
  SELECT
    a.id, a.title, a.content,
    b.id, b.title, b.content,
    (1 - (a.embedding <=> b.embedding))::DECIMAL AS similarity
  FROM kg_nodes a
  CROSS JOIN kg_nodes b
  WHERE a.id < b.id
    AND a.status = 'active'
    AND b.status = 'active'
    AND a.embedding IS NOT NULL
    AND b.embedding IS NOT NULL
    AND 1 - (a.embedding <=> b.embedding) > similarity_threshold
    AND NOT EXISTS (
      SELECT 1 FROM kg_edges e
      WHERE (e.source_id = a.id AND e.target_id = b.id)
         OR (e.source_id = b.id AND e.target_id = a.id)
    )
  ORDER BY similarity DESC
  LIMIT max_pairs;
$$ LANGUAGE sql STABLE;

-- ═══════════════════════════════════════════════════════════════════
-- SEED DATA: Entity nodes (permanent reference nodes)
-- ═══════════════════════════════════════════════════════════════════

INSERT INTO kg_nodes (node_type, title, content, created_by, status, importance) VALUES
-- Products
('entity', 'Fuse', 'Autonomous development platform - Glyphor product', 'system', 'active', 1.0),
('entity', 'Pulse', 'Autonomous creative platform - Glyphor product', 'system', 'active', 1.0),
-- Infrastructure
('entity', 'Gemini API', 'Google Gemini LLM API - primary model provider', 'system', 'active', 0.9),
('entity', 'Cloud Run', 'Google Cloud Run - primary compute infrastructure', 'system', 'active', 0.9),
('entity', 'Supabase', 'PostgreSQL database - primary data store', 'system', 'active', 0.9),
('entity', 'Stripe', 'Payment processing - subscription billing', 'system', 'active', 0.9),
('entity', 'Mercury', 'Business banking - operating account', 'system', 'active', 0.8),
('entity', 'GitHub', 'Source control and CI/CD', 'system', 'active', 0.8),
('entity', 'Vercel', 'Frontend hosting - dashboard and marketing', 'system', 'active', 0.8),
-- Departments
('entity', 'Engineering', 'Engineering department - CTO team', 'system', 'active', 0.8),
('entity', 'Finance', 'Finance department - CFO team', 'system', 'active', 0.8),
('entity', 'Marketing', 'Marketing department - CMO team', 'system', 'active', 0.8),
('entity', 'Product', 'Product department - CPO team', 'system', 'active', 0.8),
('entity', 'Customer Success', 'Customer Success department', 'system', 'active', 0.8),
('entity', 'Sales', 'Sales department', 'system', 'active', 0.8),
('entity', 'Design', 'Design department', 'system', 'active', 0.8),
-- Key concepts / metrics
('entity', 'MRR', 'Monthly Recurring Revenue - primary business metric', 'system', 'active', 1.0),
('entity', 'Churn', 'Customer churn - users leaving the platform', 'system', 'active', 0.9),
('entity', 'Build Time', 'Time to generate a website - key UX metric', 'system', 'active', 0.9),
('entity', 'Onboarding', 'New user onboarding flow', 'system', 'active', 0.8),
-- People
('entity', 'Kristina', 'CEO and co-founder of Glyphor', 'system', 'active', 1.0),
('entity', 'Andrew', 'COO and co-founder of Glyphor', 'system', 'active', 1.0)
ON CONFLICT DO NOTHING;
