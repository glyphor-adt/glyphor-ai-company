import { systemQuery } from '@glyphor/shared/db';

type Row = {
  name: string;
  implementation: unknown;
};

async function main() {
  const rows = await systemQuery<Row>(
    `SELECT name, implementation
     FROM runtime_tools
     WHERE name = 'watch_tool_gaps'`,
  );

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
