-- ═══════════════════════════════════════════════════════════════════
-- Migration: World Model Architecture
-- Date: 2026-03-27
--
-- Creates 4 new tables for the agent classification + shared memory +
-- world modeling framework:
--   1. shared_episodes — Cross-agent episodic memory (Layer 2)
--   2. shared_procedures — Reusable playbooks (Layer 4)
--   3. role_rubrics — Multi-dimensional quality rubrics
--   4. agent_world_model — Per-agent self-model (Layer 5)
--
-- Plus RPC functions for semantic episode search and access tracking.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- TABLE: shared_episodes
-- Layer 2: Episodic Memory — warm, recent experiences shared across
-- all agents. Every meaningful agent run writes an episode.
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shared_episodes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Who and what
  author_agent  TEXT NOT NULL,
  episode_type  TEXT NOT NULL CHECK (episode_type IN (
    'task_completed', 'discovery', 'decision_made', 'problem_solved',
    'customer_interaction', 'market_signal', 'system_event',
    'collaboration', 'failure_lesson', 'process_improvement'
  )),

  -- Content
  summary       TEXT NOT NULL,
  detail        JSONB,
  outcome       TEXT,
  confidence    REAL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),

  -- Classification
  domains       TEXT[] NOT NULL DEFAULT '{}',
  tags          TEXT[] DEFAULT '{}',
  related_agents TEXT[] DEFAULT '{}',
  directive_id  UUID,
  assignment_id UUID,

  -- Semantic search
  embedding     vector(768),

  -- Lifecycle
  times_accessed INT DEFAULT 0,
  promoted_to_semantic BOOLEAN DEFAULT false,
  archived_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_episodes_domains ON shared_episodes USING GIN(domains);
CREATE INDEX IF NOT EXISTS idx_episodes_embedding ON shared_episodes USING ivfflat(embedding vector_cosine_ops) WITH (lists = 50);
CREATE INDEX IF NOT EXISTS idx_episodes_created ON shared_episodes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_type ON shared_episodes(episode_type);
CREATE INDEX IF NOT EXISTS idx_episodes_author ON shared_episodes(author_agent);
CREATE INDEX IF NOT EXISTS idx_episodes_tags ON shared_episodes USING GIN(tags);

-- ───────────────────────────────────────────────────────────────────
-- TABLE: shared_procedures
-- Layer 4: Procedural Memory — proven playbooks discovered by agents
-- that become reusable across the organization.
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shared_procedures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Identity
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  domain        TEXT NOT NULL,

  -- Content
  description   TEXT NOT NULL,
  steps         JSONB NOT NULL,
  preconditions TEXT[] DEFAULT '{}',
  tools_needed  TEXT[] DEFAULT '{}',
  example_input TEXT,
  example_output TEXT,

  -- Provenance
  discovered_by TEXT,
  validated_by  TEXT[] DEFAULT '{}',
  source_episodes UUID[] DEFAULT '{}',

  -- Quality
  times_used    INT DEFAULT 0,
  success_rate  REAL CHECK (success_rate IS NULL OR (success_rate >= 0 AND success_rate <= 1)),
  version       INT DEFAULT 1,
  status        TEXT DEFAULT 'proposed' CHECK (status IN (
    'proposed', 'active', 'deprecated'
  ))
);

CREATE INDEX IF NOT EXISTS idx_procedures_domain ON shared_procedures(domain);
CREATE INDEX IF NOT EXISTS idx_procedures_status ON shared_procedures(status);
CREATE INDEX IF NOT EXISTS idx_procedures_slug ON shared_procedures(slug);

-- ───────────────────────────────────────────────────────────────────
-- TABLE: role_rubrics
-- Multi-dimensional quality rubrics per role + task type.
-- Replaces the generic 0-100 quality_score with graded assessment.
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS role_rubrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role          TEXT NOT NULL,
  task_type     TEXT NOT NULL,
  version       INT DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Dimensions (3-6 per rubric) as JSONB array
  -- Each: { name, weight, levels: { 1_novice, 2_developing, 3_competent, 4_expert, 5_master } }
  dimensions    JSONB NOT NULL,

  -- Passing thresholds
  passing_score  REAL DEFAULT 3.0,
  excellence_score REAL DEFAULT 4.2,

  UNIQUE(role, task_type, version)
);

CREATE INDEX IF NOT EXISTS idx_rubrics_role_task ON role_rubrics(role, task_type);

