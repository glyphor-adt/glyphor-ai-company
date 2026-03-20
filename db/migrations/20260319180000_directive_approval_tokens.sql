-- Directive approval tokens — clickable approve/reject links for directive proposals
-- Follows the same pattern as platform_intel approval_tokens but references founder_directives

CREATE TABLE IF NOT EXISTS directive_approval_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  directive_id UUID NOT NULL REFERENCES founder_directives(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',
  used_at TIMESTAMPTZ DEFAULT NULL,
  decided_by TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_directive_approval_tokens_token ON directive_approval_tokens (token);
CREATE INDEX IF NOT EXISTS idx_directive_approval_tokens_directive ON directive_approval_tokens (directive_id);
