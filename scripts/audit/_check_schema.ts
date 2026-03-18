import { systemQuery } from '@glyphor/shared/db';

async function main() {
  const cols = await systemQuery(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'agent_skills' ORDER BY ordinal_position"
  );
  console.log('agent_skills columns:', cols.map((r: any) => r.column_name));

  const cols2 = await systemQuery(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'skills' ORDER BY ordinal_position"
  );
  console.log('skills columns:', cols2.map((r: any) => r.column_name));

  process.exit(0);
}

main();
