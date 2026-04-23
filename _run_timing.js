require('dotenv').config();
const { Client } = require('pg');
(async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
        console.log('=== Individual run timeline (last 30 min) ===');
        const runs = await c.query(`
          SELECT t.task_number, t.responsible_agent,
                 r.started_at, r.completed_at, r.status,
                 r.latency_ms,
                 s.passed, ROUND(s.judge_score::numeric, 1) AS score,
                 substring(coalesce(s.heuristic_failures[1], '') from 1 for 45) AS first_heur
          FROM cz_runs r
          LEFT JOIN cz_tasks t ON t.id = r.task_id
          LEFT JOIN cz_scores s ON s.run_id = r.id
          WHERE r.started_at > NOW() - INTERVAL '30 minutes'
          ORDER BY r.started_at DESC LIMIT 25`);
        runs.rows.forEach(r => {
            const mark = r.passed === true ? '✓' : r.passed === false ? '✗' : '·';
            const start = r.started_at?.toISOString().slice(11, 19);
            const compl = r.completed_at?.toISOString().slice(11, 19) ?? 'running';
            console.log(`  ${mark} #${r.task_number} [${r.responsible_agent}] started ${start} done ${compl} score=${r.score ?? '—'} ${r.first_heur ?? ''}`);
        });
    } finally { await c.end(); }
})();
