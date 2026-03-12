import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

// Get agent_runs columns and types
const q = await c.query(`
  SELECT column_name, data_type, is_nullable 
  FROM information_schema.columns 
  WHERE table_name = 'agent_runs' 
  ORDER BY ordinal_position
`);
console.log('=== agent_runs schema ===');
for (const r of q.rows) {
  console.log(`  ${r.column_name}: ${r.data_type} (nullable: ${r.is_nullable})`);
}

// Check for triggers on agent_runs
const t = await c.query(`
  SELECT trigger_name, event_manipulation, action_statement 
  FROM information_schema.triggers 
  WHERE event_object_table = 'agent_runs'
`);
console.log('\n=== triggers ===');
console.log(JSON.stringify(t.rows, null, 2));

await c.end();
