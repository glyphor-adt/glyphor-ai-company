const { Pool } = require('pg');

async function main() {
  const pw = process.env.DB_SYSTEM_PASSWORD;
  if (!pw) { console.error('Set DB_SYSTEM_PASSWORD'); process.exit(1); }
  const p = new Pool({ host: 'localhost', port: 15432, user: 'glyphor_system_user', password: pw, database: 'glyphor' });

  // 0. Check schema
  const cols = await p.query("SELECT column_name FROM information_schema.columns WHERE table_name='agent_runs' ORDER BY ordinal_position");
  console.log('=== agent_runs columns ===');
  console.log(cols.rows.map(r => r.column_name).join(', '));

  const rolCol = cols.rows.some(r => r.column_name === 'agent_role') ? 'agent_role' : cols.rows.some(r => r.column_name === 'agent_id') ? 'agent_id' : 'role';

  // Recent CLO runs
  const runs = await p.query(
    `SELECT started_at, task, status, model_used, LEFT(result_summary, 250) as summary
     FROM agent_runs WHERE ${rolCol} = 'clo'
     ORDER BY started_at DESC LIMIT 10`
  );
  console.log('\n=== CLO RUNS ===');
  for (const r of runs.rows) {
    console.log(`${r.started_at} | ${r.task} | ${r.status} | ${(r.summary || '').substring(0, 200)}`);
  }

  // Recent CLO activity log
  const activity = await p.query(
    `SELECT created_at, action, LEFT(summary, 250) as summary
     FROM activity_log WHERE agent_role = 'clo'
     ORDER BY created_at DESC LIMIT 10`
  );
  console.log('\n=== CLO ACTIVITY LOG ===');
  for (const r of activity.rows) {
    console.log(`${r.created_at} | ${r.action} | ${(r.summary || '').substring(0, 200)}`);
  }

  // Check tool_calls schema
  const tcCols = await p.query("SELECT column_name FROM information_schema.columns WHERE table_name='tool_calls' ORDER BY ordinal_position");
  if (tcCols.rows.length > 0) {
    console.log('\n=== tool_calls columns ===');
    console.log(tcCols.rows.map(r => r.column_name).join(', '));
  } else {
    console.log('\n=== tool_calls table does not exist ===');
  }

  // Check work assignments that mention equity/board/governance
  const wa = await p.query(
    `SELECT assigned_to, status, LEFT(task_description, 200) as task, completed_at
     FROM work_assignments
     WHERE task_description ILIKE '%equity%' OR task_description ILIKE '%board consent%' OR task_description ILIKE '%governance%' OR task_description ILIKE '%stock reissuance%'
     ORDER BY created_at DESC LIMIT 10`
  );
  console.log('\n=== EQUITY/GOVERNANCE WORK ASSIGNMENTS ===');
  for (const r of wa.rows) {
    console.log(`${r.assigned_to} | ${r.status} | ${(r.task || '').substring(0, 200)} | completed: ${r.completed_at}`);
  }

  // Check directives about equity/governance
  const fd = await p.query(
    `SELECT id, title, status, created_by, LEFT(description, 200) as desc
     FROM founder_directives
     WHERE title ILIKE '%equity%' OR title ILIKE '%stock%' OR title ILIKE '%governance%' OR title ILIKE '%reissu%'
     ORDER BY created_at DESC LIMIT 10`
  );
  console.log('\n=== EQUITY/GOVERNANCE DIRECTIVES ===');
  for (const r of fd.rows) {
    console.log(`${r.id} | ${r.title} | ${r.status} | ${r.created_by} | ${(r.desc || '').substring(0, 150)}`);
  }

  // Search all agent runs in 48h for sharepoint/equity/governance/board-consent/stock keywords
  const spRuns = await p.query(
    `SELECT agent_id, task, started_at, LEFT(result_summary, 300) as summary
     FROM agent_runs
     WHERE started_at > NOW() - INTERVAL '48 hours'
       AND (result_summary ILIKE '%sharepoint%' OR result_summary ILIKE '%board-consent%' OR result_summary ILIKE '%equity%'
            OR result_summary ILIKE '%governance%' OR result_summary ILIKE '%reissu%' OR result_summary ILIKE '%stock%')
     ORDER BY started_at DESC
     LIMIT 15`
  );
  console.log('\n=== AGENT RUNS mentioning SharePoint/equity/governance (48h) ===');
  for (const r of spRuns.rows) {
    console.log(`${r.started_at} | ${r.agent_id} | ${r.task} | ${(r.summary || '').substring(0, 250)}`);
  }
  if (!spRuns.rows.length) console.log('(no matching runs)');

  // Also check output field in agent_runs for the CLO
  const cloOut = await p.query(
    `SELECT started_at, task, LEFT(output, 500) as output
     FROM agent_runs
     WHERE agent_id = 'clo'
       AND started_at > NOW() - INTERVAL '48 hours'
       AND (output ILIKE '%sharepoint%' OR output ILIKE '%draft_legal%' OR output ILIKE '%board-consent%' OR output ILIKE '%upload%')
     ORDER BY started_at DESC
     LIMIT 5`
  );
  console.log('\n=== CLO RUNS with SharePoint/upload in output (48h) ===');
  for (const r of cloOut.rows) {
    console.log(`${r.started_at} | ${r.task} | ${(r.output || '').substring(0, 400)}`);
  }
  if (!cloOut.rows.length) console.log('(no matching CLO output)');

  await p.end();
}
main().catch(e => { console.error(e); process.exit(1); });
