const pg = require('pg');
const client = new pg.Client('postgresql://glyphor_system_user:lGHMxoC8zpmngKUaYv9cOTwJ@136.111.200.6:5432/glyphor');

async function updateTodo() {
  try {
    await client.connect();
    console.log('Connected to database');
    
    const result = await client.query("UPDATE todos SET status = 'done' WHERE id = 'audit-tooling-sections'");
    
    console.log('Updated ' + result.rowCount + ' row(s)');
    console.log('Status: SUCCESS');
    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
    console.log('Status: BLOCKED - Database connection failed');
    process.exit(1);
  }
}

updateTodo();
