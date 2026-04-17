const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 6543, user: 'glyphor_app', password: 'TempAuth2026x', database: 'glyphor' });

async function main() {
  await c.connect();
  const res = await c.query(
    `INSERT INTO company_agents
       (role, display_name, name, title, department, reports_to, is_core, model, temperature, max_turns, budget_per_run, budget_daily, budget_monthly)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, role, display_name`,
    ['clo', 'Victoria Chase', 'Victoria Chase', 'Chief Legal Officer', 'Legal', 'chief-of-staff', true, 'model-router', 0.30, 50, 0.05, 0.50, 15.00]
  );
  console.log('Inserted:', res.rows[0]);
  await c.end();
}

main().catch(e => { console.error(e.message); c.end(); process.exit(1); });
