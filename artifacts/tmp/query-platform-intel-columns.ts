import { systemQuery } from '@glyphor/shared/db';

type Col = { table_name: string; column_name: string; data_type: string };

async function main() {
  const cols = await systemQuery<Col>(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('agent_runs', 'agent_schedules', 'agent_tool_grants')
     ORDER BY table_name, ordinal_position`,
  );

  console.log(JSON.stringify(cols, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
