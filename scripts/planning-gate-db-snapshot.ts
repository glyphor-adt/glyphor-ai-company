/**
 * Completion-gate telemetry from agent_run_events (same source as Governance).
 *
 *   npx tsx scripts/planning-gate-db-snapshot.ts
 *   npx tsx scripts/planning-gate-db-snapshot.ts --window 7
 *
 * Loads `.env` from cwd (DATABASE_URL or discrete PG_* vars per @glyphor/shared/db).
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { systemQuery, closePool } from '@glyphor/shared/db';

function parseWindow(argv: string[]): 7 | 30 | 90 {
  const idx = argv.indexOf('--window');
  if (idx < 0 || idx + 1 >= argv.length) return 30;
  const n = parseInt(argv[idx + 1], 10);
  if (n === 7 || n === 30 || n === 90) return n;
  throw new Error(`--window must be 7, 30, or 90 (got ${argv[idx + 1]})`);
}

async function main(): Promise<void> {
  const windowDays = parseWindow(process.argv.slice(2));

  const topCriteria = await systemQuery<{ criterion: string; fail_count: string }>(
    `SELECT
       TRIM(criteria.value) AS criterion,
       COUNT(*)::text AS fail_count
     FROM agent_run_events e
     CROSS JOIN LATERAL jsonb_array_elements_text(
       CASE
         WHEN jsonb_typeof((e.payload)::jsonb -> 'missing_criteria') = 'array'
           THEN (e.payload)::jsonb -> 'missing_criteria'
         ELSE '[]'::jsonb
       END
     ) AS criteria(value)
     WHERE e.created_at >= NOW() - ($1::int * INTERVAL '1 day')
       AND e.event_type = 'completion_gate_failed'
     GROUP BY TRIM(criteria.value)
     HAVING TRIM(criteria.value) <> ''
     ORDER BY COUNT(*) DESC, criterion ASC
     LIMIT 15`,
    [windowDays],
  );

  const recentFails = await systemQuery<{
    created_at: Date;
    role: string | null;
    task: string | null;
    missing_criteria: unknown;
    retry_attempt: unknown;
    run_id: string;
  }>(
    `SELECT e.created_at,
            ar.agent_id AS role,
            ar.task,
            e.payload->'missing_criteria' AS missing_criteria,
            e.payload->'retry_attempt' AS retry_attempt,
            e.run_id::text AS run_id
       FROM agent_run_events e
       LEFT JOIN agent_runs ar ON ar.id = e.run_id
      WHERE e.event_type = 'completion_gate_failed'
        AND e.created_at >= NOW() - ($1::int * INTERVAL '1 day')
      ORDER BY e.created_at DESC
      LIMIT 20`,
    [windowDays],
  );

  const totals = await systemQuery<{
    failed: string;
    passed: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE event_type = 'completion_gate_failed')::text AS failed,
       COUNT(*) FILTER (WHERE event_type = 'completion_gate_passed')::text AS passed
     FROM agent_run_events
     WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
       AND event_type IN ('completion_gate_failed', 'completion_gate_passed')`,
    [windowDays],
  );

  console.log(JSON.stringify({
    windowDays,
    gateEvents: totals[0] ?? { failed: '0', passed: '0' },
    topMissingCriteria: topCriteria.map((r) => ({
      criterion: r.criterion,
      count: parseInt(r.fail_count, 10),
    })),
    recentFailures: recentFails.map((r) => ({
      created_at: r.created_at?.toISOString?.() ?? r.created_at,
      role: r.role,
      task: r.task,
      retry_attempt: r.retry_attempt,
      missing_criteria: r.missing_criteria,
      run_id: r.run_id,
    })),
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((err) => {
      console.error('[planning-gate-db-snapshot]', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => closePool().catch(() => {}));
}
