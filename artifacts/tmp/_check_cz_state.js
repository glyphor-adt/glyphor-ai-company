const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://glyphor_app:TempAuth2026x@127.0.0.1:6543/glyphor'
});
c.connect().then(async () => {
  // Check what columns cz_runs actually has
  const cols = await c.query(`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'cz_runs'
    ORDER BY ordinal_position
  `);
  console.log('cz_runs columns:');
  cols.rows.forEach(r => console.log(`  ${r.column_name} (${r.data_type}) default=${r.column_default} nullable=${r.is_nullable}`));

  // Check existing policies
  const policies = await c.query(`
    SELECT tablename, policyname FROM pg_policies
    WHERE tablename LIKE 'cz_%'
    ORDER BY tablename, policyname
  `);
  console.log('\nExisting policies:');
  policies.rows.forEach(r => console.log(`  ${r.tablename}: ${r.policyname}`));

  // Check schema_migrations
  const migs = await c.query(`
    SELECT name, applied_at FROM schema_migrations
    WHERE name LIKE '%cz%'
    ORDER BY name
  `);
  console.log('\nApplied CZ migrations:', migs.rows);

  await c.end();
}).catch(e => console.error(e.message));
