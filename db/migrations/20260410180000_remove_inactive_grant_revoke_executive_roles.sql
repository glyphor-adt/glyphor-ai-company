BEGIN;

-- CFO / CPO / CMO: grant_tool_access + revoke_tool_access were seeded then deactivated (least-privilege).
-- Inactive rows inflate grant counts vs "effective" in company-health; remove the dead rows.

DELETE FROM agent_tool_grants
WHERE agent_role IN ('cfo', 'cpo', 'cmo')
  AND tool_name IN ('grant_tool_access', 'revoke_tool_access')
  AND COALESCE(is_active, true) = false;

COMMIT;
