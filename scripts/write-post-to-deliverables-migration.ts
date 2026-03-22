/**
 * Generates db/migrations/20260322120000_post_to_deliverables_prompts.sql
 * Run: npx tsx scripts/write-post-to-deliverables-migration.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CMO_SYSTEM_PROMPT } from '../packages/agents/src/cmo/systemPrompt.ts';
import { CHIEF_OF_STAFF_SYSTEM_PROMPT } from '../packages/agents/src/chief-of-staff/systemPrompt.ts';
import { CONTENT_CREATOR_SYSTEM_PROMPT } from '../packages/agents/src/content-creator/systemPrompt.ts';
import { SOCIAL_MEDIA_MANAGER_SYSTEM_PROMPT } from '../packages/agents/src/social-media-manager/systemPrompt.ts';

function esc(text: string): string {
  return text.replace(/'/g, "''");
}

const agents: Array<{ id: string; prompt: string }> = [
  { id: 'cmo', prompt: CMO_SYSTEM_PROMPT },
  { id: 'chief-of-staff', prompt: CHIEF_OF_STAFF_SYSTEM_PROMPT },
  { id: 'content-creator', prompt: CONTENT_CREATOR_SYSTEM_PROMPT },
  { id: 'social-media-manager', prompt: SOCIAL_MEDIA_MANAGER_SYSTEM_PROMPT },
];

let sql = `-- Post to Deliverables tool grants + prompt version bump (manual deploy)
-- post_to_deliverables completion protocol + CoS morning briefing completed-yesterday

BEGIN;

-- Retire currently active prompt versions for targeted agents
UPDATE agent_prompt_versions
SET retired_at = NOW()
WHERE agent_id IN ('cmo', 'chief-of-staff', 'content-creator', 'social-media-manager')
  AND deployed_at IS NOT NULL
  AND retired_at IS NULL;

`;

for (const { id, prompt } of agents) {
  sql += `INSERT INTO agent_prompt_versions (agent_id, tenant_id, version, prompt_text, change_summary, source, deployed_at, created_at)
SELECT
  '${esc(id)}',
  'system',
  COALESCE((SELECT MAX(version) FROM agent_prompt_versions WHERE agent_id = '${esc(id)}'), 0) + 1,
  '${esc(prompt)}',
  'post_to_deliverables completion protocol; Deliverables channel posting; CoS completed-yesterday briefing',
  'manual',
  NOW(),
  NOW();

`;
}

sql += `
-- Tool grants (idempotent)
INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, is_active)
VALUES
  ('cmo', 'post_to_deliverables', 'system', true),
  ('content-creator', 'post_to_deliverables', 'system', true),
  ('social-media-manager', 'post_to_deliverables', 'system', true),
  ('chief-of-staff', 'post_to_deliverables', 'system', true)
ON CONFLICT (agent_role, tool_name) DO UPDATE SET is_active = true, updated_at = NOW();

COMMIT;
`;

const out = resolve('db/migrations/20260322120000_post_to_deliverables_prompts.sql');
writeFileSync(out, sql, 'utf8');
console.log('Wrote', out);
