require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const result = await client.query(
    "select table_name, column_name from information_schema.columns where table_name in ('company_agents','agent_profiles') and column_name in ('knowledge_access_scope','tenant_id','created_via','created_by_client_id','authority_scope') order by table_name, column_name"
  );
  console.log(JSON.stringify(result.rows, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

