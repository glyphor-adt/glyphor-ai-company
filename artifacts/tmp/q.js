const { Client } = require('pg');
require('dotenv').config();

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await c.connect();
    const q = process.argv[2];
    const r = await c.query(q);
    console.log(JSON.stringify(r.rows, null, 2));
  } catch (e) {
    console.error(e.message);
  } finally {
    await c.end();
  }
})();
