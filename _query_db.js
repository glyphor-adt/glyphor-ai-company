const { Client } = require('pg');

(async () => {
    const c = new Client({
        host: '127.0.0.1',
        port: 6543,
        database: 'glyphor',
        user: 'glyphor_app',
        password: process.env.DB_PASSWORD
    });

    try {
        await c.connect();
        const r = await c.query("SELECT * FROM runtime_tools WHERE name IN ('create_decision', 'query_gcp_billing')");
        console.log(JSON.stringify(r.rows, null, 2));
    } catch (e) {
        console.error(e.message);
    } finally {
        await c.end();
    }
})();