-- Assignment assignee remediation
--
-- Purpose:
-- 1) Normalize legacy assignee role slugs (e.g., vp_design -> vp-design).
-- 2) Repoint assignments targeting paused/missing roles to chief-of-staff.
--
-- Safety:
-- - DRY RUN queries are read-only.
-- - APPLY section is provided but commented out.
-- - Scope is open work only.

-- ------------------------------
-- DRY RUN: summary by action/state
-- ------------------------------
WITH alias_map AS (
  SELECT * FROM (VALUES
    ('chief_of_staff', 'chief-of-staff'),
    ('vp_design', 'vp-design'),
    ('vp_sales', 'vp-sales'),
    ('vp_cs', 'vp-cs'),
    ('competitive_intel', 'competitive-research-analyst'),
    ('competitive-intel', 'competitive-research-analyst')
  ) AS m(alias_role, canonical_role)
), normalized AS (
  SELECT
    wa.id,
    wa.assigned_to,
    wa.status,
    wa.created_at,
    COALESCE(
      (SELECT m.canonical_role
       FROM alias_map m
       WHERE m.alias_role = lower(regexp_replace(trim(wa.assigned_to), '[\\s_]+', '-', 'g'))),
      lower(regexp_replace(trim(wa.assigned_to), '[\\s_]+', '-', 'g'))
    ) AS normalized_role
  FROM work_assignments wa
  WHERE wa.status IN ('draft', 'pending', 'dispatched', 'in_progress', 'needs_revision', 'blocked')
), resolved AS (
  SELECT
    n.*,
    ca.role AS resolved_role,
    lower(ca.status) AS resolved_status,
    CASE
      WHEN ca.role IS NOT NULL AND lower(ca.status) = 'active' AND ca.role <> n.assigned_to THEN 'normalize_active_role'
      WHEN ca.role IS NOT NULL AND lower(ca.status) <> 'active' THEN 'paused_or_inactive_role'
      WHEN ca.role IS NULL THEN 'missing_role'
      ELSE 'noop'
    END AS action,
    CASE
      WHEN ca.role IS NOT NULL AND lower(ca.status) = 'active' THEN ca.role
      ELSE 'chief-of-staff'
    END AS reassigned_to
  FROM normalized n
  LEFT JOIN company_agents ca
    ON ca.role = n.normalized_role
)
SELECT action, status, COUNT(*)::int AS count
FROM resolved
GROUP BY action, status
ORDER BY action, status;

-- ------------------------------------
-- DRY RUN: top unresolved assignee IDs
-- ------------------------------------
WITH alias_map AS (
  SELECT * FROM (VALUES
    ('chief_of_staff', 'chief-of-staff'),
    ('vp_design', 'vp-design'),
    ('vp_sales', 'vp-sales'),
    ('vp_cs', 'vp-cs'),
    ('competitive_intel', 'competitive-research-analyst'),
    ('competitive-intel', 'competitive-research-analyst')
  ) AS m(alias_role, canonical_role)
), normalized AS (
  SELECT
    wa.id,
    wa.assigned_to,
    wa.status,
    COALESCE(
      (SELECT m.canonical_role
       FROM alias_map m
       WHERE m.alias_role = lower(regexp_replace(trim(wa.assigned_to), '[\\s_]+', '-', 'g'))),
      lower(regexp_replace(trim(wa.assigned_to), '[\\s_]+', '-', 'g'))
    ) AS normalized_role
  FROM work_assignments wa
  WHERE wa.status IN ('draft', 'pending', 'dispatched', 'in_progress', 'needs_revision', 'blocked')
), resolved AS (
  SELECT
    n.*,
    ca.role AS resolved_role,
    lower(ca.status) AS resolved_status,
    CASE
      WHEN ca.role IS NOT NULL AND lower(ca.status) = 'active' AND ca.role <> n.assigned_to THEN 'normalize_active_role'
      WHEN ca.role IS NOT NULL AND lower(ca.status) <> 'active' THEN 'paused_or_inactive_role'
      WHEN ca.role IS NULL THEN 'missing_role'
      ELSE 'noop'
    END AS action
  FROM normalized n
  LEFT JOIN company_agents ca
    ON ca.role = n.normalized_role
)
SELECT assigned_to, action, COUNT(*)::int AS count
FROM resolved
WHERE action <> 'noop'
GROUP BY assigned_to, action
ORDER BY count DESC, assigned_to
LIMIT 30;

