import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const rows = await systemQuery<{
    agent_role: string;
    remaining_memories: string;
    oldest: string | null;
    newest: string | null;
  }>(
    `SELECT agent_role,
            COUNT(*)::text AS remaining_memories,
            MIN(created_at) AS oldest,
            MAX(created_at) AS newest
     FROM agent_memory
     WHERE agent_role IN (
       'cmo','content-creator','seo-analyst',
       'social-media-manager','chief-of-staff'
     )
     GROUP BY agent_role
     ORDER BY agent_role`,
  );
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
