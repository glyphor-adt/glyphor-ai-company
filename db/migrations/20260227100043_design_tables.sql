-- Design domain tables for mcp-design-server
-- Stores design reviews, audits, screenshots, and asset metadata

CREATE TABLE IF NOT EXISTS design_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_type TEXT NOT NULL,        -- screenshot_comparison, accessibility_audit, brand_audit, lighthouse, design_critique
  url TEXT,                         -- page URL reviewed
  page_name TEXT,                   -- human-readable page identifier
  score DECIMAL(5,2),               -- overall score (0-100)
  status TEXT DEFAULT 'pending',    -- pending, passed, failed, needs_attention
  findings JSONB DEFAULT '[]',      -- array of { severity, message, selector, recommendation }
  screenshots JSONB DEFAULT '{}',   -- { desktop_url, mobile_url, diff_url }
  reviewer TEXT,                    -- agent role that performed the review
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS design_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type TEXT NOT NULL,         -- icon, illustration, logo, photograph, component_preview
  name TEXT NOT NULL,
  file_path TEXT,                   -- GCS or CDN path
  file_url TEXT,                    -- public URL
  format TEXT,                      -- svg, png, webp, figma
  dimensions TEXT,                  -- e.g. "1200x630"
  tags TEXT[],                      -- searchable tags
  figma_node_id TEXT,               -- Figma node reference if applicable
  uploaded_by TEXT,                 -- agent role
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
