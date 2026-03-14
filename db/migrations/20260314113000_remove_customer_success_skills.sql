-- Remove deprecated customer-success skills and their task mappings.
-- These skills are no longer part of the active operating model.

BEGIN;

DELETE FROM task_skill_map
WHERE skill_slug IN ('churn-prevention', 'customer-onboarding', 'health-scoring');

DELETE FROM agent_skills
WHERE skill_id IN (
  SELECT id
  FROM skills
  WHERE slug IN ('churn-prevention', 'customer-onboarding', 'health-scoring')
);

DO $$
BEGIN
  IF to_regclass('public.proposed_skills') IS NOT NULL THEN
    DELETE FROM proposed_skills
    WHERE skill_data->>'slug' IN ('churn-prevention', 'customer-onboarding', 'health-scoring');
  END IF;
END
$$;

DELETE FROM skills
WHERE slug IN ('churn-prevention', 'customer-onboarding', 'health-scoring');

COMMIT;
