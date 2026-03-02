-- ============================================================
-- FOUNDER DIRECTIVES
-- Strategic priorities set by founders that drive agent work
-- ============================================================

CREATE TABLE IF NOT EXISTS founder_directives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who and what
  created_by TEXT NOT NULL DEFAULT 'kristina',  -- kristina | andrew
  title TEXT NOT NULL,
  description TEXT NOT NULL,

  -- Classification
  priority TEXT NOT NULL DEFAULT 'high'
    CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN (
      'revenue', 'product', 'engineering', 'marketing',
      'sales', 'customer_success', 'operations', 'general'
    )),

  -- Targeting
  target_agents TEXT[] DEFAULT '{}',
  department TEXT,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  due_date TIMESTAMPTZ,

  -- Tracking
  progress_notes TEXT[] DEFAULT '{}',
  completion_summary TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_directives_status ON founder_directives(status);
CREATE INDEX idx_directives_priority ON founder_directives(priority);
CREATE INDEX idx_directives_created_by ON founder_directives(created_by);


-- ============================================================
-- WORK ASSIGNMENTS
-- Sarah's breakdown of directives into agent-level tasks
-- ============================================================

CREATE TABLE IF NOT EXISTS work_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to directive
  directive_id UUID NOT NULL REFERENCES founder_directives(id),

  -- Assignment
  assigned_to TEXT NOT NULL,
  task_description TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'on_demand',
  expected_output TEXT,

  -- Priority and sequencing
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  depends_on UUID[],
  sequence_order INT DEFAULT 0,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'dispatched', 'in_progress', 'completed', 'failed', 'blocked')),
  dispatched_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Results
  agent_output TEXT,
  evaluation TEXT,
  quality_score REAL,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assignments_directive ON work_assignments(directive_id);
CREATE INDEX idx_assignments_agent ON work_assignments(assigned_to);
CREATE INDEX idx_assignments_status ON work_assignments(status);
CREATE INDEX idx_assignments_deps ON work_assignments USING GIN(depends_on);
