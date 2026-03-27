import pg from 'pg';
const { Client } = pg;
async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`ALTER TABLE company_agents ALTER COLUMN model SET DEFAULT 'model-router'`);
  console.log('Default model column updated to model-router');
  await client.end();
}
main().catch(console.error);