-- ---------------------------------
-- DRY RUN: row-level apply preview
-- ---------------------------------
WITH alias_map AS (
  SELECT * FROM (VALUES
    ('chief_of_staff', 'chief-of-staff'),
    ('vp_design', 'vp-design'),
    ('vp_sales', 'vp-sales'),
    ('vp_cs', 'vp-cs'),
    ('competitive_intel', 'competitive-research-analyst'),
    ('competitive-intel', 'competitive-research-analyst')
  ) AS m(alias_role, canonical_role)
), normalized AS (
  SELECT
    wa.id,
    wa.assigned_to,
    wa.status,
    wa.created_at,
    COALESCE(
      (SELECT m.canonical_role
       FROM alias_map m
       WHERE m.alias_role = lower(regexp_replace(trim(wa.assigned_to), '[\\s_]+', '-', 'g'))),
      lower(regexp_replace(trim(wa.assigned_to), '[\\s_]+', '-', 'g'))
    ) AS normalized_role
  FROM work_assignments wa
  WHERE wa.status IN ('draft', 'pending', 'dispatched', 'in_progress', 'needs_revision', 'blocked')
), resolved AS (
  SELECT
    n.*,
    ca.role AS resolved_role,
    lower(ca.status) AS resolved_status,
    CASE
      WHEN ca.role IS NOT NULL AND lower(ca.status) = 'active' AND ca.role <> n.assigned_to THEN 'normalize_active_role'
      WHEN ca.role IS NOT NULL AND lower(ca.status) <> 'active' THEN 'paused_or_inactive_role'
      WHEN ca.role IS NULL THEN 'missing_role'
      ELSE 'noop'
    END AS action,
    CASE
      WHEN ca.role IS NOT NULL AND lower(ca.status) = 'active' THEN ca.role
      ELSE 'chief-of-staff'
    END AS reassigned_to
  FROM normalized n
  LEFT JOIN company_agents ca
    ON ca.role = n.normalized_role
)
SELECT id, assigned_to AS current_assigned_to, reassigned_to AS new_assigned_to, action, status, created_at
FROM resolved
WHERE action <> 'noop'
ORDER BY created_at ASC
LIMIT 200;

-- ---------------------------------
-- APPLY (uncomment to execute)
-- ---------------------------------
-- BEGIN;
--
-- WITH alias_map AS (
--   SELECT * FROM (VALUES
--     ('chief_of_staff', 'chief-of-staff'),
--     ('vp_design', 'vp-design'),
--     ('vp_sales', 'vp-sales'),
--     ('vp_cs', 'vp-cs'),
--     ('competitive_intel', 'competitive-research-analyst'),
--     ('competitive-intel', 'competitive-research-analyst')
--   ) AS m(alias_role, canonical_role)
-- ), normalized AS (
--   SELECT
--     wa.id,
--     wa.assigned_to,
--     COALESCE(
--       (SELECT m.canonical_role
--        FROM alias_map m
--        WHERE m.alias_role = lower(regexp_replace(trim(wa.assigned_to), '[\\s_]+', '-', 'g'))),
--       lower(regexp_replace(trim(wa.assigned_to), '[\\s_]+', '-', 'g'))
--     ) AS normalized_role
--   FROM work_assignments wa
--   WHERE wa.status IN ('draft', 'pending', 'dispatched', 'in_progress', 'needs_revision', 'blocked')
-- ), resolved AS (
--   SELECT
--     n.id,
--     n.assigned_to,
--     CASE
--       WHEN ca.role IS NOT NULL AND lower(ca.status) = 'active' THEN ca.role
--       ELSE 'chief-of-staff'
--     END AS reassigned_to,
--     CASE
--       WHEN ca.role IS NOT NULL AND lower(ca.status) = 'active' AND ca.role <> n.assigned_to THEN 'normalize_active_role'
--       WHEN ca.role IS NOT NULL AND lower(ca.status) <> 'active' THEN 'paused_or_inactive_role'
--       WHEN ca.role IS NULL THEN 'missing_role'
--       ELSE 'noop'
--     END AS action
--   FROM normalized n
--   LEFT JOIN company_agents ca
--     ON ca.role = n.normalized_role
-- ), to_update AS (
--   SELECT *
--   FROM resolved
--   WHERE action <> 'noop'
-- )
-- UPDATE work_assignments wa
-- SET assigned_to = u.reassigned_to,
--     updated_at = now()
-- FROM to_update u
-- WHERE wa.id = u.id
-- RETURNING wa.id, u.action, u.assigned_to AS old_assigned_to, u.reassigned_to AS new_assigned_to;
--
-- COMMIT;
