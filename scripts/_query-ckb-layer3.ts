import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const rows = await systemQuery(
    `SELECT section AS key, title, layer, is_stale, last_verified_at, version,
      LEFT(content, 500) AS content_preview
    FROM company_knowledge_base
    WHERE layer = 3
    ORDER BY section ASC`,
  );
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
