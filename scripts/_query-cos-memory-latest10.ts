import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const rows = await systemQuery<{ content: string; created_at: string }>(
    `SELECT content, created_at
     FROM agent_memory
     WHERE agent_role = 'chief-of-staff'
     ORDER BY created_at DESC
     LIMIT 10`,
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
