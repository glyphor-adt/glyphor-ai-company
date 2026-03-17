const { Client } = require('pg');

function toPort(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function buildDbConfig() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    return { connectionString };
  }

  return {
    host: process.env.DB_HOST || process.env.PGHOST || '127.0.0.1',
    port: toPort(process.env.DB_PORT || process.env.PGPORT, 6543),
    user: process.env.DB_USER || process.env.PGUSER || 'glyphor_app',
    password: process.env.DB_PASSWORD || process.env.PGPASSWORD,
    database: process.env.DB_NAME || process.env.PGDATABASE || 'glyphor',
  };
}

function printableConfig(config) {
  if (config.connectionString) {
    return { connectionString: '[set]' };
  }

  return {
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
    password: config.password ? '[set]' : '[not set]',
  };
}

async function runQuery(client, sql) {
  const result = await client.query(sql);
  console.log(JSON.stringify({ rowCount: result.rowCount, rows: result.rows }, null, 2));
}

async function runDefaultDashboard(client) {
  console.log('=== Q1: HEARTBEAT RUNS ===');
  const r1 = await client.query(`
    SELECT started_at, status, turns, cost,
      LEFT(output, 500) as output_preview,
      LEFT(error, 500) as error_preview
    FROM agent_runs WHERE task = 'heartbeat'
    ORDER BY started_at DESC LIMIT 10
  `);
  console.table(r1.rows);

  console.log('\n=== Q2: WORK_LOOP RUNS (last 2h) ===');
  const r2 = await client.query(`
    SELECT agent_id, started_at, status, turns,
      LEFT(output, 300) as output_preview,
      LEFT(error, 300) as error_preview
    FROM agent_runs WHERE task = 'work_loop'
      AND started_at > NOW() - INTERVAL '2 hours'
    ORDER BY started_at DESC LIMIT 20
  `);
  console.table(r2.rows);

  console.log('\n=== Q3: DISPATCHED ASSIGNMENTS ===');
  const r3 = await client.query(`
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
  const r4 = await client.query(`
    SELECT * FROM agent_wake_queue ORDER BY created_at DESC LIMIT 20
  `);
  console.table(r4.rows);

  console.log('\n=== Q5: RECENT EVENTS (last 1h) ===');
  const r5 = await client.query(`
    SELECT type, source, processed_by, timestamp
    FROM events WHERE timestamp > NOW() - INTERVAL '1 hour'
    ORDER BY timestamp DESC LIMIT 15
  `);
  console.table(r5.rows);

  console.log('\n=== Q6: ALL AGENT RUNS (last 30 min) ===');
  const r6 = await client.query(`
    SELECT agent_id, task, status, started_at, turns,
      LEFT(error, 200) as error_preview
    FROM agent_runs WHERE started_at > NOW() - INTERVAL '30 minutes'
    ORDER BY started_at DESC LIMIT 20
  `);
  console.table(r6.rows);
}

async function main() {
  const config = buildDbConfig();
  const sqlArg = process.argv.slice(2).join(' ').trim();

  if (!config.connectionString && !config.password) {
    console.error('Missing DB password. Set DB_PASSWORD or PGPASSWORD (or provide DATABASE_URL).');
    console.error('Resolved config:', JSON.stringify(printableConfig(config)));
    process.exit(1);
  }

  const client = new Client(config);

  try {
    await client.connect();
    if (sqlArg) {
      await runQuery(client, sqlArg);
    } else {
      await runDefaultDashboard(client);
    }
  } catch (err) {
    const e = err;
    console.error(e.message);
    if (e.code === 'ECONNREFUSED') {
      console.error('Connection refused. Check cloud-sql-proxy/local Postgres and DB host/port settings.');
      console.error('Resolved config:', JSON.stringify(printableConfig(config)));
    }
    process.exitCode = 1;
  } finally {
    try {
      await client.end();
    } catch {}
  }
}

main();
