const { Client } = require('pg');
(async () => {
  const c = new Client({
    host: process.env.DB_HOST, port: +process.env.DB_PORT,
    database: process.env.DB_NAME, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // Pending decisions
  console.log('=== PENDING DECISIONS ===');
  const pd = await c.query("SELECT id, title, tier, status, proposed_by, created_at, substring(summary from 1 for 300) as summary FROM decisions WHERE status='pending' ORDER BY created_at DESC LIMIT 10");
  console.log(JSON.stringify(pd.rows, null, 2));

  // Company vitals
  console.log('\n=== COMPANY VITALS ===');
  const cv = await c.query("SELECT * FROM company_vitals ORDER BY updated_at DESC LIMIT 3");
  console.log(JSON.stringify(cv.rows, null, 2));

  // Financials table
  console.log('\n=== FINANCIALS TABLE ===');
  try {
    const fc = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='financials' ORDER BY ordinal_position");
    console.log('Columns:', fc.rows.map(x => x.column_name).join(', '));
    const fd = await c.query("SELECT * FROM financials ORDER BY 1 DESC LIMIT 3");
    console.log(JSON.stringify(fd.rows, null, 2));
  } catch (e) { console.log(e.message); }

  // GCP billing
  console.log('\n=== GCP BILLING ===');
  try {
    const gc = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='gcp_billing' ORDER BY ordinal_position");
    console.log('Columns:', gc.rows.map(x => x.column_name).join(', '));
    const gd = await c.query("SELECT * FROM gcp_billing LIMIT 3");
    console.log(JSON.stringify(gd.rows, null, 2));
  } catch (e) { console.log(e.message); }

  // Cost metrics
  console.log('\n=== COST METRICS ===');
  try {
    const cm = await c.query("SELECT * FROM cost_metrics ORDER BY 1 DESC LIMIT 3");
    console.log(JSON.stringify(cm.rows, null, 2));
  } catch (e) { console.log(e.message); }

  // API billing
  console.log('\n=== API BILLING ===');
  try {
    const ab = await c.query("SELECT * FROM api_billing ORDER BY 1 DESC LIMIT 3");
    console.log(JSON.stringify(ab.rows, null, 2));
  } catch (e) { console.log(e.message); }

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
