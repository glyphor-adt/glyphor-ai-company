const {Client}=require('pg');
(async()=>{
  const c=new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });
  try {
    await c.connect();

    // 1. Recent agent runs (last 6 hours)
    const runs = await c.query(`
      SELECT agent_id, task, status, 
             LEFT(error, 200) as error,
             started_at, completed_at,
             EXTRACT(EPOCH FROM (COALESCE(completed_at, now()) - started_at))::int as duration_s
      FROM agent_runs
      WHERE started_at > now() - interval '6 hours'
      ORDER BY started_at DESC
      LIMIT 40
    `);
    console.log('=== RECENT RUNS (last 6h) ===');
    for (const r of runs.rows) {
      console.log(`  ${r.agent_id} | ${r.task} | ${r.status} | ${r.duration_s}s | ${r.started_at} | err: ${r.error || 'none'}`);
    }

    // 2. Run counts by status (24h)
    const statusCounts = await c.query(`
      SELECT status, count(*)::int as cnt
      FROM agent_runs
      WHERE started_at > now() - interval '24 hours'
      GROUP BY status ORDER BY cnt DESC
    `);
    console.log('\n=== RUN STATUS COUNTS (24h) ===');
    for (const r of statusCounts.rows) console.log(`  ${r.status}: ${r.cnt}`);

    // 3. Runs by agent (24h)
    const byAgent = await c.query(`
      SELECT agent_id, count(*)::int as total,
             count(*) FILTER (WHERE status='completed')::int as completed,
             count(*) FILTER (WHERE status='failed')::int as failed,
             count(*) FILTER (WHERE status='aborted')::int as aborted,
             max(started_at) as last_run
      FROM agent_runs
      WHERE started_at > now() - interval '24 hours'
      GROUP BY agent_id ORDER BY total DESC
    `);
    console.log('\n=== RUNS BY AGENT (24h) ===');
    for (const r of byAgent.rows) {
      console.log(`  ${r.agent_id}: total=${r.total} ok=${r.completed} fail=${r.failed} abort=${r.aborted} last=${r.last_run}`);
    }

    // 4. Failed runs with errors (last 12h)
    const failures = await c.query(`
      SELECT agent_id, task, LEFT(error, 300) as error, started_at
      FROM agent_runs
      WHERE started_at > now() - interval '12 hours'
        AND (status='failed' OR status='aborted')
      ORDER BY started_at DESC
      LIMIT 20
    `);
    console.log('\n=== FAILURES (last 12h) ===');
    for (const r of failures.rows) {
      console.log(`  ${r.started_at} | ${r.agent_id} | ${r.task} | ${r.error}`);
    }

    // 5. Active directives and their assignment state
    const directives = await c.query(`
      SELECT fd.id, fd.title, fd.priority, fd.status, fd.created_at,
             count(wa.id)::int as assignment_count,
             count(wa.id) FILTER (WHERE wa.status IN ('completed','submitted'))::int as done_count
      FROM founder_directives fd
      LEFT JOIN work_assignments wa ON wa.directive_id = fd.id
      WHERE fd.status = 'active'
      GROUP BY fd.id
      ORDER BY fd.created_at DESC
      LIMIT 15
    `);
    console.log('\n=== ACTIVE DIRECTIVES ===');
    for (const r of directives.rows) {
      console.log(`  ${r.title} | priority=${r.priority} | assignments=${r.assignment_count} done=${r.done_count} | created=${r.created_at}`);
    }

    // 6. Work assignments status summary
    const assignments = await c.query(`
      SELECT status, count(*)::int as cnt
      FROM work_assignments
      WHERE created_at > now() - interval '7 days'
      GROUP BY status ORDER BY cnt DESC
    `);
    console.log('\n=== ASSIGNMENT STATUS (7d) ===');
    for (const r of assignments.rows) console.log(`  ${r.status}: ${r.cnt}`);

    // 7. Last briefing/notification to founders
    const briefings = await c.query(`
      SELECT agent_id, task, status, started_at, completed_at
      FROM agent_runs
      WHERE task IN ('morning_briefing', 'eod_summary', 'generate_briefing')
      ORDER BY started_at DESC
      LIMIT 10
    `);
    console.log('\n=== RECENT BRIEFINGS ===');
    for (const r of briefings.rows) {
      console.log(`  ${r.started_at} | ${r.agent_id} | ${r.task} | ${r.status}`);
    }

    // 8. Agent statuses
    const agents = await c.query(`
      SELECT role, status
      FROM company_agents
      ORDER BY role
    `);
    console.log('\n=== AGENT STATUSES ===');
    for (const r of agents.rows) {
      console.log(`  ${r.role}: ${r.status}`);
    }

  } catch(e) { console.error('ERROR:', e.message); }
  finally { try { await c.end() } catch {} }
})();
