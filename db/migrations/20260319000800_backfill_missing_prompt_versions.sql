-- Backfill missing agent_prompt_versions for agents without any versions.
-- Uses a simple v1 manual entry with a placeholder prompt.

INSERT INTO agent_prompt_versions (agent_id, tenant_id, version, prompt_text, change_summary, source, deployed_at, created_at)
SELECT
  ca.role,
  ca.tenant_id::text,
  1,
  COALESCE(ca.config->>'systemPrompt', 'System prompt managed in code for role: ' || ca.role),
  'Initial version (backfill)',
  'manual',
  NOW(),
  NOW()
FROM company_agents ca
LEFT JOIN agent_prompt_versions apv ON apv.agent_id = ca.role
WHERE apv.id IS NULL
ON CONFLICT DO NOTHING;
