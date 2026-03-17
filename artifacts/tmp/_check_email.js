const { Client } = require('pg');
const { execSync } = require('child_process');
const fs = require('fs');

(async () => {
  // Get password from gcloud
  let password;
  try {
    password = execSync(
      'gcloud secrets versions access latest --secret=db-password --project=ai-glyphor-company',
      { encoding: 'utf8', timeout: 60000 }
    ).trim();
  } catch (e) {
    fs.writeFileSync('artifacts/tmp/_email_diag.txt', 'GCLOUD ERROR: ' + e.message);
    process.exit(1);
  }

  const c = new Client({
    host: '127.0.0.1',
    port: 6543,
    database: 'glyphor',
    user: 'glyphor_app',
    password,
  });

  const lines = [];
  const log = (...args) => { lines.push(args.join(' ')); };

  try {
    await c.connect();

    // Sarah's recent runs
    const runs = await c.query(`
      SELECT id, task, status, tool_calls, created_at,
             substring(error from 1 for 500) as err,
             substring(output from 1 for 1500) as out
      FROM agent_runs
      WHERE agent_id = 'chief-of-staff'
        AND created_at > now() - interval '2 hours'
      ORDER BY created_at DESC
      LIMIT 5
    `);

    log('=== SARAH RUNS (last 2 hrs) ===');
    for (const row of runs.rows) {
      log(`\n--- ${row.created_at} | ${row.task} | ${row.status} | tools=${row.tool_calls}`);
      if (row.err) log('ERR:', row.err);
      if (row.out) log('OUT:', row.out.slice(0, 800));
    }

    // Check if tool_calls table exists and query email-related tools
    try {
      const tc = await c.query(`
        SELECT tool_name, result_status, count(*) as cnt, max(called_at) as last_call,
               substring(string_agg(result_message, ' ||| ') from 1 for 500) as msgs
        FROM agent_tool_calls
        WHERE agent_id = 'chief-of-staff'
          AND called_at > now() - interval '2 hours'
          AND (tool_name ILIKE '%email%' OR tool_name ILIKE '%mail%' OR tool_name ILIKE '%reply%' 
               OR tool_name ILIKE '%attach%' OR tool_name ILIKE '%send%' OR tool_name ILIKE '%sharepoint%')
        GROUP BY tool_name, result_status
        ORDER BY last_call DESC
      `);
      log('\n=== EMAIL/SHAREPOINT TOOL CALLS ===');
      for (const row of tc.rows) {
        log(`  ${row.tool_name} (${row.result_status}) x${row.cnt} last=${row.last_call}`);
        if (row.msgs) log('    msgs:', row.msgs.slice(0, 300));
      }
    } catch (e) {
      log('\nNo agent_tool_calls table or query failed:', e.message);
    }

    await c.end();
  } catch (e) {
    log('DB ERROR:', e.message);
  }

  fs.writeFileSync('artifacts/tmp/_email_diag.txt', lines.join('\n'));
  process.stdout.write('DONE\n');
})();
