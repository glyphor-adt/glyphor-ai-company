const { Pool } = require('pg');
const p = new Pool({ host: '127.0.0.1', port: 5434, user: 'glyphor_system_user', password: 'lGHMxoC8zpmngKUaYv9cOTwJ', database: 'glyphor' });

(async () => {
  const c = await p.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='agent_runs' ORDER BY ordinal_position");
  console.log('=== COLUMNS ===');
  c.rows.forEach(r => console.log(r.column_name, r.data_type, r.is_nullable));

  const v = await p.query("SELECT verification_tier, count(*) FROM agent_runs WHERE started_at > now() - interval '30 days' GROUP BY verification_tier ORDER BY count DESC");
  console.log('\n=== verification_tier (30d) ===');
  v.rows.forEach(r => console.log(JSON.stringify(r.verification_tier), r.count));

  const s = await p.query("SELECT subtask_complexity, count(*) FROM agent_runs WHERE started_at > now() - interval '30 days' GROUP BY subtask_complexity ORDER BY count DESC");
  console.log('\n=== subtask_complexity (30d) ===');
  s.rows.forEach(r => console.log(JSON.stringify(r.subtask_complexity), r.count));

  const m = await p.query("SELECT routing_model, count(*) FROM agent_runs WHERE started_at > now() - interval '30 days' GROUP BY routing_model ORDER BY count DESC LIMIT 10");
  console.log('\n=== routing_model (30d) ===');
  m.rows.forEach(r => console.log(JSON.stringify(r.routing_model), r.count));

  p.end();
})();
