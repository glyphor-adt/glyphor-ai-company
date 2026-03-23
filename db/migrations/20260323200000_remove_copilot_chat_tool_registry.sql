-- Remove copilot_chat from tool_registry if present.
-- This tool does not exist and causes ~30s timeouts when Lisa (seo-analyst) tries to call it.
-- Source: mcp_M365Copilot MCP server; now filtered in integrations agent365 bridge.
DELETE FROM tool_registry
WHERE name = 'copilot_chat';
