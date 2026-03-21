const { Client } = require('pg');

(async () => {
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  await client.connect();
  const result = await client.query(
    "select tool_name,status,error_type,error_message,connectivity_ok,response_ms,test_strategy from tool_test_results where test_run_id='1dc6c6ad-5a23-4bde-b8f7-c0590cd9ed5a' order by status, tool_name"
  );
  console.log(JSON.stringify(result.rows, null, 2));
  await client.end();
})();
