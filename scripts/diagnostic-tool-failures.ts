/**
 * Runs fleet / tool diagnostic SQL (see user playbook).
 * Usage:
 *   npx tsx scripts/run-with-gcp-db-secret.ts --db-user glyphor_app --db-password-secret db-password scripts/diagnostic-tool-failures.ts
 * Or with DATABASE_URL already set:
 *   npx tsx scripts/diagnostic-tool-failures.ts
 */
import { pool, closePool } from '@glyphor/shared/db';

const Q1 = `
SELECT
  tct.tool_name,
  COUNT(*) AS failure_count,
  MAX(tct.called_at) AS last_failure,
  LEFT(tct.result_error, 200) AS error_sample
FROM tool_call_traces tct
WHERE tct.result_success = FALSE
AND tct.called_at > NOW() - INTERVAL '24 hours'
GROUP BY tct.tool_name, LEFT(tct.result_error, 200)
ORDER BY failure_count DESC
LIMIT 30
`;

const Q2 = `
SELECT
  tool_name,
  COUNT(*) AS failures,
  LEFT(result_error, 200) AS error
FROM tool_call_traces
WHERE agent_id = 'cto'
AND result_success = FALSE
AND called_at > NOW() - INTERVAL '7 days'
GROUP BY tool_name, LEFT(result_error, 200)
ORDER BY failures DESC
LIMIT 20
`;

const Q3 = `
SELECT agent_id, finding_type, description, detected_at
FROM fleet_findings
WHERE finding_type ILIKE '%tool%'
AND resolved_at IS NULL
ORDER BY severity ASC, detected_at DESC
`;

const Q4 = `
SELECT ttr.tool_name, ttr.status, ttr.error_type, ttr.error_message
FROM tool_test_results ttr
WHERE ttr.status = 'fail'
AND ttr.test_run_id = (
  SELECT id FROM tool_test_runs ORDER BY started_at DESC LIMIT 1
)
ORDER BY ttr.error_type, ttr.tool_name
`;

const Q5 = `
SELECT
  name,
  api_config,
  implementation_type,
  notes
FROM tool_registry
WHERE name IN (
  'list_cloud_builds',
  'get_cloud_build_logs',
  'get_data_freshness'
)
`;

async function main(): Promise<void> {
  const sections: { title: string; rows: unknown[]; error?: string }[] = [];

  for (const [title, sql] of [
    ['1. Tool failures last 24h (by tool + error sample)', Q1],
    ['2. CTO (Marcus) failures last 7d', Q2],
    ['3. Open fleet findings (tool-related)', Q3],
    ['4. Latest tool_test_run failures', Q4],
    ['5. tool_registry rows (Marcus tools)', Q5],
  ] as const) {
    try {
      const { rows } = await pool.query(sql);
      sections.push({ title, rows });
    } catch (e) {
      sections.push({
        title,
        rows: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), sections }, null, 2));
  await closePool();
}

main().catch(async (e) => {
  console.error(e);
  await closePool().catch(() => {});
  process.exit(1);
});
