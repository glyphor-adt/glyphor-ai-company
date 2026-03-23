/**
 * Diagnostic: Find why Lisa (seo-analyst) keeps calling copilot_chat.
 * Run: npx tsx scripts/_query-copilot-chat-diagnostic.ts
 * Requires: DATABASE_URL or DB_* env vars (e.g. run-with-local-db-proxy.ps1)
 */
import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  console.log('=== 1. SEO analyst agent_memory with copilot mentions ===');
  const memoryRows = await systemQuery<{ content: string; created_at: string }>(
    `SELECT content, created_at FROM agent_memory
     WHERE agent_role = 'seo-analyst'
     AND content ILIKE '%copilot%'
     ORDER BY created_at DESC LIMIT 10`,
  );
  console.log(JSON.stringify(memoryRows, null, 2));
  if (memoryRows.length === 0) console.log('(none found)\n');
  else console.log();

  console.log('=== 2. tool_registry: copilot_chat ===');
  const toolRows = await systemQuery<Record<string, unknown>>(
    `SELECT * FROM tool_registry WHERE name = 'copilot_chat'`,
  );
  console.log(JSON.stringify(toolRows, null, 2));
  if (toolRows.length === 0) console.log('(none found — not in tool_registry)\n');
  else console.log();

  console.log('=== 3. All tool_registry names containing copilot ===');
  const copilotTools = await systemQuery<{ name: string; is_active: boolean }>(
    `SELECT name, is_active FROM tool_registry WHERE name ILIKE '%copilot%'`,
  );
  console.log(JSON.stringify(copilotTools, null, 2));
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
