import { systemQuery } from '@glyphor/shared/db';

async function main() {
  // Check column structure of company_agents for INSERT
  const r = await systemQuery(`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'company_agents'
    ORDER BY ordinal_position
  `);
  console.log('=== company_agents columns ===');
  for (const col of r) {
    console.log(`  ${col.column_name}: ${col.data_type} default=${col.column_default} nullable=${col.is_nullable}`);
  }
  process.exit(0);
}
main();
