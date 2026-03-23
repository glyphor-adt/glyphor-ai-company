-- Remove marketing-intelligence-analyst (Zara Petrov) from CMO (Maya) directive assignees.
-- Source of truth: executive_orchestration_config.allowed_assignees

UPDATE executive_orchestration_config
SET
  allowed_assignees = array_remove(allowed_assignees, 'marketing-intelligence-analyst'),
  updated_at = NOW()
WHERE executive_role = 'cmo';
