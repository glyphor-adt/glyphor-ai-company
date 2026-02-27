-- Add visual_image column to strategy_analyses table for AI-generated infographics
ALTER TABLE strategy_analyses ADD COLUMN IF NOT EXISTS visual_image TEXT DEFAULT NULL;
