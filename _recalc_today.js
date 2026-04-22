const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 6543, database: 'glyphor', user: 'glyphor_app', password: process.env.DB_PASSWORD });
  await c.connect();
  const RATES = {
    'gemini-3.1-pro-preview':        { in: 2.50, out: 15.00, think: 15.00, cache: 0.25 },
    'gemini-3.1-pro':                { in: 2.50, out: 15.00, think: 15.00, cache: 0.25 },
    'gemini-3.1-flash-lite-preview': { in: 0.10, out: 0.40,  think: 0.40,  cache: 0.25 },
    'gemini-3.1-flash-lite':         { in: 0.10, out: 0.40,  think: 0.40,  cache: 0.25 },
    'gemini-3-flash-preview':        { in: 1.25, out: 5.00,  think: 5.00,  cache: 0.25 },
    'gemini-3-flash':                { in: 1.25, out: 5.00,  think: 5.00,  cache: 0.25 },
    'gemini-2.5-pro':                { in: 1.25, out: 10.00, think: 10.00, cache: 0.25 },
    'gemini-2.5-flash':              { in: 0.15, out: 0.60,  think: 0.60,  cache: 0.25 },
    'gemini-2.5-flash-lite':         { in: 0.075,out: 0.30,  think: 0.30,  cache: 0.25 },
  };
  // Before
  const before = await c.query(`SELECT ROUND(SUM(total_cost_usd)::numeric,2) usd, COUNT(*)::int n FROM agent_runs WHERE started_at >= CURRENT_DATE`);
  console.log('BEFORE today:', before.rows[0]);

  // Recompute for Gemini runs today using correct rates
  let updated = 0;
  for (const [model, r] of Object.entries(RATES)) {
    const res = await c.query(`
      UPDATE agent_runs
      SET total_cost_usd = (
        COALESCE(total_input_tokens,0)::numeric * $2::numeric / 1000000.0
        + COALESCE(total_output_tokens,0)::numeric * $3::numeric / 1000000.0
        + COALESCE(total_thinking_tokens,0)::numeric * $4::numeric / 1000000.0
      )
      WHERE started_at >= CURRENT_DATE
        AND (actual_model = $1 OR (actual_model IS NULL AND model_used = $1))
      RETURNING id`, [model, String(r.in), String(r.out), String(r.think)]);
    if (res.rowCount) { console.log('updated', model, res.rowCount); updated += res.rowCount; }
  }
  const after = await c.query(`SELECT ROUND(SUM(total_cost_usd)::numeric,2) usd, COUNT(*)::int n FROM agent_runs WHERE started_at >= CURRENT_DATE`);
  console.log('AFTER today:', after.rows[0], '— updated', updated, 'rows');
  await c.end();
})();
