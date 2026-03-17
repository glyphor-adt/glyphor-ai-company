const { Client } = require('pg');
(async () => {
  const c = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 15432),
    database: process.env.DB_NAME || 'glyphor',
    user: process.env.DB_USER || 'glyphor_app',
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // Recent CLO runs
  const runs = await c.query(
    "SELECT task, status, tool_calls, created_at, substring(output from 1 for 800) as out FROM agent_runs WHERE agent_id='clo' AND created_at > now() - interval '7 days' ORDER BY created_at DESC LIMIT 8"
  );
  console.log('=== RECENT CLO RUNS ===');
  console.log(JSON.stringify(runs.rows, null, 2));

  // Recent CLO work assignments
  const assignments = await c.query(
    "SELECT id, task_description, status, quality_score, evaluation, created_at, updated_at FROM work_assignments WHERE assigned_to='clo' AND created_at > now() - interval '14 days' ORDER BY created_at DESC LIMIT 10"
  );
  console.log('\n=== RECENT CLO ASSIGNMENTS ===');
  console.log(JSON.stringify(assignments.rows, null, 2));

  // Recent CLO deliverables  
  try {
    const deliverables = await c.query(
      "SELECT id, title, type, status, agent_role, created_at FROM deliverables WHERE agent_role='clo' AND created_at > now() - interval '14 days' ORDER BY created_at DESC LIMIT 10"
    );
    console.log('\n=== RECENT CLO DELIVERABLES ===');
    console.log(JSON.stringify(deliverables.rows, null, 2));
  } catch(e) { console.log('deliverables query failed:', e.message); }

  // Recent tool calls for CLO
  const toolCalls = await c.query(
    "SELECT tool_name, count(*) as cnt, max(created_at) as last_used FROM agent_tool_calls WHERE agent_role='clo' AND created_at > now() - interval '7 days' GROUP BY tool_name ORDER BY cnt DESC LIMIT 20"
  );
  console.log('\n=== CLO TOOL USAGE (7 days) ===');
  console.log(JSON.stringify(toolCalls.rows, null, 2));

  await c.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
