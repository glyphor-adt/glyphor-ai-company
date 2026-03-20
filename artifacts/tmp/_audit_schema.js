const { Client } = require('pg');
(async () => {
  const c = new Client({
    host: process.env.DB_HOST, port: +process.env.DB_PORT,
    database: process.env.DB_NAME, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // List all tables
  const r = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  console.log('=== ALL TABLES ===');
  console.log(r.rows.map(x => x.table_name).join('\n'));

  // Check initiatives status counts
  console.log('\n=== INITIATIVE STATUS COUNTS ===');
  const ic = await c.query("SELECT status, count(*) as cnt FROM initiatives GROUP BY status ORDER BY cnt DESC");
  console.log(JSON.stringify(ic.rows));

  // Check decisions schema
  console.log('\n=== DECISIONS COLUMNS ===');
  const dc = await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='decisions' ORDER BY ordinal_position");
  console.log(dc.rows.map(x => `${x.column_name} (${x.data_type})`).join(', '));

  // Pending decisions
  console.log('\n=== PENDING DECISIONS ===');
  const pd = await c.query("SELECT id, title, status, proposed_by, created_at, substring(description from 1 for 200) as desc FROM decisions WHERE status='pending' ORDER BY created_at DESC LIMIT 10");
  console.log(JSON.stringify(pd.rows, null, 2));

  // GCP billing columns
  console.log('\n=== GCP_BILLING COLUMNS ===');
  try {
    const gc = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='gcp_billing'");
    console.log(gc.rows.map(x => x.column_name).join(', '));
    const gb = await c.query("SELECT * FROM gcp_billing ORDER BY 1 DESC LIMIT 3");
    console.log(JSON.stringify(gb.rows, null, 2));
  } catch (e) { console.log(e.message); }

  // Company vitals
  console.log('\n=== COMPANY_VITALS ===');
  try {
    const cv = await c.query("SELECT * FROM company_vitals ORDER BY updated_at DESC LIMIT 3");
    console.log(JSON.stringify(cv.rows, null, 2));
  } catch (e) { console.log(e.message); }

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
