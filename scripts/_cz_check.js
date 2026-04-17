const { Client } = require('pg');
const c = new Client({ host:'127.0.0.1', port:6543, database:'glyphor', user:'glyphor_app', password:'TempAuth2026x' });
c.connect().then(async () => {
  const r = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'cz%' ORDER BY table_name");
  for (const t of r.rows) {
    const cnt = await c.query('SELECT count(*) FROM ' + t.table_name);
    console.log(t.table_name + ': ' + cnt.rows[0].count + ' rows');
  }
  await c.end();
});
