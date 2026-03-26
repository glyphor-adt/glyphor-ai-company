import { systemQuery } from '@glyphor/shared/db';

type C = { source: string; count: number };
type N = { source: string; name: string };

async function main() {
  const counts = await systemQuery<C>(
    `SELECT 'tool_registry' AS source, COUNT(*)::int AS count FROM tool_registry
     UNION ALL
     SELECT 'runtime_tools' AS source, COUNT(*)::int AS count FROM runtime_tools`,
  );

  const names = await systemQuery<N>(
    `SELECT 'tool_registry' AS source, name
     FROM tool_registry
     WHERE name = 'watch_tool_gaps'
     UNION ALL
     SELECT 'runtime_tools' AS source, name
     FROM runtime_tools
     WHERE name = 'watch_tool_gaps'`,
  );

  console.log(JSON.stringify({ counts, names }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
