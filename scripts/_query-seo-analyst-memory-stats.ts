import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const rows = await systemQuery<{
    total_memories: string;
    oldest: string | null;
    newest: string | null;
  }>(
    `SELECT COUNT(*)::text AS total_memories,
            MIN(created_at) AS oldest,
            MAX(created_at) AS newest
     FROM agent_memory
     WHERE agent_role = 'seo-analyst'`,
  );
  console.log(JSON.stringify(rows[0] ?? null, null, 2));
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
