/**
 * Eval Test Playbook — Section 2: API Endpoints
 *
 * Validates each /api/eval/* endpoint's SQL queries return
 * correct data shapes and meaningful content.
 */
import { systemQuery } from '@glyphor/shared/db';

interface TestResult {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
}

const results: TestResult[] = [];

function record(id: string, name: string, pass: boolean, detail: string) {
  results.push({ id, name, pass, detail });
  const icon = pass ? '✅' : '❌';
  console.log(`${icon} ${id} ${name}: ${detail}`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Section 2 — API Endpoint Validation');
  console.log('═══════════════════════════════════════════════\n');

  // ── 2.1 GET /api/eval/fleet ──────────────────────────────
  try {
    const rows = await systemQuery(`
      WITH eval_scores AS (
        SELECT
          wa.assigned_to AS agent_id,
          AVG(ae.score_normalized) FILTER (WHERE ae.evaluator_type = 'executive' AND ae.evaluated_at > NOW() - INTERVAL '30 days') AS exec_quality,
          AVG(ae.score_normalized) FILTER (WHERE ae.evaluator_type = 'team'      AND ae.evaluated_at > NOW() - INTERVAL '30 days') AS team_quality,
          AVG(ae.score_normalized) FILTER (WHERE ae.evaluator_type = 'cos'       AND ae.evaluated_at > NOW() - INTERVAL '30 days') AS cos_quality,
          AVG(ae.score_normalized) FILTER (WHERE ae.evaluator_type = 'constitutional' AND ae.evaluated_at > NOW() - INTERVAL '30 days') AS constitutional_score
        FROM work_assignments wa
        JOIN assignment_evaluations ae ON ae.assignment_id = wa.id
        GROUP BY wa.assigned_to
      ),
      run_stats AS (
        SELECT
          agent_id,
          AVG(CASE WHEN status = 'completed' THEN 1.0 ELSE 0.0 END)
            FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS success_rate,
          MAX(created_at) AS last_run_at
        FROM agent_runs
        GROUP BY agent_id
      ),
      finding_counts AS (
        SELECT
          agent_id,
          COUNT(*) FILTER (WHERE severity = 'P0' AND resolved_at IS NULL) AS open_p0s,
          COUNT(*) FILTER (WHERE severity = 'P1' AND resolved_at IS NULL) AS open_p1s
        FROM fleet_findings
        GROUP BY agent_id
      ),
      prompt_info AS (
        SELECT DISTINCT ON (agent_id)
          agent_id, version AS prompt_version, source AS prompt_source
        FROM agent_prompt_versions
        WHERE deployed_at IS NOT NULL AND retired_at IS NULL
        ORDER BY agent_id, deployed_at DESC
      ),
      mutation_counts AS (
        SELECT
          agent_id,
          COUNT(*) FILTER (WHERE source = 'reflection')      AS reflection_mutations,
          COUNT(*) FILTER (WHERE source = 'shadow_promoted')  AS promoted_mutations
        FROM agent_prompt_versions
        GROUP BY agent_id
      )
      SELECT
        a.id,
        a.role,
        a.display_name AS name,
        a.department,
        a.performance_score,
        pi.prompt_version,
        pi.prompt_source,
        es.exec_quality,
        es.team_quality,
        es.cos_quality,
        es.constitutional_score,
        rs.success_rate,
        COALESCE(fc.open_p0s, 0)  AS open_p0s,
        COALESCE(fc.open_p1s, 0)  AS open_p1s,
        COALESCE(mc.reflection_mutations, 0) AS reflection_mutations,
        COALESCE(mc.promoted_mutations, 0)   AS promoted_mutations,
        rs.last_run_at
      FROM company_agents a
      LEFT JOIN eval_scores es     ON es.agent_id = a.role
      LEFT JOIN run_stats rs       ON rs.agent_id = a.role
      LEFT JOIN finding_counts fc  ON fc.agent_id = a.role
      LEFT JOIN prompt_info pi     ON pi.agent_id = a.role
      LEFT JOIN mutation_counts mc ON mc.agent_id = a.role
      ORDER BY a.performance_score ASC NULLS LAST
    `);

    const count = rows.length;
    const withRole = rows.filter((r: any) => r.role);
    const withName = rows.filter((r: any) => r.name);
    const withScore = rows.filter((r: any) => r.performance_score != null);
    const withRunStats = rows.filter((r: any) => r.success_rate != null);
    const withPrompt = rows.filter((r: any) => r.prompt_version != null);

    const checks: string[] = [];
    if (count >= 30) checks.push(`${count} agents (≥30 ✓)`);
    else checks.push(`${count} agents (<30 ✗)`);

    checks.push(`${withRole.length} have role, ${withName.length} have name`);
    checks.push(`${withScore.length} have perf score, ${withRunStats.length} have run stats`);
    checks.push(`${withPrompt.length} have prompt version`);

    // Check required fields exist on first row
    const sample = rows[0] as any;
    const requiredFields = ['id', 'role', 'name', 'performance_score'];
    const missing = requiredFields.filter(f => !(f in sample));

    const pass = count >= 30 && missing.length === 0 && withRole.length === count;
    record('2.1', 'GET /api/eval/fleet', pass,
      `${checks.join(' | ')}${missing.length ? ` | Missing fields: ${missing.join(', ')}` : ''}`);

    // Print a sample row for inspection
    console.log('  Sample row:', JSON.stringify(sample, null, 2).split('\n').map(l => '    ' + l).join('\n'));
  } catch (err) {
    record('2.1', 'GET /api/eval/fleet', false, `Query error: ${(err as Error).message}`);
  }

  // ── 2.2 GET /api/eval/agent/:agentId/trend?days=30 ──────
  try {
    const testAgent = 'cto'; // known active agent
    const days = 30;

    const [trend, promptVersions] = await Promise.all([
      systemQuery(`
        SELECT
          DATE_TRUNC('day', tro.created_at) AS day,
          AVG(ae.score_normalized) AS avg_quality,
          AVG(CASE WHEN ar.status = 'completed' THEN 1.0 ELSE 0.0 END) AS success_rate,
          COUNT(tro.id) AS run_count
        FROM task_run_outcomes tro
        JOIN agent_runs ar ON ar.id = tro.run_id
        LEFT JOIN assignment_evaluations ae ON ae.run_id = tro.run_id
        WHERE ar.agent_id = $1
          AND tro.created_at > NOW() - MAKE_INTERVAL(days => $2)
        GROUP BY day
        ORDER BY day ASC
      `, [testAgent, days]),
      systemQuery(`
        SELECT version, deployed_at, source, change_summary, performance_score_at_deploy
        FROM agent_prompt_versions
        WHERE agent_id = $1 AND deployed_at IS NOT NULL
        ORDER BY deployed_at ASC
      `, [testAgent]),
    ]);

    const trendDays = trend.length;
    const pvCount = promptVersions.length;
    const totalRuns = trend.reduce((sum: number, r: any) => sum + parseInt(r.run_count || 0), 0);
    const hasDayField = trend.length > 0 && 'day' in (trend[0] as any);
    const hasVersionField = pvCount > 0 && 'version' in (promptVersions[0] as any);

    const pass = trendDays > 0 && pvCount > 0 && hasDayField;
    record('2.2', `GET /api/eval/agent/${testAgent}/trend?days=30`, pass,
      `${trendDays} trend days, ${totalRuns} total runs, ${pvCount} prompt versions` +
      `${hasDayField ? '' : ' | ⚠ missing day field'}${hasVersionField ? '' : ' | ⚠ missing version field'}`);
  } catch (err) {
    record('2.2', 'GET /api/eval/agent/cto/trend', false, `Query error: ${(err as Error).message}`);
  }

  // ── 2.3 GET /api/eval/agent/:agentId/shadow ─────────────
  try {
    const testAgent = 'cto';
    const rows = await systemQuery(`
      SELECT
        challenger_prompt_version,
        baseline_prompt_version,
        COUNT(*)                                      AS run_count,
        AVG(challenger_score)                          AS avg_challenger,
        AVG(baseline_score)                            AS avg_baseline,
        AVG(challenger_score) - AVG(baseline_score)    AS delta,
        MIN(created_at)                                AS first_run,
        MAX(created_at)                                AS last_run
      FROM shadow_runs
      WHERE agent_id = $1
      GROUP BY challenger_prompt_version, baseline_prompt_version
      ORDER BY last_run DESC
    `, [testAgent]);

    // Shadow runs may be empty — that's OK as long as the query succeeds
    const pass = true; // query executed without error = pass
    record('2.3', `GET /api/eval/agent/${testAgent}/shadow`, pass,
      `${rows.length} shadow groups returned (empty is acceptable — no shadow cycles yet)`);
  } catch (err) {
    record('2.3', 'GET /api/eval/agent/cto/shadow', false, `Query error: ${(err as Error).message}`);
  }

  // ── 2.4 GET /api/eval/world-state ────────────────────────
  try {
    const rows = await systemQuery<{ freshness: string; [k: string]: unknown }>(`
      SELECT
        id, domain, key, entity_id, written_by_agent, confidence,
        updated_at, valid_until,
        EXTRACT(EPOCH FROM (NOW() - updated_at)) / 3600 AS age_hours,
        CASE
          WHEN valid_until IS NOT NULL AND valid_until < NOW() THEN 'expired'
          WHEN domain = 'customer'     AND updated_at < NOW() - INTERVAL '24 hours'  THEN 'stale'
          WHEN domain = 'campaign'     AND updated_at < NOW() - INTERVAL '6 hours'   THEN 'stale'
          WHEN domain = 'strategy'     AND updated_at < NOW() - INTERVAL '7 days'    THEN 'stale'
          WHEN domain = 'agent_output' AND updated_at < NOW() - INTERVAL '48 hours'  THEN 'stale'
          ELSE 'fresh'
        END AS freshness
      FROM world_state
      ORDER BY age_hours DESC
    `);

    const summary = {
      total: rows.length,
      fresh: rows.filter(r => r.freshness === 'fresh').length,
      stale: rows.filter(r => r.freshness === 'stale').length,
      expired: rows.filter(r => r.freshness === 'expired').length,
    };

    const hasSummary = typeof summary.total === 'number';
    const hasEntries = Array.isArray(rows);
    const hasRequiredFields = rows.length === 0 || ('domain' in (rows[0] as any) && 'freshness' in (rows[0] as any));

    const pass = hasSummary && hasEntries && hasRequiredFields;
    record('2.4', 'GET /api/eval/world-state', pass,
      `Summary: ${JSON.stringify(summary)} | ${rows.length} entries` +
      `${hasRequiredFields ? '' : ' | ⚠ missing required fields'}`);
  } catch (err) {
    record('2.4', 'GET /api/eval/world-state', false, `Query error: ${(err as Error).message}`);
  }

  // ── 2.5 GET /api/eval/cost-latency ──────────────────────
  try {
    const rows = await systemQuery(`
      SELECT
        agent_id,
        AVG(input_tokens + output_tokens + COALESCE(thinking_tokens, 0)) AS avg_tokens,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_latency_ms,
        AVG(duration_ms)            AS avg_latency_ms,
        AVG(estimated_cost_usd)     AS avg_cost_usd,
        COUNT(*)                    AS run_count
      FROM agent_runs
      WHERE created_at > NOW() - INTERVAL '30 days'
        AND input_tokens IS NOT NULL
      GROUP BY agent_id
      ORDER BY avg_cost_usd DESC NULLS LAST
    `);

    const agentCount = rows.length;
    const hasFields = agentCount === 0 || (
      'agent_id' in (rows[0] as any) &&
      'avg_tokens' in (rows[0] as any) &&
      'p95_latency_ms' in (rows[0] as any) &&
      'avg_cost_usd' in (rows[0] as any)
    );
    const totalRuns = rows.reduce((sum: number, r: any) => sum + parseInt(r.run_count || 0), 0);

    // The endpoint returns rows or null; we just need it to execute
    const pass = hasFields && agentCount > 0;
    record('2.5', 'GET /api/eval/cost-latency', pass,
      `${agentCount} agents with cost data, ${totalRuns} total runs (30d)` +
      `${hasFields ? '' : ' | ⚠ missing required fields'}`);

    if (agentCount > 0) {
      const top = rows[0] as any;
      console.log(`  Top agent by cost: ${top.agent_id} — $${parseFloat(top.avg_cost_usd).toFixed(4)}/run, P95 ${parseFloat(top.p95_latency_ms).toFixed(0)}ms`);
    }
  } catch (err) {
    record('2.5', 'GET /api/eval/cost-latency', false, `Query error: ${(err as Error).message}`);
  }

  // ── Summary ──────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`  Section 2 Result: ${passed}/${total} passed`);
  console.log('═══════════════════════════════════════════════');

  if (passed < total) {
    console.log('\nFailed checks:');
    results.filter(r => !r.pass).forEach(r => console.log(`  ${r.id} ${r.name}: ${r.detail}`));
  }

  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
