import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const [{ count }] = await systemQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM agent_memory
     WHERE agent_role = 'chief-of-staff'
     AND created_at < '2026-03-18T00:00:00Z'`,
  );
  console.log(JSON.stringify({ count: Number(count) }, null, 2));
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
