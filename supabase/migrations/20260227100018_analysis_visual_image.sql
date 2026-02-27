-- Add visual_image column to analyses and deep_dives tables
-- Stores base64-encoded PNG of the AI-generated infographic
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS visual_image TEXT DEFAULT NULL;
ALTER TABLE deep_dives ADD COLUMN IF NOT EXISTS visual_image TEXT DEFAULT NULL;
