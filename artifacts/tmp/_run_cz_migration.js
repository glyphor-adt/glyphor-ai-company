const { Client } = require('pg');
const fs = require('fs');
const c = new Client({
  connectionString: 'postgresql://glyphor_app:TempAuth2026x@127.0.0.1:6543/glyphor'
});
c.connect().then(async () => {
  console.log('Connected as glyphor_app');
  
  // Run schema migration
  const schema = fs.readFileSync('db/migrations/20260417160000_cz_schema.sql', 'utf8');
  await c.query(schema);
  console.log('Schema migration applied');
  
  // Run seed migration
  const seed = fs.readFileSync('db/migrations/20260417160001_cz_seed.sql', 'utf8');
  await c.query(seed);
  console.log('Seed migration applied');
  
  // Verify
  const r = await c.query('SELECT COUNT(*) as n FROM cz_tasks WHERE active');
  console.log('Active tasks:', r.rows[0].n);
  const p = await c.query('SELECT COUNT(*) as n FROM cz_tasks WHERE is_p0 AND active');
  console.log('P0 tasks:', p.rows[0].n);
  const pc = await c.query('SELECT pillar, COUNT(*) as n FROM cz_tasks WHERE active GROUP BY pillar ORDER BY MIN(task_number)');
  console.log('Tasks per pillar:');
  pc.rows.forEach(r => console.log('  ', r.pillar, r.n));
  
  await c.end();
}).catch(e => {
  console.error('ERROR:', e.message);
  c.end();
});