-- ───────────────────────────────────────────────────────────────────
-- TABLE: agent_world_model
-- Layer 5: Per-agent self-model that evolves over time through the
-- reflection → grading → update loop.
-- ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_world_model (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_role      TEXT UNIQUE NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Self-awareness
  strengths           JSONB DEFAULT '[]',   -- [{dimension, evidence, confidence}]
  weaknesses          JSONB DEFAULT '[]',   -- [{dimension, evidence, confidence}]
  blindspots          JSONB DEFAULT '[]',   -- Identified by orchestrators/peers
  preferred_approaches JSONB DEFAULT '{}',  -- {task_type: approach_description}
  failure_patterns    JSONB DEFAULT '[]',   -- [{pattern, occurrences, lastSeen}]

  -- Capability model
  task_type_scores    JSONB DEFAULT '{}',   -- {task_type: {avgScore, count, trend}}
  tool_proficiency    JSONB DEFAULT '{}',   -- {tool_name: {successRate, avgTimeMs}}
  collaboration_map   JSONB DEFAULT '{}',   -- {agent_role: {quality, friction}}

  -- Predictions
  last_predictions    JSONB DEFAULT '[]',   -- [{predicted, actual, delta, timestamp}]
  prediction_accuracy REAL DEFAULT 0.5,     -- Rolling accuracy 0-1

  -- Growth trajectory
  improvement_goals   JSONB DEFAULT '[]',   -- [{dimension, currentScore, targetScore, strategy, progress}]
  rubric_version      INT DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_world_model_role ON agent_world_model(agent_role);

-- ───────────────────────────────────────────────────────────────────
-- RPC: match_shared_episodes
-- Semantic search across shared episodes using pgvector.
-- ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION match_shared_episodes(
  query_embedding vector(768),
  match_threshold REAL DEFAULT 0.6,
  match_count INT DEFAULT 5,
  filter_domains TEXT[] DEFAULT NULL,
  since TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  created_at TIMESTAMPTZ,
  author_agent TEXT,
  episode_type TEXT,
  summary TEXT,
  detail JSONB,
  outcome TEXT,
  confidence REAL,
  domains TEXT[],
  tags TEXT[],
  related_agents TEXT[],
  directive_id UUID,
  assignment_id UUID,
  times_accessed INT,
  promoted_to_semantic BOOLEAN,
  archived_at TIMESTAMPTZ,
  similarity REAL
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.created_at,
    e.author_agent,
    e.episode_type,
    e.summary,
    e.detail,
    e.outcome,
    e.confidence,
    e.domains,
    e.tags,
    e.related_agents,
    e.directive_id,
    e.assignment_id,
    e.times_accessed,
    e.promoted_to_semantic,
    e.archived_at,
    (1 - (e.embedding <=> query_embedding))::REAL AS similarity
  FROM shared_episodes e
  WHERE
    e.embedding IS NOT NULL
    AND e.archived_at IS NULL
    AND (1 - (e.embedding <=> query_embedding)) > match_threshold
    AND (filter_domains IS NULL OR e.domains && filter_domains)
    AND (since IS NULL OR e.created_at >= since)
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- RPC: increment_episode_access
-- Fire-and-forget counter for tracking episode usage.
-- ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION increment_episode_access(episode_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE shared_episodes
  SET times_accessed = times_accessed + 1
  WHERE id = ANY(episode_ids);
END;
$$;

-- ───────────────────────────────────────────────────────────────────
-- SEED: Default rubrics for the 9 executive roles
-- ───────────────────────────────────────────────────────────────────

-- Default rubric (fallback for any role/task not explicitly defined)
INSERT INTO role_rubrics (role, task_type, version, dimensions, passing_score, excellence_score)
VALUES (
  'default', 'general', 1,
  '[
    {"name": "accuracy", "weight": 0.30, "levels": {"1_novice": "Contains factual errors or unsupported claims", "2_developing": "Mostly accurate with minor gaps", "3_competent": "Accurate and well-sourced", "4_expert": "Accurate, nuanced, with original insight", "5_master": "Definitive, adds knowledge not previously captured"}},
    {"name": "actionability", "weight": 0.25, "levels": {"1_novice": "No clear next steps", "2_developing": "Vague suggestions", "3_competent": "Clear, specific next steps", "4_expert": "Prioritized action plan with tradeoffs", "5_master": "Decision-ready with options, risks, and recommendations"}},
    {"name": "completeness", "weight": 0.25, "levels": {"1_novice": "Major gaps in coverage", "2_developing": "Key areas addressed but thin", "3_competent": "Comprehensive coverage of scope", "4_expert": "Thorough with edge cases considered", "5_master": "Exhaustive, anticipates follow-up questions"}},
    {"name": "clarity", "weight": 0.20, "levels": {"1_novice": "Confusing or poorly structured", "2_developing": "Understandable but disorganized", "3_competent": "Clear, well-structured", "4_expert": "Elegant, easy to act on", "5_master": "Teachable to others, exemplary communication"}}
  ]'::JSONB,
  3.0, 4.2
) ON CONFLICT (role, task_type, version) DO NOTHING;

-- CMO: Content Creation rubric
INSERT INTO role_rubrics (role, task_type, version, dimensions, passing_score, excellence_score)
VALUES (
  'cmo', 'content_creation', 1,
  '[
    {"name": "brand_alignment", "weight": 0.25, "levels": {"1_novice": "Off-brand tone or messaging", "2_developing": "Partially aligned", "3_competent": "Consistent with brand guide", "4_expert": "Strengthens brand positioning", "5_master": "Elevates brand positioning"}},
    {"name": "audience_targeting", "weight": 0.20, "levels": {"1_novice": "Generic, no clear audience", "2_developing": "Broad audience awareness", "3_competent": "Right persona, right platform", "4_expert": "Deep audience insight", "5_master": "Resonates deeply, drives action"}},
    {"name": "originality", "weight": 0.20, "levels": {"1_novice": "Rehashed or generic", "2_developing": "Some fresh angles", "3_competent": "Fresh angle", "4_expert": "Novel perspective", "5_master": "Category-defining perspective"}},
    {"name": "seo_discoverability", "weight": 0.15, "levels": {"1_novice": "No keyword strategy", "2_developing": "Basic keywords present", "3_competent": "Keywords integrated naturally", "4_expert": "Strategic keyword placement", "5_master": "Captures high-intent queries"}},
    {"name": "call_to_action", "weight": 0.20, "levels": {"1_novice": "Missing or weak CTA", "2_developing": "Generic CTA", "3_competent": "Clear, relevant CTA", "4_expert": "Compelling CTA", "5_master": "Compelling, conversion-optimized"}}
  ]'::JSONB,
  3.0, 4.2
) ON CONFLICT (role, task_type, version) DO NOTHING;

-- CFO: Financial Analysis rubric
INSERT INTO role_rubrics (role, task_type, version, dimensions, passing_score, excellence_score)
VALUES (
  'cfo', 'financial_analysis', 1,
  '[
    {"name": "accuracy", "weight": 0.30, "levels": {"1_novice": "Calculation errors", "2_developing": "Mostly correct", "3_competent": "Correct with source data", "4_expert": "Validated against multiple sources", "5_master": "Cross-validated with multiple sources"}},
    {"name": "insight_depth", "weight": 0.25, "levels": {"1_novice": "Surface-level numbers", "2_developing": "Basic trend identification", "3_competent": "Trend identification", "4_expert": "Causal analysis", "5_master": "Causal analysis with recommendations"}},
    {"name": "risk_identification", "weight": 0.20, "levels": {"1_novice": "Risks not mentioned", "2_developing": "Some risks noted", "3_competent": "Key risks flagged", "4_expert": "Risk scenarios outlined", "5_master": "Quantified risk scenarios"}},
    {"name": "actionability", "weight": 0.25, "levels": {"1_novice": "Data dump", "2_developing": "Some suggestions", "3_competent": "Clear next steps", "4_expert": "Prioritized recommendations", "5_master": "Decision-ready with options and tradeoffs"}}
  ]'::JSONB,
  3.0, 4.2
) ON CONFLICT (role, task_type, version) DO NOTHING;

