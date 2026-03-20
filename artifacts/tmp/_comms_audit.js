const { Client } = require('pg');

async function run() {
  const c = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await c.connect();

  // 1. Are briefings actually running and producing output?
  console.log('\n=== 1. MORNING BRIEFINGS & EOD SUMMARIES (7 days) ===');
  const q1 = await c.query(`
    SELECT task, status, tool_calls, total_cost_usd, model_used,
      substring(output from 1 for 500) as out,
      substring(error from 1 for 300) as err,
      created_at
    FROM agent_runs
    WHERE agent_id = 'chief-of-staff'
      AND task IN ('morning_briefing', 'eod_summary', 'midday_digest')
      AND created_at > now() - interval '7 days'
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.log(`  TOTAL: ${q1.rows.length} briefing runs in 7 days`);
  for (const r of q1.rows) {
    console.log(`  [${r.status}] ${r.task} | ${r.created_at} | tools=${r.tool_calls} | $${r.total_cost_usd}`);
    if (r.err) console.log(`    ERR: ${r.err.replace(/\n/g, ' ')}`);
    if (r.out) console.log(`    OUT: ${r.out.replace(/\n/g, ' ').substring(0, 300)}`);
  }

  // 2. Has send_briefing or send_teams_dm actually been used to talk to founders?
  console.log('\n=== 2. ACTIVITY LOG: DMs TO FOUNDERS (7 days) ===');
  try {
    const q2 = await c.query(`
      SELECT agent_role, action, summary, 
        substring(details::text from 1 for 300) as det,
        created_at
      FROM activity_log
      WHERE (summary ILIKE '%DM sent to kristina%' OR summary ILIKE '%DM sent to andrew%'
             OR summary ILIKE '%briefing%' OR action = 'briefing_sent')
        AND created_at > now() - interval '7 days'
      ORDER BY created_at DESC
      LIMIT 20
    `);
    console.log(`  TOTAL: ${q2.rows.length} founder DM/briefing entries`);
    for (const r of q2.rows) {
      console.log(`  ${r.agent_role} | ${r.action} | ${r.summary} | ${r.created_at}`);
    }
  } catch (e) {
    console.log(`  (activity_log query failed: ${e.message})`);
  }

  // 3. Check if AgentNotifier <notify> blocks are in any agent outputs
  console.log('\n=== 3. NOTIFY BLOCKS IN AGENT OUTPUTS (48h) ===');
  const q3 = await c.query(`
    SELECT agent_id, task, 
      substring(output from 1 for 2000) as out,
      created_at
    FROM agent_runs
    WHERE created_at > now() - interval '48 hours'
      AND status = 'completed'
      AND output LIKE '%<notify%'
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.log(`  TOTAL: ${q3.rows.length} runs with <notify> blocks`);
  for (const r of q3.rows) {
    // Extract notify blocks
    const notifs = (r.out || '').match(/<notify[^>]*>[\s\S]*?<\/notify>/gi) || [];
    console.log(`  ${r.agent_id}/${r.task} | ${r.created_at} | ${notifs.length} notify blocks`);
    for (const n of notifs) console.log(`    ${n.substring(0, 200)}`);
  }

  // 4. Delegation chain - who assigned work to whom?
  console.log('\n=== 4. WORK ASSIGNMENT DELEGATION CHAIN (48h) ===');
  const q4 = await c.query(`
    SELECT assigned_by, assigned_to, status, task_type,
      substring(task_description from 1 for 120) as descr,
      created_at
    FROM work_assignments
    WHERE created_at > now() - interval '48 hours'
    ORDER BY created_at DESC
    LIMIT 30
  `);
  // Count delegation patterns
  const delegations = {};
  for (const r of q4.rows) {
    const key = `${r.assigned_by} → ${r.assigned_to}`;
    delegations[key] = (delegations[key] || 0) + 1;
  }
  console.log('  DELEGATION PATTERNS:');
  for (const [k, v] of Object.entries(delegations).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k}: ${v} assignments`);
  }

  // 5. Are sub-team leads delegating to their reports?
  console.log('\n=== 5. DELEGATION BY LEVEL (48h) ===');
  const q5 = await c.query(`
    SELECT assigned_by, assigned_to, status, 
      substring(task_description from 1 for 100) as descr
    FROM work_assignments
    WHERE created_at > now() - interval '48 hours'
      AND assigned_by NOT IN ('chief-of-staff')
    ORDER BY created_at DESC
    LIMIT 20
  `);
  console.log(`  NON-SARAH DELEGATIONS: ${q5.rows.length}`);
  for (const r of q5.rows) {
    console.log(`  ${r.assigned_by} → ${r.assigned_to} [${r.status}]: "${r.descr}"`);
  }

  // 6. What's in the agent_messages table? Inter-agent comms?
  console.log('\n=== 6. INTER-AGENT MESSAGES (48h) ===');
  try {
    const q6 = await c.query(`
      SELECT from_agent, to_agent, 
        substring(content from 1 for 200) as msg,
        created_at
      FROM agent_messages
      WHERE created_at > now() - interval '48 hours'
      ORDER BY created_at DESC
      LIMIT 20
    `);
    console.log(`  TOTAL: ${q6.rows.length} messages`);
    for (const r of q6.rows) {
      console.log(`  ${r.from_agent} → ${r.to_agent} | ${r.created_at}`);
      console.log(`    "${r.msg}"`);
    }
  } catch (e) {
    console.log(`  (agent_messages: ${e.message})`);
  }

  // 7. What does the send_briefing tool actually output?
  console.log('\n=== 7. SEND_BRIEFING USAGE (check outputs for "briefing" keyword) ===');
  const q7 = await c.query(`
    SELECT agent_id, task, 
      substring(output from 1 for 1000) as out,
      tool_calls,
      created_at
    FROM agent_runs
    WHERE agent_id = 'chief-of-staff'
      AND task IN ('morning_briefing', 'eod_summary')
      AND status = 'completed'
      AND created_at > now() - interval '7 days'
    ORDER BY created_at DESC
    LIMIT 5
  `);
  for (const r of q7.rows) {
    console.log(`\n  ${r.task} | ${r.created_at} | tools=${r.tool_calls}`);
    console.log(`  OUT: ${(r.out || '(none)').replace(/\n/g, ' ').substring(0, 800)}`);
  }

  // 8. Are there any Teams-related errors?
  console.log('\n=== 8. TEAMS/DM ERRORS (48h) ===');
  const q8 = await c.query(`
    SELECT agent_id, task, 
      substring(output from 1 for 500) as out,
      created_at
    FROM agent_runs
    WHERE created_at > now() - interval '48 hours'
      AND status = 'completed'
      AND (output ILIKE '%teams dm%failed%' OR output ILIKE '%send_teams_dm%error%' 
           OR output ILIKE '%A365 DM%failed%' OR output ILIKE '%briefing%failed%'
           OR output ILIKE '%send_briefing%error%')
    ORDER BY created_at DESC
    LIMIT 10
  `);
  console.log(`  ${q8.rows.length} runs with Teams/DM errors`);
  for (const r of q8.rows) {
    console.log(`  ${r.agent_id}/${r.task} | ${r.created_at}`);
    // Find the relevant section
    const match = (r.out || '').match(/(teams|dm|briefing|a365)[^.]{0,200}/gi);
    if (match) console.log(`    ${match.slice(0, 3).join(' | ')}`);
  }

  // 9. Check deliverables table
  console.log('\n=== 9. DELIVERABLES PRODUCED (48h) ===');
  try {
    const q9 = await c.query(`
      SELECT id, agent_role, title, type, status,
        created_at
      FROM deliverables
      WHERE created_at > now() - interval '48 hours'
      ORDER BY created_at DESC
      LIMIT 15
    `);
    console.log(`  TOTAL: ${q9.rows.length} deliverables`);
    for (const r of q9.rows) {
      console.log(`  ${r.agent_role} | "${r.title}" | type=${r.type} | status=${r.status} | ${r.created_at}`);
    }
  } catch (e) {
    console.log(`  (deliverables: ${e.message})`);
  }

  await c.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
