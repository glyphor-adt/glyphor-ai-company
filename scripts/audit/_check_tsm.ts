import { systemQuery } from '@glyphor/shared/db';

async function main() {
  // Check task_skill_map schema
  const cols = await systemQuery(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'task_skill_map'
    ORDER BY ordinal_position
  `);
  console.log('=== task_skill_map columns ===');
  for (const c of cols) console.log(`  ${c.column_name}: ${c.data_type}`);

  // All current entries
  const rows = await systemQuery('SELECT * FROM task_skill_map ORDER BY task_regex');
  console.log('\n=== Current task_skill_map entries ===');
  for (const r of rows) console.log(`  ${r.task_regex} -> ${r.skill_slug} (priority=${r.priority})`);

  process.exit(0);
}
main();