-- CTO: Engineering Output rubric
INSERT INTO role_rubrics (role, task_type, version, dimensions, passing_score, excellence_score)
VALUES (
  'cto', 'engineering_output', 1,
  '[
    {"name": "technical_accuracy", "weight": 0.30, "levels": {"1_novice": "Contains errors or misconceptions", "2_developing": "Mostly correct", "3_competent": "Correct and well-reasoned", "4_expert": "Accounts for edge cases", "5_master": "Anticipates edge cases and failure modes"}},
    {"name": "security_awareness", "weight": 0.20, "levels": {"1_novice": "Ignores security implications", "2_developing": "Basic security noted", "3_competent": "Flags known risks", "4_expert": "Security-first design", "5_master": "Proactive threat modeling"}},
    {"name": "operational_impact", "weight": 0.25, "levels": {"1_novice": "No consideration of ops", "2_developing": "Basic ops awareness", "3_competent": "Considers deployability", "4_expert": "Full ops lifecycle", "5_master": "Full lifecycle analysis"}},
    {"name": "documentation_quality", "weight": 0.25, "levels": {"1_novice": "Unclear or missing", "2_developing": "Basic coverage", "3_competent": "Clear and complete", "4_expert": "Well-structured and thorough", "5_master": "Teachable to other agents"}}
  ]'::JSONB,
  3.0, 4.2
) ON CONFLICT (role, task_type, version) DO NOTHING;

