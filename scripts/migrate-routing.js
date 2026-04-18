const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 6543, database: 'glyphor', user: 'glyphor_app', password: 'TempAuth2026x' });

async function run() {
  await c.connect();
  await c.query('BEGIN');
  try {
    await c.query("UPDATE routing_config SET model_slug = 'gemini-3.1-pro-preview' WHERE route_name = 'complex_research'");
    await c.query("UPDATE routing_config SET model_slug = 'claude-sonnet-4-6' WHERE route_name = 'financial_complex'");

    // Verify no retired models remain
    const check = await c.query(`
      SELECT route_name, model_slug FROM routing_config
      WHERE model_slug NOT IN (
        'claude-opus-4-7', 'claude-sonnet-4-6',
        'gpt-5.4-pro', 'gpt-5.4', 'gpt-5.4-mini',
        'model-router', 'gpt-5-mini', 'gpt-5-nano',
        'o3-pro', 'o3', 'o4-mini',
        'deepseek-r1', 'deepseek-v3-2',
        'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview'
      )
    `);

    if (check.rows.length > 0) {
      console.error('ROLLBACK — invalid models found:', check.rows);
      await c.query('ROLLBACK');
    } else {
      await c.query('COMMIT');
      console.log('COMMITTED — routing_config updated');
      const final = await c.query('SELECT route_name, model_slug, priority FROM routing_config ORDER BY priority DESC');
      console.table(final.rows);
    }
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('ROLLBACK on error:', e.message);
  }
  await c.end();
}

run().catch(e => console.error(e.message));
