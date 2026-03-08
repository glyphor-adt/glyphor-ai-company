-- Social publishing workflow hardening
-- Adds review metadata, durable publish records, and API/error tracking
-- for social content and scheduled social posts.

ALTER TABLE content_drafts
  ADD COLUMN IF NOT EXISTS initiative_id UUID REFERENCES initiatives(id),
  ADD COLUMN IF NOT EXISTS directive_id UUID REFERENCES founder_directives(id),
  ADD COLUMN IF NOT EXISTS assignment_id UUID REFERENCES work_assignments(id),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS review_requested_by TEXT,
  ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_notes TEXT,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_notes TEXT,
  ADD COLUMN IF NOT EXISTS rejected_by TEXT,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS decision_id UUID REFERENCES decisions(id),
  ADD COLUMN IF NOT EXISTS scheduled_post_id UUID,
  ADD COLUMN IF NOT EXISTS platform_publish_status TEXT DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS platform_publish_error TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_content_drafts_review_status
  ON content_drafts(status, platform, review_requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_drafts_assignment
  ON content_drafts(assignment_id)
  WHERE assignment_id IS NOT NULL;

ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS api_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS content_draft_id UUID REFERENCES content_drafts(id),
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_decision_id UUID REFERENCES decisions(id),
  ADD COLUMN IF NOT EXISTS publish_attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_publish_error TEXT,
  ADD COLUMN IF NOT EXISTS durable_reference TEXT,
  ADD COLUMN IF NOT EXISTS platform_post_id TEXT,
  ADD COLUMN IF NOT EXISTS platform_post_url TEXT,
  ADD COLUMN IF NOT EXISTS deliverable_id UUID REFERENCES deliverables(id),
  ADD COLUMN IF NOT EXISTS deliverable_status TEXT,
  ADD COLUMN IF NOT EXISTS final_publish_timestamp TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'social_post',
  ADD COLUMN IF NOT EXISTS initiative_id UUID REFERENCES initiatives(id),
  ADD COLUMN IF NOT EXISTS directive_id UUID REFERENCES founder_directives(id),
  ADD COLUMN IF NOT EXISTS assignment_id UUID REFERENCES work_assignments(id),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_api_status
  ON scheduled_posts(api_status, status);

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_content_draft
  ON scheduled_posts(content_draft_id)
  WHERE content_draft_id IS NOT NULL;

ALTER TABLE social_metrics
  ADD COLUMN IF NOT EXISTS post_id UUID REFERENCES scheduled_posts(id),
  ADD COLUMN IF NOT EXISTS likes INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engagement_rate DECIMAL(6,4) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_social_metrics_post_id
  ON social_metrics(post_id)
  WHERE post_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS social_publish_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID REFERENCES content_drafts(id),
  scheduled_post_id UUID REFERENCES scheduled_posts(id),
  deliverable_id UUID REFERENCES deliverables(id),
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  status TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_publish_audit_draft
  ON social_publish_audit_log(draft_id, created_at DESC)
  WHERE draft_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_social_publish_audit_post
  ON social_publish_audit_log(scheduled_post_id, created_at DESC)
  WHERE scheduled_post_id IS NOT NULL;