-- CPO: Product Strategy rubric
INSERT INTO role_rubrics (role, task_type, version, dimensions, passing_score, excellence_score)
VALUES (
  'cpo', 'product_strategy', 1,
  '[
    {"name": "market_understanding", "weight": 0.25, "levels": {"1_novice": "No market context", "2_developing": "Basic market awareness", "3_competent": "Solid market context", "4_expert": "Deep competitive insight", "5_master": "Anticipates market shifts"}},
    {"name": "user_centricity", "weight": 0.25, "levels": {"1_novice": "Feature-focused, no user lens", "2_developing": "Some user consideration", "3_competent": "User needs clearly identified", "4_expert": "User journey mapped", "5_master": "Unexpected user insight"}},
    {"name": "prioritization", "weight": 0.25, "levels": {"1_novice": "No prioritization framework", "2_developing": "Basic priority list", "3_competent": "Impact vs effort analysis", "4_expert": "Multi-factor scoring", "5_master": "Strategic sequencing with dependencies"}},
    {"name": "feasibility", "weight": 0.25, "levels": {"1_novice": "Ignores constraints", "2_developing": "Acknowledges constraints", "3_competent": "Realistic scope", "4_expert": "Resource-aware planning", "5_master": "Innovative within constraints"}}
  ]'::JSONB,
  3.0, 4.2
) ON CONFLICT (role, task_type, version) DO NOTHING;

-- CLO: Legal Compliance rubric
INSERT INTO role_rubrics (role, task_type, version, dimensions, passing_score, excellence_score)
VALUES (
  'clo', 'legal_compliance', 1,
  '[
    {"name": "legal_accuracy", "weight": 0.35, "levels": {"1_novice": "Incorrect legal references", "2_developing": "Basic legal awareness", "3_competent": "Correct legal framework applied", "4_expert": "Nuanced legal analysis", "5_master": "Comprehensive multi-jurisdiction analysis"}},
    {"name": "risk_assessment", "weight": 0.30, "levels": {"1_novice": "Risks not identified", "2_developing": "Surface-level risks", "3_competent": "Key risks identified and rated", "4_expert": "Probability and impact quantified", "5_master": "Mitigation strategies for each risk"}},
    {"name": "actionability", "weight": 0.20, "levels": {"1_novice": "Theoretical only", "2_developing": "General guidance", "3_competent": "Specific action items", "4_expert": "Prioritized compliance roadmap", "5_master": "Implementation-ready with templates"}},
    {"name": "clarity", "weight": 0.15, "levels": {"1_novice": "Dense legal jargon", "2_developing": "Some plain language", "3_competent": "Accessible to non-legal audience", "4_expert": "Clear with appropriate detail", "5_master": "Elegant communication of complex issues"}}
  ]'::JSONB,
  3.0, 4.2
) ON CONFLICT (role, task_type, version) DO NOTHING;

-- VP Research: Research Quality rubric
INSERT INTO role_rubrics (role, task_type, version, dimensions, passing_score, excellence_score)
VALUES (
  'vp-research', 'research_synthesis', 1,
  '[
    {"name": "source_quality", "weight": 0.25, "levels": {"1_novice": "Unreliable or no sources", "2_developing": "Basic web sources", "3_competent": "Credible, diverse sources", "4_expert": "Primary and secondary sources combined", "5_master": "Original research with expert validation"}},
    {"name": "analytical_depth", "weight": 0.30, "levels": {"1_novice": "Surface-level summary", "2_developing": "Basic analysis", "3_competent": "Multi-factor analysis", "4_expert": "Causal analysis with implications", "5_master": "Framework-building insight"}},
    {"name": "strategic_relevance", "weight": 0.25, "levels": {"1_novice": "Academically interesting but irrelevant", "2_developing": "Loosely connected to strategy", "3_competent": "Directly relevant to company goals", "4_expert": "Identifies strategic opportunities", "5_master": "Reshapes strategic thinking"}},
    {"name": "synthesis", "weight": 0.20, "levels": {"1_novice": "Data dump", "2_developing": "Organized data", "3_competent": "Clear narrative", "4_expert": "Compelling story with data", "5_master": "Executive-ready insight brief"}}
  ]'::JSONB,
  3.0, 4.2
) ON CONFLICT (role, task_type, version) DO NOTHING;

