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
    "select name, category, parameters, api_config from tool_registry where name='search_frontend_code' and is_active=true"
  );
  console.log(JSON.stringify(result.rows, null, 2));
  await client.end();
})();
