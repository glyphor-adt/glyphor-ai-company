import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const rows = await systemQuery<{
    agent_id: string;
    content: string;
    created_at: string;
  }>(
    `SELECT agent_role AS agent_id, content, created_at
     FROM agent_memory
     WHERE agent_role IN (
       'cmo','content-creator','seo-analyst',
       'social-media-manager','chief-of-staff'
     )
     AND (
       content ILIKE '%pulse%'
       OR content ILIKE '%fuse%'
       OR content ILIKE '%revy%'
       OR content ILIKE '%cockpit%'
     )
     ORDER BY agent_role, created_at DESC`,
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
