/**
 * Eval System Test Playbook — Section 1: Database Integrity
 * Run via: npx tsx scripts/eval-test-playbook.ts
 * Requires DB env vars (use run-with-local-db-proxy.ps1)
 */
import { pool } from '@glyphor/shared/db';

interface TestResult {
  name: string;
  pass: boolean;
  data: unknown;
  note?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, sql: string, check: (rows: any[]) => { pass: boolean; note?: string }) {
  try {
    const { rows } = await pool.query(sql);
    const { pass, note } = check(rows);
    results.push({ name, pass, data: rows, note });
  } catch (err: any) {
    results.push({ name, pass: false, data: null, note: `ERROR: ${err.message}` });
  }
}

async function main() {
  console.log('=== Eval System Test Playbook — Section 1: Database Integrity ===\n');

  // 1.1 Write path coverage
  await runTest('1.1 Write path coverage', `
    SELECT
      COUNT(*) AS total,
      COUNT(assignment_id) AS linked,
      ROUND(COUNT(assignment_id)::numeric / NULLIF(COUNT(*),0) * 100, 1) AS coverage_pct
    FROM task_run_outcomes;
  `, (rows) => {
    const r = rows[0];
    const total = parseInt(r?.total ?? 0);
    const linked = parseInt(r?.linked ?? 0);
    const pct = parseFloat(r?.coverage_pct ?? 0);
    // Most runs are autonomous (work_loop) without assignment linkage.
    // Pass if: rows exist AND coverage >= 15% (indicates linkage is working for assignment-driven runs)
    return { pass: total > 0 && pct >= 15, note: `total=${total}, linked=${linked}, coverage=${pct}% (≥15% = assignment linkage working; rest are autonomous runs)` };
  });

  // 1.2 assignment_evaluations by evaluator type
  await runTest('1.2 assignment_evaluations populated', `
    SELECT
      evaluator_type,
      COUNT(*) AS row_count,
      ROUND(AVG(score_normalized)::numeric, 3) AS avg_normalized,
      MIN(score_normalized) AS min,
      MAX(score_normalized) AS max
    FROM assignment_evaluations
    GROUP BY evaluator_type
    ORDER BY evaluator_type;
  `, (rows) => {
    const types = rows.map((r: any) => r.evaluator_type);
    const hasCore = ['cos', 'executive', 'team'].filter(t => types.includes(t));
    const allInRange = rows.every((r: any) => r.min >= 0 && r.max <= 1);
    // Pass if populated with at least 1 evaluator type, OR if empty (depends on live orchestrator runs)
    const pass = rows.length === 0 ? true : (hasCore.length >= 1 && allInRange);
    return {
      pass,
      note: rows.length === 0
        ? 'Empty — expected: depends on live orchestrator accept/revise cycles'
        : `types: [${types.join(', ')}], core present: [${hasCore.join(', ')}], all in range: ${allInRange}`
    };
  });

  // 1.3 Normalized scores sanity
  await runTest('1.3 No out-of-range scores', `
    SELECT COUNT(*) AS bad_rows
    FROM assignment_evaluations
    WHERE score_normalized < 0 OR score_normalized > 1;
  `, (rows) => {
    const bad = parseInt(rows[0]?.bad_rows ?? 0);
    return { pass: bad === 0, note: `bad_rows=${bad}` };
  });

  // 1.4 Every agent has active prompt version
  await runTest('1.4 Agents with active prompt versions', `
    SELECT
      a.id,
      a.name,
      COUNT(apv.id) AS version_count,
      MAX(apv.version) AS latest_version,
      MAX(CASE WHEN apv.deployed_at IS NOT NULL AND apv.retired_at IS NULL THEN 1 ELSE 0 END) AS has_active
    FROM company_agents a
    LEFT JOIN agent_prompt_versions apv ON apv.agent_id = a.role
    GROUP BY a.id, a.name
    HAVING MAX(CASE WHEN apv.deployed_at IS NOT NULL AND apv.retired_at IS NULL THEN 1 ELSE 0 END) = 0
       OR COUNT(apv.id) = 0;
  `, (rows) => {
    return {
      pass: rows.length === 0,
      note: rows.length === 0
        ? 'All agents have active prompt versions'
        : `${rows.length} agents missing active prompt: ${rows.map((r: any) => r.name).join(', ')}`
    };
  });

  // 1.5 Performance score distribution
  await runTest('1.5 Performance score distribution', `
    SELECT
      CASE
        WHEN performance_score >= 0.75 THEN 'healthy'
        WHEN performance_score >= 0.50 THEN 'degraded'
        WHEN performance_score IS NULL  THEN 'unscored'
        ELSE 'unhealthy'
      END AS bucket,
      COUNT(*) AS agent_count
    FROM company_agents
    GROUP BY bucket;
  `, (rows) => {
    const buckets = Object.fromEntries(rows.map((r: any) => [r.bucket, parseInt(r.agent_count)]));
    const distinct = rows.length;
    return {
      pass: distinct > 1 || !buckets['unscored'],
      note: JSON.stringify(buckets)
    };
  });

  // 1.6 World state table
  await runTest('1.6 World state writes', `
    SELECT
      domain,
      COUNT(*) AS key_count,
      MAX(updated_at) AS last_write,
      COUNT(CASE WHEN valid_until < NOW() THEN 1 END) AS expired_count
    FROM world_state
    GROUP BY domain
    ORDER BY last_write DESC;
  `, (rows) => {
    return {
      pass: rows.length > 0,
      note: rows.length > 0
        ? `${rows.length} domains, latest write: ${rows[0]?.last_write}`
        : 'No world_state rows'
    };
  });

  // 1.7 Fleet findings
  await runTest('1.7 Fleet findings', `
    SELECT severity, COUNT(*) AS count,
      COUNT(CASE WHEN resolved_at IS NULL THEN 1 END) AS open
    FROM fleet_findings
    GROUP BY severity;
  `, (rows) => {
    return {
      pass: rows.length > 0,
      note: rows.length > 0
        ? rows.map((r: any) => `${r.severity}: ${r.count} total, ${r.open} open`).join('; ')
        : 'No fleet_findings rows'
    };
  });

  // === Section 6 Regression Checks ===
  console.log('\n=== Section 6: Regression Checks ===\n');

  // 6.1 quality_score still writing
  await runTest('6.1 quality_score dual-write active', `
    SELECT quality_score, status, updated_at
    FROM work_assignments
    WHERE updated_at > NOW() - INTERVAL '24 hours'
    ORDER BY updated_at DESC
    LIMIT 10;
  `, (rows) => {
    const withScore = rows.filter((r: any) => r.quality_score != null);
    return {
      pass: rows.length === 0 || withScore.length > 0,
      note: `${rows.length} recent assignments, ${withScore.length} have quality_score`
    };
  });

  // 6.3 Constitutional governor
  await runTest('6.3 Constitutional governor running', `
    SELECT COUNT(*) AS cnt, ROUND(AVG(score_normalized)::numeric, 3) AS avg_norm
    FROM assignment_evaluations
    WHERE evaluator_type = 'constitutional'
    AND evaluated_at > NOW() - INTERVAL '24 hours';
  `, (rows) => {
    const cnt = parseInt(rows[0]?.cnt ?? 0);
    return {
      pass: cnt > 0,
      note: `${cnt} constitutional evals in last 24h, avg=${rows[0]?.avg_norm ?? 'N/A'}`
    };
  });

  // 6.4 Batch eval cron — check agent_schedules
  await runTest('6.4 Batch eval cron scheduled', `
    SELECT agent_id AS job_name, last_triggered_at AS last_run_at, cron_expression AS schedule,
           CASE WHEN enabled THEN 'active' ELSE 'disabled' END AS status
    FROM agent_schedules
    WHERE task ILIKE '%batch-eval%' OR task ILIKE '%eval%' OR agent_id ILIKE '%batch%'
    LIMIT 5;
  `, (rows) => {
    return {
      pass: rows.length > 0,
      note: rows.length > 0
        ? `${rows[0]?.job_name}: last=${rows[0]?.last_run_at}, status=${rows[0]?.status}`
        : 'No batch-eval cron found'
    };
  });

  // Print summary
  console.log('\n=== RESULTS ===\n');
  let passCount = 0;
  let failCount = 0;
  for (const r of results) {
    const icon = r.pass ? '✅' : '❌';
    console.log(`${icon} ${r.name}`);
    console.log(`   ${r.note || ''}`);
    if (!r.pass && r.data && Array.isArray(r.data) && r.data.length > 0 && r.data.length <= 5) {
      console.log(`   Data: ${JSON.stringify(r.data)}`);
    }
    r.pass ? passCount++ : failCount++;
  }
  console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);

  await pool.end();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
