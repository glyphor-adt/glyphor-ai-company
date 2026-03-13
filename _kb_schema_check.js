const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function dbUrl() {
  const envPath = path.join(process.cwd(), '.env');
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  return line ? line.slice('DATABASE_URL='.length).trim() : process.env.DATABASE_URL;
}

(async () => {
  const pool = new Pool({ connectionString: dbUrl() });
  const res = await pool.query("SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name='company_knowledge_base' ORDER BY ordinal_position");
  console.table(res.rows);
  await pool.end();
})().catch((e) => {
  console.error('SCHEMA_CHECK_FAILED:', e.message);
  process.exit(1);
});
