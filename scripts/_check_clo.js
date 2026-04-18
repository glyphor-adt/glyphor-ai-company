const pg = require('pg');
const c = new pg.Client({
  host: '127.0.0.1',
  port: 6543,
  database: 'glyphor',
  user: 'glyphor_app',
  password: 'TempAuth2026x'
});

async function main() {
  await c.connect();
  const res = await c.query(
    "SELECT role, tenant_id, display_name FROM company_agents WHERE role IN ('clo','cto','cfo') ORDER BY role"
  );
  console.table(res.rows);
  await c.end();
}

main().catch(e => { console.error(e); c.end(); });
