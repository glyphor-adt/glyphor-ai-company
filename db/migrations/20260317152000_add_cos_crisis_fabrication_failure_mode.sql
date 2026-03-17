-- Add explicit crisis-fabrication failure mode to CoS cross-team-coordination skill assignment.

BEGIN;

UPDATE agent_skills ags
SET failure_modes = CASE
  WHEN NOT (ags.failure_modes @> ARRAY[
    'Crisis fabrication: Previously interpreted $0 MRR as "revenue blackout" and empty DB tables as "telemetry failure". Zero values are expected pre-launch. Data sync past failures showing status=ok are resolved, not ongoing. Do not propose runway risk initiatives - founders are aware of all costs.'
  ]::text[])
  THEN array_append(
    ags.failure_modes,
    'Crisis fabrication: Previously interpreted $0 MRR as "revenue blackout" and empty DB tables as "telemetry failure". Zero values are expected pre-launch. Data sync past failures showing status=ok are resolved, not ongoing. Do not propose runway risk initiatives - founders are aware of all costs.'
  )
  ELSE ags.failure_modes
END
FROM skills s
WHERE ags.skill_id = s.id
  AND ags.agent_role = 'chief-of-staff'
  AND s.slug = 'cross-team-coordination';

COMMIT;
