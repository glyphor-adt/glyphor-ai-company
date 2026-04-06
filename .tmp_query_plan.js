require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const connectionString = process.env.DATABASE_URL;
  const c = new Client({ connectionString, ssl: false });
  await c.connect();

  const q = `
    SELECT
      t.called_at,
      t.run_id,
      t.agent_id,
      t.tool_name,
      left(t.args::text, 500) AS args_preview,
      left(t.result_data::text, 500) AS result_preview
    FROM tool_call_traces t
    WHERE t.tool_name IN ('plan_website_build','invoke_web_build')
      AND (
        t.args::text ILIKE '%voltage-dallas-nh50sg%'
        OR t.result_data::text ILIKE '%voltage-dallas-nh50sg%'
        OR t.args::text ILIKE '%voltage-dallas%'
        OR t.result_data::text ILIKE '%voltage-dallas%'
        OR t.args::text ILIKE '%nh50sg%'
        OR t.result_data::text ILIKE '%nh50sg%'
      )
    ORDER BY t.called_at DESC
    LIMIT 30
  `;

  const r = await c.query(q);
  console.log(JSON.stringify(r.rows, null, 2));
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
