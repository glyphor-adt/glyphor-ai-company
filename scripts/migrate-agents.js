const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 6543, database: 'glyphor', user: 'glyphor_app', password: 'TempAuth2026x' });

async function run() {
  await c.connect();
  await c.query('BEGIN');
  try {
    // High-tier orchestration
    await c.query("UPDATE company_agents SET model = 'claude-sonnet-4-6' WHERE display_name = 'Sarah Chen'");
    // Code/infrastructure specialists
    await c.query("UPDATE company_agents SET model = 'deepseek-v3-2' WHERE display_name IN ('Jordan Hayes', 'Alex Park')");
    // Research upgrade
    await c.query("UPDATE company_agents SET model = 'gemini-3.1-pro-preview' WHERE display_name = 'Sophia Lin'");
    // Everyone else on gpt-4o -> model-router
    await c.query("UPDATE company_agents SET model = 'model-router' WHERE model = 'gpt-4o'");

    // Sanity check
    const check = await c.query(
      "SELECT display_name, model FROM company_agents WHERE model IN ('gpt-4o','gpt-4o-mini','claude-sonnet-4-5','claude-haiku-4-5','claude-opus-4-6','gemini-2.5-flash-lite','gemini-2.5-flash','gemini-3-flash-preview')"
    );
    if (check.rows.length > 0) {
      console.error('ROLLBACK — deprecated models still found:', check.rows);
      await c.query('ROLLBACK');
    } else {
      await c.query('COMMIT');
      console.log('COMMITTED — company_agents updated');
      const final = await c.query('SELECT role, display_name, model FROM company_agents ORDER BY role');
      console.table(final.rows);
    }
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('ROLLBACK on error:', e.message);
  }
  await c.end();
}

run().catch(e => console.error(e.message));
