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

  // 1. company_agents columns
  console.log('=== COMPANY_AGENTS COLUMNS ===');
  const cols = await c.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='company_agents' ORDER BY ordinal_position"
  );
  console.log(cols.rows.map(r => r.column_name + ' (' + r.data_type + ')'));

  // 2. tenant_agents columns
  console.log('\n=== TENANT_AGENTS COLUMNS ===');
  const tcols = await c.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='tenant_agents' ORDER BY ordinal_position"
  );
  console.log(tcols.rows.map(r => r.column_name + ' (' + r.data_type + ')'));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
