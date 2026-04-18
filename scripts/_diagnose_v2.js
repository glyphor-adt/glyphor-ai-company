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

  // 1. agent_runs columns
  console.log('\n=== agent_runs columns ===');
  const cols = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'agent_runs' ORDER BY ordinal_position`
  );
  console.log(cols.rows.map(r => r.column_name).join(', '));

  // 2. CFO recent runs
  console.log('\n=== CFO recent runs ===');
  const runs = await c.query(
    `SELECT id, task, status, error, created_at
     FROM agent_runs
     WHERE agent_id = 'cfo'
     ORDER BY created_at DESC LIMIT 5`
  );
  for (const row of runs.rows) {
    console.log(`\n--- ${row.created_at} (${row.status}) ---`);
    console.log('Task:', row.task?.substring(0, 200));
    if (row.error) console.log('Error:', row.error?.substring(0, 200));
  }

  // 3. Check what the weekly_review FK violation was trying to insert
  console.log('\n=== weekly_review failed run ===');
  const wr = await c.query(
    `SELECT id, task, status, error, created_at
     FROM agent_runs
     WHERE agent_id = 'chief-of-staff' AND task ILIKE '%weekly_review%'
     ORDER BY created_at DESC LIMIT 3`
  );
  for (const row of wr.rows) {
    console.log(`\n--- ${row.created_at} (${row.status}) ---`);
    console.log('Task:', row.task?.substring(0, 300));
    if (row.error) console.log('Error:', row.error?.substring(0, 500));
  }

  // 4. Check what roles are NOT in company_agents that might cause FK issues
  console.log('\n=== Roles in disclosure_config vs company_agents ===');
  const missing = await c.query(
    `SELECT adc.agent_id, ca.role IS NOT NULL as in_company_agents
     FROM agent_disclosure_config adc
     LEFT JOIN company_agents ca ON adc.agent_id = ca.role
     ORDER BY adc.agent_id`
  );
  console.table(missing.rows);

  // 5. Check CFO eval/cert test configs
  console.log('\n=== CFO work_assignments with "test" or "cert" or "eval" ===');
  const tests = await c.query(
    `SELECT id, title, status, source, created_at
     FROM work_assignments
     WHERE agent_id = 'cfo'
       AND (title ILIKE '%test%' OR title ILIKE '%cert%' OR title ILIKE '%eval%'
         OR source ILIKE '%test%' OR source ILIKE '%cert%' OR source ILIKE '%eval%')
     ORDER BY created_at DESC LIMIT 10`
  );
  console.table(tests.rows);

  // 6. All active CFO assignments
  console.log('\n=== All active CFO assignments ===');
  const active = await c.query(
    `SELECT id, title, status, source, created_at
     FROM work_assignments
     WHERE agent_id = 'cfo' AND status NOT IN ('completed', 'cancelled', 'failed')
     ORDER BY created_at DESC LIMIT 10`
  );
  console.table(active.rows);

  // 7. Check if there's an eval harness or test frame running
  console.log('\n=== Recent eval/cert test runs (any agent) ===');
  const evals = await c.query(
    `SELECT agent_id, task, status, created_at
     FROM agent_runs
     WHERE task ILIKE '%cert%' OR task ILIKE '%acceptance_criteria%' OR task ILIKE '%negative_constraint%'
        OR task ILIKE '%test_scenario%' OR task ILIKE '%eval%fail%'
     ORDER BY created_at DESC LIMIT 10`
  );
  console.table(evals.rows);

  await c.end();
}

main().catch(e => { console.error(e); c.end(); });
