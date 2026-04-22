const { Client } = require('pg');
(async () => {
    const c = new Client({ host: '127.0.0.1', port: 6543, database: 'glyphor', user: 'glyphor_app', password: process.env.DB_PASSWORD });
    await c.connect();
    const tables = ['cz_shadow_evals', 'cz_tasks', 'cz_runs', 'cz_scores', 'agent_prompt_versions'];
    for (const t of tables) {
        const r = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t]);
        console.log(`\n=== ${t} ===`);
        for (const row of r.rows) console.log(`  ${row.column_name} : ${row.data_type}`);
    }
    await c.end();
})();
