const { Client } = require('pg');

(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // 1. agent_world_model columns
  console.log('=== WORLD_MODEL COLUMNS ===');
  const wmc = await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='agent_world_model' ORDER BY ordinal_position"
  );
  console.log(wmc.rows.map(r => r.column_name));

  // 2. agent_memory columns
  console.log('\n=== AGENT_MEMORY COLUMNS ===');
  const mc = await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='agent_memory' ORDER BY ordinal_position"
  );
  console.log(mc.rows.map(r => r.column_name));

  // 3. agent_world_model_corrections columns
  console.log('\n=== CORRECTIONS COLUMNS ===');
  const cc = await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='agent_world_model_corrections' ORDER BY ordinal_position"
  );
  console.log(cc.rows.map(r => r.column_name));

  // 4. Sample world model entries
  console.log('\n=== SAMPLE WORLD_MODEL ENTRIES ===');
  const sample = await c.query("SELECT * FROM agent_world_model LIMIT 3");
  console.log(JSON.stringify(sample.rows, null, 2));

  // 5. Sample agent_memory entries 
  console.log('\n=== SAMPLE AGENT_MEMORY ENTRIES ===');
  const msample = await c.query("SELECT * FROM agent_memory LIMIT 3");
  console.log(JSON.stringify(msample.rows, null, 2));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
