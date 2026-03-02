-- Enable pgvector extension for semantic memory search
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Add embedding column to agent_memory (768-dim for text-embedding-004)
ALTER TABLE agent_memory
  ADD COLUMN IF NOT EXISTS embedding vector(768);

-- HNSW index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_agent_memory_embedding
  ON agent_memory
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Semantic search function: find memories similar to a query embedding
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(768),
  match_role TEXT,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  agent_role TEXT,
  memory_type TEXT,
  content TEXT,
  importance DECIMAL,
  tags TEXT[],
  created_at TIMESTAMPTZ,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    am.id,
    am.agent_role,
    am.memory_type,
    am.content,
    am.importance,
    am.tags,
    am.created_at,
    1 - (am.embedding <=> query_embedding) AS similarity
  FROM agent_memory am
  WHERE am.agent_role = match_role
    AND am.embedding IS NOT NULL
    AND (am.expires_at IS NULL OR am.expires_at > NOW())
    AND 1 - (am.embedding <=> query_embedding) > match_threshold
  ORDER BY am.embedding <=> query_embedding
  LIMIT match_count;
$$;
