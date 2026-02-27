-- SharePoint knowledge sync tracking

CREATE TABLE IF NOT EXISTS sharepoint_document_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id TEXT NOT NULL,
  drive_id TEXT NOT NULL,
  drive_item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  web_url TEXT,
  etag TEXT,
  mime_type TEXT,
  content_hash TEXT,
  last_modified_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted', 'error', 'unsupported')),
  error_text TEXT,
  knowledge_id UUID REFERENCES company_knowledge(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (site_id, drive_id, drive_item_id)
);

CREATE INDEX IF NOT EXISTS idx_sharepoint_document_index_status
  ON sharepoint_document_index (status);

CREATE INDEX IF NOT EXISTS idx_sharepoint_document_index_site_drive
  ON sharepoint_document_index (site_id, drive_id);

CREATE INDEX IF NOT EXISTS idx_sharepoint_document_index_knowledge
  ON sharepoint_document_index (knowledge_id);

ALTER TABLE sharepoint_document_index ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON sharepoint_document_index;
CREATE POLICY "Service role full access" ON sharepoint_document_index
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Anon read access" ON sharepoint_document_index;
CREATE POLICY "Anon read access" ON sharepoint_document_index
  FOR SELECT
  USING (auth.role() = 'anon');

INSERT INTO data_sync_status (id, status, updated_at)
VALUES ('sharepoint-knowledge', 'ok', NOW())
ON CONFLICT (id) DO NOTHING;
