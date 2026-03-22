import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const rows = await systemQuery<{ content: string; created_at: string }>(
    `SELECT content, created_at
     FROM agent_memory
     WHERE agent_role = 'chief-of-staff'
     AND created_at < '2026-03-18T00:00:00Z'
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
