/**
 * 1) Sarah (chief-of-staff) failed assignments — drivers for failure rate.
 * 2) task_run_outcomes.downstream_status — first-time accept / downstream metrics.
 *
 * Run: powershell -ExecutionPolicy Bypass -File scripts/run-with-local-db-proxy.ps1 -Run npx -RunArgs tsx,scripts/_query-sarah-failures-and-downstream-status.ts
 */
import 'dotenv/config';
import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  console.log('=== 1. Sarah failed work_assignments (30d, assigned_by chief-of-staff) ===\n');
  const q1 = await systemQuery<Record<string, unknown>>(
    `SELECT 
      wa.status,
      LEFT(wa.task_description, 150) AS task_preview,
      wa.assignment_type,
      ar.status AS run_status,
      LEFT(ar.error, 200) AS error_preview
    FROM work_assignments wa
    LEFT JOIN task_run_outcomes tro ON tro.assignment_id = wa.id
    LEFT JOIN agent_runs ar ON ar.id = tro.run_id
    WHERE wa.assigned_by = 'chief-of-staff'
    AND wa.status = 'failed'
    AND wa.created_at > NOW() - INTERVAL '30 days'
    ORDER BY wa.created_at DESC
    LIMIT 20`,
  );
  console.log(JSON.stringify(q1, null, 2));

  console.log('\n=== 2. task_run_outcomes downstream_status counts ===\n');
  const q2 = await systemQuery<Record<string, unknown>>(
    `SELECT COUNT(*)::text AS cnt, downstream_status
    FROM task_run_outcomes
    WHERE downstream_status IS NOT NULL
    GROUP BY downstream_status
    ORDER BY cnt DESC`,
  );
  console.log(JSON.stringify(q2, null, 2));
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
