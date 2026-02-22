-- ═══════════════════════════════════════════════════════════════
-- Agent Communication — Direct Messages & Meetings
-- ═══════════════════════════════════════════════════════════════

-- Direct messages between agents
CREATE TABLE IF NOT EXISTS agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  thread_id UUID DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'request'
    CHECK (message_type IN ('request', 'response', 'info', 'followup')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'urgent')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'read', 'responded')),
  context JSONB DEFAULT '{}'::jsonb,
  response TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_to ON agent_messages(to_agent, status);
CREATE INDEX IF NOT EXISTS idx_agent_messages_from ON agent_messages(from_agent);
CREATE INDEX IF NOT EXISTS idx_agent_messages_thread ON agent_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_created ON agent_messages(created_at DESC);

-- Agent meetings
CREATE TABLE IF NOT EXISTS agent_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  called_by TEXT NOT NULL,
  title TEXT NOT NULL,
  purpose TEXT NOT NULL,
  meeting_type TEXT NOT NULL DEFAULT 'discussion'
    CHECK (meeting_type IN ('discussion', 'review', 'planning', 'incident', 'standup')),
  attendees TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  rounds INT NOT NULL DEFAULT 3 CHECK (rounds BETWEEN 2 AND 5),

  -- Meeting content
  agenda JSONB DEFAULT '[]'::jsonb,
  contributions JSONB DEFAULT '{}'::jsonb,
  transcript JSONB DEFAULT '[]'::jsonb,

  -- Outcomes
  summary TEXT,
  action_items JSONB DEFAULT '[]'::jsonb,
  decisions_made JSONB DEFAULT '[]'::jsonb,
  escalations JSONB DEFAULT '[]'::jsonb,

  total_cost DECIMAL(8, 4) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_meetings_status ON agent_meetings(status);
CREATE INDEX IF NOT EXISTS idx_agent_meetings_called_by ON agent_meetings(called_by);
CREATE INDEX IF NOT EXISTS idx_agent_meetings_created ON agent_meetings(created_at DESC);
