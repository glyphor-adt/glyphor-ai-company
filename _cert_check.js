require('dotenv').config();
const { Client } = require('pg');
(async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
        const latest = await c.query(`
          SELECT r.batch_id, r.trigger_type,
                 MIN(r.started_at) AS started,
                 MAX(r.completed_at) AS completed,
                 COUNT(*) AS runs,
                 COUNT(*) FILTER (WHERE r.status = 'completed') AS done,
                 COUNT(*) FILTER (WHERE s.passed = true) AS pass,
                 COUNT(*) FILTER (WHERE s.passed = false) AS fail,
                 ROUND(AVG(s.judge_score)::numeric, 2) AS avg_score
          FROM cz_runs r
          LEFT JOIN cz_scores s ON s.run_id = r.id
          WHERE r.started_at > NOW() - INTERVAL '30 minutes'
          GROUP BY r.batch_id, r.trigger_type
          ORDER BY started DESC LIMIT 8`);
        console.table(latest.rows.map(r => ({
            batch: r.batch_id?.slice(0, 8),
            trig: r.trigger_type,
            runs: r.runs,
            done: r.done,
            pass: r.pass,
            fail: r.fail,
            avg: r.avg_score,
            started: r.started?.toISOString().slice(11, 19),
            completed: r.completed?.toISOString().slice(11, 19) ?? '—',
        })));

        console.log('\n=== Sample of most recent scored runs ===');
        const recent = await c.query(`
          SELECT t.task_number, t.responsible_agent,
                 s.passed, ROUND(s.judge_score::numeric, 1) AS score,
                 s.heuristic_failures
          FROM cz_runs r
          JOIN cz_tasks t ON t.id = r.task_id
          JOIN cz_scores s ON s.run_id = r.id
          WHERE r.started_at > NOW() - INTERVAL '30 minutes'
          ORDER BY s.created_at DESC LIMIT 15`);
        recent.rows.forEach(r => {
            const mark = r.passed ? '✓' : '✗';
            console.log(`  ${mark} #${r.task_number} [${r.responsible_agent}] ${r.score}`);
            if (r.heuristic_failures?.length) {
                const first = r.heuristic_failures[0].split(':')[0];
                console.log(`     → ${first}`);
            }
        });
    } finally { await c.end(); }
})();
