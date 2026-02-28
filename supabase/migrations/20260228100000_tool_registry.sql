-- ═══════════════════════════════════════════════════════════════════
-- Dynamic Tool Registry & Tool Request Workflow
-- Enables agents to request and register new tools at runtime
-- without code deploys. Approval gated via Yellow/Red decisions.
-- ═══════════════════════════════════════════════════════════════════

-- ─── Tool Registry ──────────────────────────────────────────────
-- Stores tool definitions that can be loaded at runtime.
-- Supplements the static KNOWN_TOOLS set in toolRegistry.ts.
CREATE TABLE IF NOT EXISTS tool_registry (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'custom',           -- 'api', 'query', 'custom', 'integration'
  parameters JSONB NOT NULL DEFAULT '{}',            -- JSON schema of tool parameters
  created_by TEXT NOT NULL,                          -- agent role that registered this tool
  approved_by TEXT,                                  -- founder or admin who approved
  is_active BOOLEAN DEFAULT true,

  -- For API-based tools: endpoint configuration
  api_config JSONB,                                  -- { method, url_template, headers_template, body_template, auth_type }
  -- api_config example:
  -- {
  --   "method": "GET",
  --   "url_template": "https://api.example.com/v1/data?q={{query}}",
  --   "headers_template": { "Authorization": "Bearer {{ENV.EXAMPLE_API_KEY}}" },
  --   "body_template": null,
  --   "auth_type": "bearer_env",           -- 'bearer_env', 'header_env', 'none'
  --   "auth_env_var": "EXAMPLE_API_KEY",   -- env var name for the credential
  --   "response_jq": ".data.results"       -- optional: jq-like path to extract from response
  -- }

  -- Metadata
  tags TEXT[] DEFAULT '{}',
  usage_count INT DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tool_registry_category ON tool_registry(category) WHERE is_active = true;
CREATE INDEX idx_tool_registry_created_by ON tool_registry(created_by);

-- ─── Tool Requests ─────────────────────────────────────────────
-- Any agent can request a new tool. Goes through approval workflow.
CREATE TABLE IF NOT EXISTS tool_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by TEXT NOT NULL,                        -- agent role requesting the tool
  tool_name TEXT NOT NULL,                           -- proposed tool name
  description TEXT NOT NULL,                         -- what the tool should do
  justification TEXT NOT NULL,                       -- why it's needed
  use_case TEXT,                                     -- specific use case / directive
  directive_id UUID REFERENCES founder_directives(id),

  -- Suggested implementation
  suggested_category TEXT DEFAULT 'api',             -- 'api', 'query', 'custom'
  suggested_api_config JSONB,                        -- optional: requester's suggested API config
  suggested_parameters JSONB,                        -- optional: requester's suggested parameter schema

  -- Approval workflow
  status TEXT NOT NULL DEFAULT 'pending',             -- 'pending', 'approved', 'rejected', 'building', 'completed'
  decision_id UUID,                                   -- linked to decisions table
  reviewed_by TEXT,                                   -- who reviewed this request
  review_notes TEXT,                                  -- reviewer's notes
  built_by TEXT,                                      -- agent that built the tool (usually CTO)

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tool_requests_status ON tool_requests(status) WHERE status IN ('pending', 'approved', 'building');
CREATE INDEX idx_tool_requests_requested_by ON tool_requests(requested_by);

-- ─── Functions ──────────────────────────────────────────────────

-- Check if a tool exists in the dynamic registry
CREATE OR REPLACE FUNCTION is_registered_tool(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tool_registry WHERE name = p_name AND is_active = true
  );
$$;

-- Increment tool usage counter
CREATE OR REPLACE FUNCTION increment_tool_usage(p_name TEXT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE tool_registry
  SET usage_count = usage_count + 1, last_used_at = NOW()
  WHERE name = p_name;
$$;
