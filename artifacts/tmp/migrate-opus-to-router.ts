import pg from 'pg';
const { Client } = pg;
async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const r = await client.query(`
    UPDATE company_agents
    SET model = 'model-router', updated_at = NOW()
    WHERE model = 'claude-opus-4-6'
    RETURNING role, display_name, model
  `);
  console.log(`Migrated ${r.rowCount} agent(s) from claude-opus-4-6 → model-router`);
  if (r.rows.length > 0) console.table(r.rows);

  // Verify
  const check = await client.query(`
    SELECT model, COUNT(*) AS agents FROM company_agents WHERE status = 'active' GROUP BY model ORDER BY agents DESC
  `);
  console.log('\nCurrent model distribution:');
  console.table(check.rows);

  await client.end();
}
main().catch(console.error);
