import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const rows = await systemQuery(
    `SELECT 
      section AS key,
      title,
      layer,
      audience,
      is_stale,
      last_verified_at,
      version,
      LEFT(content, 500) AS content_preview
    FROM company_knowledge_base
    ORDER BY layer ASC, section ASC`,
  );
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
