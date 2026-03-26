import { systemQuery } from '@glyphor/shared/db';

type Row = { table_name: string };

async function main() {
  const rows = await systemQuery<Row>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name ILIKE '%tool%'
     ORDER BY table_name`,
  );

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
