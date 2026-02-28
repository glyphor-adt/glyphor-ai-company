-- Dashboard change requests: founders submit feature/fix requests for IT agents to implement
CREATE TABLE IF NOT EXISTS dashboard_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by TEXT NOT NULL,                     -- founder email: 'kristina@glyphor.ai', 'andrew@glyphor.ai'
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  request_type TEXT NOT NULL DEFAULT 'feature'
    CHECK (request_type IN ('feature', 'fix', 'improvement', 'refactor')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'triaged', 'in_progress', 'review', 'deployed', 'rejected')),
  affected_area TEXT                              -- e.g. 'dashboard', 'comms', 'approvals', 'agents'
    CHECK (affected_area IS NULL OR affected_area IN (
      'dashboard', 'directives', 'workforce', 'comms', 'approvals',
      'financials', 'operations', 'strategy', 'knowledge', 'capabilities',
      'builder', 'governance', 'settings', 'chat', 'other'
    )),
  assigned_to TEXT,                               -- agent role: 'frontend-engineer', 'devops-engineer', etc.
  github_issue_number INTEGER,                    -- GitHub issue number assigned to Copilot
  github_issue_url TEXT,                          -- GitHub issue link
  github_branch TEXT,                             -- branch created by Copilot
  github_pr_url TEXT,                             -- PR link when ready for review
  commit_sha TEXT,                                -- latest commit SHA
  agent_notes TEXT,                               -- agent's progress notes / implementation summary
  rejection_reason TEXT,                          -- if rejected, why
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_dcr_status ON dashboard_change_requests (status);
CREATE INDEX idx_dcr_submitted_by ON dashboard_change_requests (submitted_by);
CREATE INDEX idx_dcr_assigned_to ON dashboard_change_requests (assigned_to);
CREATE INDEX idx_dcr_created_at ON dashboard_change_requests (created_at DESC);

-- RLS: allow authenticated reads/writes (dashboard uses anon key + allowed emails)
ALTER TABLE dashboard_change_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to dashboard_change_requests"
  ON dashboard_change_requests
  FOR ALL
  USING (true)
  WITH CHECK (true);
