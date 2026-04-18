const pg = require('pg');
const c = new pg.Client({
  host: '127.0.0.1',
  port: 6543,
  database: 'glyphor',
  user: 'glyphor_app',
  password: 'TempAuth2026x'
});

async function main() {
  await c.connect();

  // Get activity_log columns
  console.log('\n=== activity_log columns ===');
  const cols = await c.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'activity_log' ORDER BY ordinal_position`
  );
  console.table(cols.rows);

  // Get authority_decisions columns (or similar)
  console.log('\n=== authority-related tables ===');
  const tables = await c.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name ILIKE '%authority%' OR table_name ILIKE '%decision%' OR table_name ILIKE '%gate%' OR table_name ILIKE '%yellow%' ORDER BY table_name`
  );
  console.table(tables.rows);

  await c.end();
}

main().catch(e => { console.error(e); c.end(); });
