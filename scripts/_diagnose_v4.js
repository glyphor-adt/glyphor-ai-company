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

  // 1. CFO active assignments (using assigned_to)
  console.log('\n=== CFO active assignments ===');
  const active = await c.query(
    `SELECT id, task_description, status, assigned_by, created_at
     FROM work_assignments
     WHERE assigned_to = 'cfo' AND status NOT IN ('completed', 'cancelled', 'failed')
     ORDER BY created_at DESC LIMIT 10`
  );
  for (const row of active.rows) {
    console.log(`\n--- ${row.id} (${row.status}) @ ${row.created_at} ---`);
    console.log('Assigned by:', row.assigned_by);
    console.log('Task:', row.task_description?.substring(0, 500));
  }

  // 2. CFO contaminated run input
  console.log('\n=== CFO contaminated run input (first 2000 chars) ===');
  const inputCheck = await c.query(
    `SELECT id, created_at, LEFT(input, 2000) as input_start
     FROM agent_runs
     WHERE agent_id = 'cfo'
       AND output ILIKE '%acceptance criteria%'
     ORDER BY created_at DESC LIMIT 1`
  );
  for (const row of inputCheck.rows) {
    console.log(`\n--- ${row.id} @ ${row.created_at} ---`);
    console.log(row.input_start);
  }

  // 3. weekly_review FK violation — what was the output trying to do?
  console.log('\n=== weekly_review failed run output ===');
  const wrRun = await c.query(
    `SELECT id, LEFT(output, 1500) as out_text, error
     FROM agent_runs
     WHERE agent_id = 'chief-of-staff' AND task = 'weekly_review' AND status = 'failed'
     ORDER BY created_at DESC LIMIT 1`
  );
  for (const row of wrRun.rows) {
    console.log('Error:', row.error);
    console.log('\nOutput:', row.out_text);
  }

  // 4. Non-canonical roles in company_agents
  console.log('\n=== Non-canonical roles in company_agents ===');
  const nonCanon = await c.query(
    `SELECT role, status, display_name FROM company_agents
     WHERE role NOT IN ('chief-of-staff','cto','cfo','clo','cpo','cmo','vp-design','ops','vp-research')
     ORDER BY role`
  );
  console.table(nonCanon.rows);

  // 5. Check the cert test / eval system
  console.log('\n=== Tables with "cert" or "eval" or "test" in name ===');
  const testTables = await c.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND (table_name ILIKE '%cert%' OR table_name ILIKE '%eval%' OR table_name ILIKE '%test%')
     ORDER BY table_name`
  );
  console.table(testTables.rows);

  await c.end();
}

main().catch(e => { console.error(e); c.end(); });
