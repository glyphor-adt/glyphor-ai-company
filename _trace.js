const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 6543, database: 'glyphor', user: 'glyphor_app', password: process.env.DB_PASSWORD });
  await c.connect();
  const q = async (l,s) => { try { const r = await c.query(s); console.log('\n==', l, '=='); console.table(r.rows); } catch(e) { console.log(l, 'ERR', e.message); } };

  // Pull full agent_run record for one of the recent CZ-like marcus runs
  await q('marcus recent runs (input/output)', `
    SELECT id, task, status,
           LEFT(COALESCE(input::text,''), 400) input400,
           LEFT(COALESCE(output::text,''), 400) output400,
           routing_model, actual_model, started_at
    FROM agent_runs
    WHERE agent_id=(SELECT id FROM company_agents WHERE name LIKE 'Marcus%' LIMIT 1)
      AND started_at > NOW()-INTERVAL '6 hours'
    ORDER BY started_at DESC LIMIT 8`);

  // Is the cz_run linked to an agent_run? If not, how are they executed?
  // Let's see if CZ run IDs appear as input in any agent_run
  await q('cz -> agent_runs correlation sample', `
    SELECT ar.id ar_id, ar.task ar_task, ar.started_at ar_started,
           ar.routing_model, ar.actual_model,
           LEFT(ar.input::text, 300) ar_input300
    FROM agent_runs ar
    WHERE ar.started_at > NOW()-INTERVAL '1 hour'
      AND ar.input::text ILIKE '%Customer Zero%'
    ORDER BY ar.started_at DESC LIMIT 5`);

  // Or: are CZ-dispatched runs bypassing agent_runs altogether?
  await q('agent_runs sources + task today', `SELECT source, task, COUNT(*)::int n FROM agent_runs WHERE started_at >= DATE '2026-04-23' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20`);

  // Check input field of failed work_loop runs for cues
  await q('failed work_loop input sample', `
    SELECT ar.task, LEFT(COALESCE(ar.input::text,''), 500) input500, ar.error
    FROM agent_runs ar
    WHERE ar.status='failed' AND ar.started_at > NOW()-INTERVAL '4 hours'
    ORDER BY ar.started_at DESC LIMIT 5`);

  await c.end();
})();
