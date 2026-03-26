import { systemQuery } from '@glyphor/shared/db';

type Col = { column_name: string; data_type: string };

async function main() {
  const rows = await systemQuery<Col>(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'runtime_tools'
     ORDER BY ordinal_position`,
  );

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
