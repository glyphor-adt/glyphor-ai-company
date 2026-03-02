-- SharePoint site configuration and sync metadata
-- Tracks connected SharePoint sites and their sync health

CREATE TABLE IF NOT EXISTS sharepoint_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id TEXT NOT NULL UNIQUE,
  drive_id TEXT NOT NULL,
  group_id TEXT,
  display_name TEXT NOT NULL,
  web_url TEXT NOT NULL,
  root_folder TEXT NOT NULL DEFAULT 'Company-Agent-Knowledge',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  last_full_sync_at TIMESTAMPTZ,
  last_sync_result JSONB DEFAULT '{}'::JSONB,
  total_documents INTEGER DEFAULT 0,
  total_synced INTEGER DEFAULT 0,
  sync_frequency_cron TEXT DEFAULT '0 10 * * *',
  folder_structure TEXT[] DEFAULT ARRAY[
    'Strategy', 'Products', 'Products/Pulse', 'Products/Fuse',
    'Engineering', 'Finance', 'Marketing', 'Sales',
    'Design', 'Operations', 'Research', 'Policies',
    'Briefs', 'Meeting-Notes', 'Templates'
  ],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sharepoint_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON sharepoint_sites;
CREATE POLICY "Service role full access" ON sharepoint_sites
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Anon read access" ON sharepoint_sites;
CREATE POLICY "Anon read access" ON sharepoint_sites
  FOR SELECT
  USING (auth.role() = 'anon');

-- Add department column to sharepoint_document_index for knowledge routing
ALTER TABLE sharepoint_document_index
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS synced_by TEXT DEFAULT 'cron';

-- Create index for department-based filtering
CREATE INDEX IF NOT EXISTS idx_sharepoint_document_index_department
  ON sharepoint_document_index (department);

-- Map SharePoint folders to departments for automatic knowledge routing
CREATE OR REPLACE FUNCTION sharepoint_folder_to_department(folder_path TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Extract top-level folder after root
  CASE
    WHEN folder_path ILIKE '%/Engineering/%' OR folder_path ILIKE '%/Engineering' THEN RETURN 'engineering';
    WHEN folder_path ILIKE '%/Finance/%' OR folder_path ILIKE '%/Finance' THEN RETURN 'finance';
    WHEN folder_path ILIKE '%/Marketing/%' OR folder_path ILIKE '%/Marketing' THEN RETURN 'marketing';
    WHEN folder_path ILIKE '%/Sales/%' OR folder_path ILIKE '%/Sales' THEN RETURN 'sales';
    WHEN folder_path ILIKE '%/Design/%' OR folder_path ILIKE '%/Design' THEN RETURN 'design';
    WHEN folder_path ILIKE '%/Operations/%' OR folder_path ILIKE '%/Operations' THEN RETURN 'operations';
    WHEN folder_path ILIKE '%/Research/%' OR folder_path ILIKE '%/Research' THEN RETURN 'research';
    WHEN folder_path ILIKE '%/Products/%' OR folder_path ILIKE '%/Products' THEN RETURN 'product';
    WHEN folder_path ILIKE '%/Strategy/%' OR folder_path ILIKE '%/Strategy' THEN RETURN 'strategy';
    WHEN folder_path ILIKE '%/Policies/%' OR folder_path ILIKE '%/Policies' THEN RETURN 'all';
    ELSE RETURN NULL;
  END CASE;
END;
$$;

-- View: SharePoint sync dashboard summary
CREATE OR REPLACE VIEW sharepoint_sync_summary AS
SELECT
  s.display_name,
  s.web_url,
  s.status AS site_status,
  s.last_full_sync_at,
  s.total_documents,
  s.total_synced,
  COUNT(d.id) FILTER (WHERE d.status = 'active') AS active_docs,
  COUNT(d.id) FILTER (WHERE d.status = 'error') AS error_docs,
  COUNT(d.id) FILTER (WHERE d.status = 'unsupported') AS unsupported_docs,
  MAX(d.last_synced_at) AS latest_doc_sync
FROM sharepoint_sites s
LEFT JOIN sharepoint_document_index d
  ON d.site_id = s.site_id AND d.drive_id = s.drive_id
GROUP BY s.id;
