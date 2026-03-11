const pg = require('pg');
const client = new pg.Client('postgresql://glyphor_system_user:lGHMxoC8zpmngKUaYv9cOTwJ@136.111.200.6:5432/glyphor');

async function listTables() {
  try {
    await client.connect();
    console.log('Connected to database');
    
    const result = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    
    console.log('Tables found:');
    result.rows.forEach(row => console.log('  - ' + row.table_name));
    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

listTables();
