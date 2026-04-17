const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://glyphor_system_user:a7JwuQFobpCzZI+JWyPhCSheZFvIt2OA0rjt9FJvtJ4CaagtOM9p72mdTCM5IHzN@127.0.0.1:6543/glyphor'
});

async function main() {
  await c.connect();

  // Trust score columns
  const cols = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='agent_trust_scores' ORDER BY ordinal_position");
  console.log('TRUST SCORE COLS:', cols.rows.map(r => r.column_name).join(', '));

  // Top trust scores
  const ts = await c.query('SELECT agent_role, trust_score, suspended FROM agent_trust_scores ORDER BY trust_score DESC LIMIT 10');
  console.log('\n=== TOP TRUST SCORES ===');
  console.table(ts.rows);

  // Completion rates (30d) for active agents
  const cr = await c.query(`
    SELECT agent_id,
      COUNT(*) as total_runs,
      COUNT(*) FILTER (WHERE status = 'completed') as completed,
      ROUND(COUNT(*) FILTER (WHERE status = 'completed')::numeric / NULLIF(COUNT(*), 0), 3) as completion_rate
    FROM agent_runs
    WHERE created_at > NOW() - INTERVAL '30 days'
    GROUP BY agent_id
    ORDER BY total_runs DESC
    LIMIT 15
  `);
  console.log('\n=== COMPLETION RATES (30d) ===');
  console.table(cr.rows);

  // Check if daily eval has ever run - look at scheduler logs
  const hist = await c.query('SELECT * FROM autonomy_level_history ORDER BY created_at DESC LIMIT 5');
  console.log('\n=== LEVEL HISTORY (last 5) ===');
  console.table(hist.rows);

  // Check max_allowed_level distribution
  const mal = await c.query('SELECT max_allowed_level, COUNT(*) as cnt FROM agent_autonomy_config GROUP BY max_allowed_level');
  console.log('\n=== MAX ALLOWED LEVEL DISTRIBUTION ===');
  console.table(mal.rows);

  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
