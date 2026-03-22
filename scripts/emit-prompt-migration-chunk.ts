/**
 * One-off helper: run from repo root with:
 *   npx tsx scripts/emit-prompt-migration-chunk.ts > /tmp/prompt-inserts.sql
 */
import { CMO_SYSTEM_PROMPT } from '../packages/agents/src/cmo/systemPrompt.ts';
import { CHIEF_OF_STAFF_SYSTEM_PROMPT } from '../packages/agents/src/chief-of-staff/systemPrompt.ts';
import { CONTENT_CREATOR_SYSTEM_PROMPT } from '../packages/agents/src/content-creator/systemPrompt.ts';
import { SOCIAL_MEDIA_MANAGER_SYSTEM_PROMPT } from '../packages/agents/src/social-media-manager/systemPrompt.ts';

function sqlLiteral(text: string): string {
  return "'" + text.replace(/'/g, "''") + "'";
}

const rows: Array<{ agent_id: string; prompt: string }> = [
  { agent_id: 'cmo', prompt: CMO_SYSTEM_PROMPT },
  { agent_id: 'chief-of-staff', prompt: CHIEF_OF_STAFF_SYSTEM_PROMPT },
  { agent_id: 'content-creator', prompt: CONTENT_CREATOR_SYSTEM_PROMPT },
  { agent_id: 'social-media-manager', prompt: SOCIAL_MEDIA_MANAGER_SYSTEM_PROMPT },
];

for (const { agent_id, prompt } of rows) {
  const v = process.env[`NEXT_VER_${agent_id.replace(/-/g, '_').toUpperCase()}`] ?? '0';
  process.stdout.write(
    `SELECT ${sqlLiteral(agent_id)} AS agent_id, ${v}::int AS next_ver, ${sqlLiteral(prompt)} AS prompt_text;\n`,
  );
}
