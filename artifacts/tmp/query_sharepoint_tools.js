const { Client } = require('pg');
const fs = require('fs');
(async () => {
  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || '6543'),
    database: process.env.DB_NAME || 'glyphor',
    user: process.env.DB_USER || 'glyphor_app',
    password: process.env.DB_PASSWORD,
  });
  await client.connect();
  const query = "SELECT DISTINCT tool_name FROM agent_tool_calls WHERE tool_name ILIKE 'mcp_ODSPRemoteServer%' OR tool_name ILIKE '%odsp%' OR tool_name ILIKE '%sharepoint%' ORDER BY tool_name";
  const result = await client.query(query);
  fs.writeFileSync('artifacts/tmp/sharepoint_tool_inventory.json', JSON.stringify(result.rows, null, 2));
  await client.end();
  console.log('wrote artifacts/tmp/sharepoint_tool_inventory.json');
})().catch((error) => {
  fs.writeFileSync('artifacts/tmp/sharepoint_tool_inventory.error.txt', String(error && (error.stack || error.message || error)));
  console.error(String(error && (error.message || error)));
  process.exit(1);
});
