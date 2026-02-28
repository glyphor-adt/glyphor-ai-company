-- ═══════════════════════════════════════════════════════════════════
-- Migration: Merge duplicate default rubrics
-- Date: 2026-02-28
--
-- Two fallback rubrics existed under different role keys:
--   role='_default' / task_type='_default' (process evaluation)
--   role='default'  / task_type='general'  (content quality)
--
-- This migration moves the 'default'/'general' rubric under '_default'
-- so there is a single fallback role with two task_type rubrics,
-- then deletes the orphaned 'default' row.
-- ═══════════════════════════════════════════════════════════════════

-- Step 1: Insert the content-quality rubric as _default/general
-- (copy dimensions from the old default/general row)
INSERT INTO role_rubrics (role, task_type, version, dimensions, passing_score, excellence_score)
SELECT '_default', 'general', version, dimensions, passing_score, excellence_score
FROM role_rubrics
WHERE role = 'default' AND task_type = 'general'
ORDER BY version DESC
LIMIT 1
ON CONFLICT (role, task_type, version) DO NOTHING;

-- Step 2: Delete the old default/general row
DELETE FROM role_rubrics WHERE role = 'default';
