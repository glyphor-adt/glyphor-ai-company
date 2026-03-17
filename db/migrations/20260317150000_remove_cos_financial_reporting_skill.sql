-- Remove CFO-specific financial-reporting skill from Chief of Staff.
-- This keeps CoS skill context focused on orchestration and avoids wasted prompt tokens.

BEGIN;

DELETE FROM agent_skills ags
USING skills s
WHERE ags.skill_id = s.id
  AND ags.agent_role = 'chief-of-staff'
  AND s.slug = 'financial-reporting';

COMMIT;
