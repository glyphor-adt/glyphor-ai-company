import pg from 'pg';
const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Get actual columns of gcp_billing
  const cols = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'gcp_billing' 
    ORDER BY ordinal_position
  `);
  console.log('gcp_billing columns:');
  console.table(cols.rows);

  // Sample row
  const sample = await client.query(`SELECT * FROM gcp_billing LIMIT 3`);
  console.log('\nSample rows:');
  for (const row of sample.rows) {
    console.log(JSON.stringify(row, null, 2));
  }

  await client.end();
}
main().catch(console.error);
