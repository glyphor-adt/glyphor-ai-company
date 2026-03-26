import { systemQuery } from '@glyphor/shared/db';

type Row = {
  name: string;
  api_config: unknown;
};

async function main() {
  const rows = await systemQuery<Row>(
    `SELECT name, api_config
     FROM tool_registry
     WHERE name = 'watch_tool_gaps'`,
  );

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
