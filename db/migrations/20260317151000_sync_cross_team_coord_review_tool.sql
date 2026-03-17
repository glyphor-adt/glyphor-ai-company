-- Align cross-team-coordination skill with CoS runtime tooling.
-- Runtime skill injection reads from DB, so markdown-only edits are not sufficient.

BEGIN;

UPDATE skills
SET tools_granted = array_remove(tools_granted, 'review_team_output'),
    updated_at = NOW()
WHERE slug = 'cross-team-coordination'
  AND tools_granted @> ARRAY['review_team_output']::text[];

UPDATE skills
SET methodology = REPLACE(methodology, '`review_team_output`', '`evaluate_assignment`'),
    updated_at = NOW()
WHERE slug = 'cross-team-coordination'
  AND methodology LIKE '%`review_team_output`%';

UPDATE skills
SET methodology = REPLACE(methodology, 'review_team_output', 'evaluate_assignment'),
    updated_at = NOW()
WHERE slug = 'cross-team-coordination'
  AND methodology LIKE '%review_team_output%';

COMMIT;
