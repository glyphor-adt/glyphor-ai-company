require('dotenv').config();
const { Client } = require('pg');
(async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
        const r = await c.query(`
          SELECT t.task_number, t.responsible_agent, r.started_at,
                 s.agent_output, s.reasoning_trace
          FROM cz_runs r
          JOIN cz_tasks t ON t.id = r.task_id
          JOIN cz_scores s ON s.run_id = r.id
          WHERE r.started_at > '2026-04-23 21:25:00+00'
          ORDER BY r.started_at ASC LIMIT 3`);
        r.rows.forEach(row => {
            console.log('\n========================================');
            console.log(`#${row.task_number} [${row.responsible_agent}] started ${row.started_at?.toISOString().slice(11, 19)}`);
            console.log('JUDGE:', (row.reasoning_trace ?? '').slice(0, 300));
            console.log('--- AGENT OUTPUT (first 1500 chars) ---');
            console.log((row.agent_output ?? '(empty)').slice(0, 1500));
        });
    } finally { await c.end(); }
})();
