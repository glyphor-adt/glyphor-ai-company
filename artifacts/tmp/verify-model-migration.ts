import pg from 'pg';
const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Verify: any agents still on retired models?
  const check = await client.query(`
    SELECT role, model FROM company_agents
    WHERE model IN ('gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash')
  `);
  console.log(`Agents on retired models: ${check.rows.length}`);
  if (check.rows.length > 0) console.table(check.rows);

  // Count by model
  const summary = await client.query(`
    SELECT model, COUNT(*) AS agents
    FROM company_agents
    WHERE status = 'active'
    GROUP BY model
    ORDER BY agents DESC
  `);
  console.log('\n=== Active Agent Model Distribution ===');
  console.table(summary.rows);

  // Check default
  const def = await client.query(`
    SELECT column_default
    FROM information_schema.columns
    WHERE table_name = 'company_agents' AND column_name = 'model'
  `);
  console.log('\nDefault model column value:', def.rows[0]?.column_default);

  await client.end();
}
main().catch(console.error);
