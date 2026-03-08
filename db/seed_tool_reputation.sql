-- Seed tool_reputation from agent_tool_grants and known M365 MCP tools
-- Categorize by source based on tool naming conventions

INSERT INTO tool_reputation (tool_name, tool_source, is_active)
SELECT DISTINCT
  g.tool_name,
  CASE
    WHEN g.tool_name LIKE 'mcp_%' THEN 'mcp'
    ELSE 'static'
  END,
  true
FROM agent_tool_grants g
ON CONFLICT (tool_name) DO NOTHING;

-- Verify counts
SELECT tool_source, COUNT(*) as count FROM tool_reputation GROUP BY tool_source ORDER BY tool_source;
