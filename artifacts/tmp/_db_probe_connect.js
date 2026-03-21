const { Client } = require('pg');

(async () => {
  const connectionString = process.env.DATABASE_URL;
  const client = connectionString
    ? new Client({ connectionString, connectionTimeoutMillis: 5000 })
    : new Client({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectionTimeoutMillis: 5000,
      });

  try {
    await client.connect();
    const result = await client.query('select current_user as user_name, inet_server_addr()::text as server_addr, inet_server_port() as server_port');
    console.log(JSON.stringify({ ok: true, row: result.rows[0] }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: String(error.message || error) }));
    process.exitCode = 1;
  } finally {
    try { await client.end(); } catch {}
  }
})();
