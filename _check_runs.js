const { Client } = require('pg');

(async () => {
    const c = new Client({
        host: '127.0.0.1',
        port: 6543,
        database: 'glyphor',
        user: 'glyphor_app',
        password: 'TempAuth2026x'
    });

    try {
        await c.connect();
        const r = await c.query(`
            SELECT ar.id, ar.agent_id, ar.status, 
                   substring(ar.error, 1, 120) as err, 
                   ar.created_at,
                   ar.model_used
            FROM agent_runs ar
            WHERE ar.created_at > NOW() - INTERVAL '1 hour' 
            ORDER BY ar.created_at DESC 
            LIMIT 15
        `);
        for (const row of r.rows) {
            console.log(`${row.status} | ${row.agent_id || 'unknown'} | ${row.model_used || ''} | ${row.err || ''} | ${row.created_at}`);
        }
        if (r.rows.length === 0) console.log('No runs in the last hour');
    } catch (e) {
        console.error(e.message);
    } finally {
        await c.end();
    }
})();
