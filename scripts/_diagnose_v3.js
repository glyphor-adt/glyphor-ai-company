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

  // 1. work_assignments columns
  console.log('\n=== work_assignments columns ===');
  const cols = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'work_assignments' ORDER BY ordinal_position`
  );
  console.log(cols.rows.map(r => r.column_name).join(', '));

  // 2. CFO active assignments
  console.log('\n=== CFO active assignments ===');
  const active = await c.query(
    `SELECT id, task_description, status, assigned_by, created_at
     FROM work_assignments
     WHERE agent_id = 'cfo' AND status NOT IN ('completed', 'cancelled', 'failed')
     ORDER BY created_at DESC LIMIT 10`
  );
  for (const row of active.rows) {
    console.log(`\n--- ${row.id} (${row.status}) @ ${row.created_at} ---`);
    console.log('Assigned by:', row.assigned_by);
    console.log('Task:', row.task_description?.substring(0, 400));
  }

  // 3. CFO runs that had "acceptance criteria" in their output
  console.log('\n=== CFO runs with test/acceptance contamination ===');
  const contaminated = await c.query(
    `SELECT id, task, created_at, LEFT(output, 500) as output_start
     FROM agent_runs
     WHERE agent_id = 'cfo'
       AND (output ILIKE '%acceptance criteria%' OR output ILIKE '%test scenario%' OR output ILIKE '%simulated%')
     ORDER BY created_at DESC LIMIT 5`
  );
  for (const row of contaminated.rows) {
    console.log(`\n--- ${row.id} @ ${row.created_at} ---`);
    console.log('Task:', row.task);
    console.log('Output start:', row.output_start);
  }

  // 4. Check the CFO's input (the actual prompt sent) for a recent contaminated run
  console.log('\n=== CFO contaminated run input (first 1000 chars) ===');
  const inputCheck = await c.query(
    `SELECT id, created_at, LEFT(input, 1500) as input_start
     FROM agent_runs
     WHERE agent_id = 'cfo'
       AND output ILIKE '%acceptance criteria%'
     ORDER BY created_at DESC LIMIT 1`
  );
  for (const row of inputCheck.rows) {
    console.log(`\n--- ${row.id} @ ${row.created_at} ---`);
    console.log(row.input_start);
  }

  // 5. What agent_id was the weekly_review trying to insert into disclosure_config?
  console.log('\n=== weekly_review run details ===');
  const wrRun = await c.query(
    `SELECT id, LEFT(output, 1000) as output_start, LEFT(error, 500) as error_text
     FROM agent_runs
     WHERE agent_id = 'chief-of-staff' AND task = 'weekly_review' AND status = 'failed'
     ORDER BY created_at DESC LIMIT 1`
  );
  for (const row of wrRun.rows) {
    console.log('Error:', row.error_text);
    console.log('Output start:', row.output_start);
  }

  // 6. What roles exist in company_agents that are NOT in the canonical roster?
  console.log('\n=== Non-canonical roles in company_agents ===');
  const nonCanon = await c.query(
    `SELECT role, status, display_name FROM company_agents
     WHERE role NOT IN ('chief-of-staff','cto','cfo','clo','cpo','cmo','vp-design','ops','vp-research')
     ORDER BY role`
  );
  console.table(nonCanon.rows);

  await c.end();
}

main().catch(e => { console.error(e); c.end(); });
