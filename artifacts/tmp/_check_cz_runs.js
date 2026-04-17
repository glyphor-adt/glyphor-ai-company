const { Client } = require('pg');
const c = new Client({ host:'127.0.0.1', port:6543, database:'glyphor', user:'glyphor_app', password:'TempAuth2026x' });

(async () => {
  await c.connect();

  // Check schema first
  const cols = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='cz_runs' ORDER BY ordinal_position");
  console.log('cz_runs columns:', cols.rows.map(x => x.column_name).join(', '));
  const cols2 = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='cz_scores' ORDER BY ordinal_position");
  console.log('cz_scores columns:', cols2.rows.map(x => x.column_name).join(', '));

  // Get most recent batches
  const batch = await c.query(`
    SELECT batch_id, MIN(started_at) as started, MAX(completed_at) as ended,
      EXTRACT(EPOCH FROM (MAX(completed_at) - MIN(started_at))) as duration_secs,
      COUNT(*) as total_runs
    FROM cz_runs 
    GROUP BY batch_id
    ORDER BY MIN(started_at) DESC LIMIT 3
  `);
  console.log('=== RECENT BATCHES ===');
  console.table(batch.rows);

  if (batch.rows.length > 0) {
    // Use the 89-run scored batch instead
    const bid = 'f448d363-5c8f-4d01-8170-c6e0525a6953';
    console.log('\n=== SCORES FOR 89-RUN BATCH: ' + bid + ' ===');

    // Check cz_tasks columns
    const tcols = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='cz_tasks' ORDER BY ordinal_position");
    console.log('cz_tasks columns:', tcols.rows.map(x => x.column_name).join(', '));

    const scores = await c.query(`
      SELECT s.judge_tier, s.judge_score, s.passed, r.latency_ms, 
             r.status, r.started_at, r.completed_at,
             LENGTH(s.agent_output) as output_len,
             LEFT(s.reasoning_trace, 150) as trace_preview
      FROM cz_scores s 
      JOIN cz_runs r ON r.id = s.run_id 
      WHERE r.batch_id = $1
      ORDER BY s.judge_score DESC LIMIT 20
    `, [bid]);
    console.table(scores.rows);

    // Aggregate stats
    const stats = await c.query(`
      SELECT s.judge_tier, COUNT(*) as cnt, 
             ROUND(AVG(s.judge_score)::numeric, 2) as avg_score,
             ROUND(AVG(r.latency_ms)::numeric, 0) as avg_latency_ms,
             SUM(CASE WHEN s.passed THEN 1 ELSE 0 END) as passed_count
      FROM cz_scores s 
      JOIN cz_runs r ON r.id = s.run_id
      WHERE r.batch_id = $1
      GROUP BY s.judge_tier
    `, [bid]);
    console.log('\n=== TIER BREAKDOWN ===');
    console.table(stats.rows);

    // Check for suspiciously fast runs
    const fast = await c.query(`
      SELECT COUNT(*) as fast_runs FROM cz_runs 
      WHERE batch_id = $1 AND latency_ms < 2000
    `, [bid]);
    console.log('\nRuns under 2 seconds:', fast.rows[0].fast_runs);

    // Check for empty or very short outputs
    const short = await c.query(`
      SELECT COUNT(*) as short_outputs FROM cz_scores s
      JOIN cz_runs r ON r.id = s.run_id
      WHERE r.batch_id = $1 AND LENGTH(s.agent_output) < 100
    `, [bid]);
    console.log('Outputs under 100 chars:', short.rows[0].short_outputs);

    // Check how many runs have NO score at all
    const noscore = await c.query(`
      SELECT r.status, COUNT(*) as cnt FROM cz_runs r
      LEFT JOIN cz_scores s ON s.run_id = r.id
      WHERE r.batch_id = $1
      GROUP BY r.status
    `, [bid]);
    console.log('\n=== RUN STATUS BREAKDOWN (latest batch) ===');
    console.table(noscore.rows);

    // Check ALL batches for overall picture
    const allBatches = await c.query(`
      SELECT r.batch_id, r.status, COUNT(*) as cnt,
        ROUND(AVG(COALESCE(s.judge_score, 0))::numeric, 2) as avg_score,
        SUM(CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END) as scored_count
      FROM cz_runs r
      LEFT JOIN cz_scores s ON s.run_id = r.id
      GROUP BY r.batch_id, r.status
      ORDER BY r.batch_id DESC
    `);
    console.log('\n=== ALL BATCHES STATUS ===');
    console.table(allBatches.rows);

    // Timing analysis for the 89-run batch
    const timing = await c.query(`
      SELECT MIN(r.started_at) as first_start, MAX(r.completed_at) as last_complete,
        EXTRACT(EPOCH FROM (MAX(r.completed_at) - MIN(r.started_at))) as wall_clock_secs,
        ROUND(AVG(r.latency_ms)::numeric, 0) as avg_latency_ms,
        MIN(r.latency_ms) as min_latency_ms,
        MAX(r.latency_ms) as max_latency_ms,
        ROUND(AVG(r.tokens_in)::numeric, 0) as avg_tokens_in,
        ROUND(AVG(r.tokens_out)::numeric, 0) as avg_tokens_out,
        ROUND(SUM(r.cost_usd)::numeric, 4) as total_cost_usd
      FROM cz_runs r WHERE r.batch_id = $1
    `, [bid]);
    console.log('\n=== TIMING ANALYSIS (89-run batch) ===');
    console.table(timing.rows);

    // Sample a few actual agent outputs
    const samples = await c.query(`
      SELECT s.judge_score, s.judge_tier, r.latency_ms,
             LEFT(s.agent_output, 200) as output_start,
             LEFT(s.reasoning_trace, 200) as judge_reasoning
      FROM cz_scores s 
      JOIN cz_runs r ON r.id = s.run_id
      WHERE r.batch_id = $1
      ORDER BY RANDOM() LIMIT 3
    `, [bid]);
    console.log('\n=== RANDOM SAMPLE OUTPUTS ===');
    for (const s of samples.rows) {
      console.log('---');
      console.log('Score:', s.judge_score, '| Tier:', s.judge_tier, '| Latency:', s.latency_ms + 'ms');
      console.log('Output:', s.output_start);
      console.log('Judge:', s.judge_reasoning);
    }
  }

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
