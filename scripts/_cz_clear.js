const { Client } = require('pg');
const c = new Client({ host:'127.0.0.1', port:6543, database:'glyphor', user:'glyphor_app', password:'TempAuth2026x' });
c.connect().then(async () => {
  // Order matters: scores references runs. cz_latest_scores is a view, auto-clears.
  await c.query('DELETE FROM cz_scores');
  console.log('cz_scores cleared');
  await c.query('DELETE FROM cz_runs');
  console.log('cz_runs cleared');

  // Reset latest_* on tasks so the grid shows clean state
  await c.query("UPDATE cz_tasks SET latest_pass = NULL, latest_score = NULL, latest_judge_tier = NULL, latest_run_at = NULL");
  console.log('cz_tasks latest_* columns reset to NULL');

  // Verify
  for (const t of ['cz_scores','cz_runs','cz_latest_scores']) {
    const r = await c.query('SELECT count(*) FROM ' + t);
    console.log(t + ': ' + r.rows[0].count + ' rows');
  }
  await c.end();
});
