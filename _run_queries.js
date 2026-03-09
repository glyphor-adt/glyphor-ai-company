const { Client } = require('pg');
const c = new Client({
  host: '127.0.0.1',
  port: 5434,
  user: 'glyphor_app',
  password: 'lGHMxoC8zpmngKUaYv9cOTwJ',
  database: 'glyphor'
});

async function run() {
  await c.connect();

  console.log('=== Q1: HEARTBEAT RUNS ===');
  const r1 = await c.query(`
    SELECT started_at, status, turns, cost,
      LEFT(output, 500) as output_preview,
      LEFT(error, 500) as error_preview
    FROM agent_runs WHERE task = 'heartbeat'
    ORDER BY started_at DESC LIMIT 10
  `);
  console.table(r1.rows);

  console.log('\n=== Q2: WORK_LOOP RUNS (last 2h) ===');
  const r2 = await c.query(`
    SELECT agent_id, started_at, status, turns,
      LEFT(output, 300) as output_preview,
      LEFT(error, 300) as error_preview
    FROM agent_runs WHERE task = 'work_loop'
      AND started_at > NOW() - INTERVAL '2 hours'
    ORDER BY started_at DESC LIMIT 20
  `);
  console.table(r2.rows);

  console.log('\n=== Q3: DISPATCHED ASSIGNMENTS ===');
  const r3 = await c.query(`
    SELECT wa.assigned_to, wa.status, wa.priority,
      LEFT(wa.task_description, 100) as task,
      wa.created_at, wa.updated_at, fd.title as directive
    FROM work_assignments wa
    JOIN founder_directives fd ON fd.id = wa.directive_id
    WHERE wa.status IN ('dispatched', 'pending', 'in_progress', 'blocked')
    ORDER BY wa.updated_at DESC
  `);
  console.table(r3.rows);

  console.log('\n=== Q4: WAKE QUEUE ===');
  const r4 = await c.query(`
    SELECT * FROM agent_wake_queue ORDER BY created_at DESC LIMIT 20
  `);
  console.table(r4.rows);

  console.log('\n=== Q5: RECENT EVENTS (last 1h) ===');
  const r5 = await c.query(`
    SELECT type, source, processed_by, timestamp
    FROM events WHERE timestamp > NOW() - INTERVAL '1 hour'
    ORDER BY timestamp DESC LIMIT 15
  `);
  console.table(r5.rows);

  console.log('\n=== Q6: ALL AGENT RUNS (last 30 min) ===');
  const r6 = await c.query(`
    SELECT agent_id, task, status, started_at, turns,
      LEFT(error, 200) as error_preview
    FROM agent_runs WHERE started_at > NOW() - INTERVAL '30 minutes'
    ORDER BY started_at DESC LIMIT 20
  `);
  console.table(r6.rows);

  await c.end();
}

run().catch(e => { console.error(e.message); c.end(); });
