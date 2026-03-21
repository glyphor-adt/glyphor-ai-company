const { Client } = require('pg');

(async () => {
  const runId = '849662b1-83b8-4b46-9eed-8561101fd0ab';
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  await client.connect();

  const statusCounts = await client.query(
    'SELECT status, COUNT(*)::int AS count FROM tool_test_results WHERE test_run_id = $1 GROUP BY status ORDER BY status',
    [runId]
  );

  const skipReasons = await client.query(
    "SELECT COALESCE(error_message, '(none)') AS reason, COUNT(*)::int AS count FROM tool_test_results WHERE test_run_id = $1 AND status = 'skip' GROUP BY COALESCE(error_message, '(none)') ORDER BY count DESC, reason ASC",
    [runId]
  );

  const nonSkipped = await client.query(
    "SELECT tool_name, status, error_type, error_message, test_strategy, risk_tier FROM tool_test_results WHERE test_run_id = $1 AND status <> 'skip' ORDER BY tool_name",
    [runId]
  );

  console.log('STATUS_COUNTS=' + JSON.stringify(statusCounts.rows));
  console.log('SKIP_REASONS=' + JSON.stringify(skipReasons.rows));
  console.log('NON_SKIPPED=' + JSON.stringify(nonSkipped.rows));

  await client.end();
})();
