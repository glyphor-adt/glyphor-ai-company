BEGIN;

-- CTO had ~50+ inactive rows from deprecated Microsoft Graph / SharePoint-style tool names
-- (PascalCase MCP aliases). They do not grant capability but inflate totalRows vs effective
-- in company-health. Remove inactive grants only.

DELETE FROM agent_tool_grants
WHERE agent_role = 'cto'
  AND COALESCE(is_active, true) = false;

COMMIT;
