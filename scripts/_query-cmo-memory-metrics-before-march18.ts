import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const rows = await systemQuery<{ content: string; created_at: string }>(
    `SELECT content, created_at
     FROM agent_memory
     WHERE agent_role = 'cmo'
     AND created_at < '2026-03-18T00:00:00Z'
     AND (
       content ILIKE '%paying%'
       OR content ILIKE '%mrr%'
       OR content ILIKE '%user%'
       OR content ILIKE '%customer%'
       OR content ILIKE '%revenue%'
       OR content ILIKE '%product hunt%'
     )
     ORDER BY created_at ASC
     LIMIT 20`,
  );
  console.log(JSON.stringify(rows, null, 2));
  console.log(`(row count: ${rows.length})`);
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