-- Ops: Incident Response rubric
INSERT INTO role_rubrics (role, task_type, version, dimensions, passing_score, excellence_score)
VALUES (
  'ops', 'incident_response', 1,
  '[
    {"name": "detection_speed", "weight": 0.25, "levels": {"1_novice": "Missed or late detection", "2_developing": "Detected with delay", "3_competent": "Timely detection", "4_expert": "Early warning before impact", "5_master": "Predictive alerting"}},
    {"name": "triage_accuracy", "weight": 0.25, "levels": {"1_novice": "Wrong severity or routing", "2_developing": "Correct severity, slow routing", "3_competent": "Correct severity and routing", "4_expert": "Impact-aware prioritization", "5_master": "Optimized response with parallel tracks"}},
    {"name": "resolution_quality", "weight": 0.30, "levels": {"1_novice": "Bandaid fix", "2_developing": "Immediate fix only", "3_competent": "Root cause identified", "4_expert": "Root cause + prevention", "5_master": "Systemic improvement implemented"}},
    {"name": "communication", "weight": 0.20, "levels": {"1_novice": "No stakeholder updates", "2_developing": "Post-incident summary only", "3_competent": "Regular status updates", "4_expert": "Proactive stakeholder management", "5_master": "Full incident lifecycle documentation"}}
  ]'::JSONB,
  3.0, 4.2
) ON CONFLICT (role, task_type, version) DO NOTHING;

-- Chief of Staff: Orchestration rubric
INSERT INTO role_rubrics (role, task_type, version, dimensions, passing_score, excellence_score)
VALUES (
  'chief-of-staff', 'orchestration', 1,
  '[
    {"name": "decomposition_quality", "weight": 0.25, "levels": {"1_novice": "Monolithic task assignment", "2_developing": "Basic task splitting", "3_competent": "Atomic, well-defined sub-tasks", "4_expert": "Dependency-aware decomposition", "5_master": "Optimal parallelization with fallbacks"}},
    {"name": "context_embedding", "weight": 0.25, "levels": {"1_novice": "No context provided to agents", "2_developing": "Basic instructions", "3_competent": "Full context with expected output", "4_expert": "Tailored context per agent capability", "5_master": "Predictive context based on agent world model"}},
    {"name": "evaluation_rigor", "weight": 0.25, "levels": {"1_novice": "Auto-accept all outputs", "2_developing": "Surface review", "3_competent": "Rubric-based evaluation", "4_expert": "Calibrated feedback with improvement goals", "5_master": "Evaluation improves agent performance over time"}},
    {"name": "synthesis", "weight": 0.25, "levels": {"1_novice": "Concatenated agent outputs", "2_developing": "Basic summary", "3_competent": "Coherent narrative from multiple inputs", "4_expert": "Cross-functional insight extraction", "5_master": "Strategic synthesis that exceeds sum of parts"}}
  ]'::JSONB,
  3.0, 4.2
) ON CONFLICT (role, task_type, version) DO NOTHING;

-- Content Creator: Blog Post rubric
INSERT INTO role_rubrics (role, task_type, version, dimensions, passing_score, excellence_score)
VALUES (
  'content-creator', 'blog_post', 1,
  '[
    {"name": "brand_voice", "weight": 0.20, "levels": {"1_novice": "Off-brand or generic", "2_developing": "Partially on-brand", "3_competent": "Consistent brand voice", "4_expert": "Distinctive and memorable", "5_master": "Voice-defining content"}},
    {"name": "audience_value", "weight": 0.25, "levels": {"1_novice": "No clear value proposition", "2_developing": "Basic information", "3_competent": "Useful and informative", "4_expert": "Actionable insights", "5_master": "Must-read, bookmark-worthy"}},
    {"name": "seo_optimization", "weight": 0.20, "levels": {"1_novice": "No SEO consideration", "2_developing": "Title tag present", "3_competent": "Natural keyword integration", "4_expert": "Strategic keyword targeting", "5_master": "Intent-matched content structure"}},
    {"name": "originality", "weight": 0.20, "levels": {"1_novice": "Rehashed content", "2_developing": "New arrangement of known ideas", "3_competent": "Fresh perspective", "4_expert": "Original framework or insight", "5_master": "Thought leadership piece"}},
    {"name": "structure", "weight": 0.15, "levels": {"1_novice": "Wall of text", "2_developing": "Basic sections", "3_competent": "Scannable with clear sections", "4_expert": "Progressive disclosure", "5_master": "Narrative arc with payoff"}}
  ]'::JSONB,
  3.0, 4.2
) ON CONFLICT (role, task_type, version) DO NOTHING;
