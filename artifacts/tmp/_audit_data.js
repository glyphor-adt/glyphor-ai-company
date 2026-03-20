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

  // 1. Open founder directives
  console.log('=== OPEN FOUNDER DIRECTIVES ===');
  const dirs = await c.query(
    `SELECT id, title, status, priority, created_by, created_at,
            substring(description from 1 for 300) as desc
     FROM founder_directives WHERE status = 'open'
     ORDER BY created_at DESC LIMIT 10`
  );
  console.log(JSON.stringify(dirs.rows, null, 2));

  // 2. Financial data the agents see
  console.log('\n=== COMPANY FINANCIALS (latest) ===');
  try {
    const fin = await c.query(
      `SELECT * FROM company_financials ORDER BY report_date DESC LIMIT 3`
    );
    console.log(JSON.stringify(fin.rows, null, 2));
  } catch (e) { console.log('company_financials:', e.message); }

  // 3. Pending decisions
  console.log('\n=== PENDING DECISIONS ===');
  try {
    const decs = await c.query(
      `SELECT id, title, status, proposed_by, decision_type, created_at,
              substring(description from 1 for 200) as desc
       FROM decisions WHERE status = 'pending'
       ORDER BY created_at DESC LIMIT 10`
    );
    console.log(JSON.stringify(decs.rows, null, 2));
  } catch (e) { console.log('decisions:', e.message); }

  // 4. Recent agent runs to see what Sarah is outputting
  console.log('\n=== RECENT COS RUNS ===');
  const runs = await c.query(
    `SELECT id, task, status, tool_calls, created_at,
            substring(output from 1 for 800) as out,
            substring(error from 1 for 300) as err
     FROM agent_runs WHERE agent_id = 'chief-of-staff'
     AND created_at > now() - interval '4 hours'
     ORDER BY created_at DESC LIMIT 5`
  );
  console.log(JSON.stringify(runs.rows, null, 2));

  // 5. GCP billing / costs
  console.log('\n=== GCP BILLING RECENT ===');
  try {
    const bill = await c.query(
      `SELECT * FROM gcp_billing ORDER BY date DESC LIMIT 3`
    );
    console.log(JSON.stringify(bill.rows, null, 2));
  } catch (e) {
    console.log('gcp_billing table may not exist:', e.message);
  }

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
