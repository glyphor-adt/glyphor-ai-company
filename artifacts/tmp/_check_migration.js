const { Client } = require('pg');
(async () => {
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();
  const r = await c.query(
    "SELECT * FROM schema_migrations LIMIT 3"
  );
  console.log('Columns:', Object.keys(r.rows[0] || {}));
  // Check for our migration
  const cols = Object.keys(r.rows[0] || {});
  const nameCol = cols.find(c => c.includes('name') || c.includes('file') || c.includes('migration'));
  console.log('Name column:', nameCol);
  if (nameCol) {
    const mr = await c.query(
      `SELECT * FROM schema_migrations WHERE ${nameCol} LIKE '%180000%'`
    );
    console.log('Match:', JSON.stringify(mr.rows, null, 2));
  }
  // Check table structure
  const s = await c.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'directive_approval_tokens' ORDER BY ordinal_position"
  );
  console.log('Table structure:', JSON.stringify(s.rows, null, 2));
  await c.end();
})();
