/**
 * Investigate work_assignments failed without agent_run linkage.
 * Run: powershell -ExecutionPolicy Bypass -Command "& .\scripts\run-with-local-db-proxy.ps1 -Run npx -RunArgs 'tsx','scripts/_query-work-assignments-failed-investigation.ts'"
 */
import 'dotenv/config';
import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  console.log('=== 2. work_assignments columns (information_schema) ===\n');
  const cols = await systemQuery<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'work_assignments'
     ORDER BY ordinal_position`,
  );
  console.log(JSON.stringify(cols, null, 2));
  const hasFailureReason = cols.some((c) => c.column_name === 'failure_reason');
  console.log(`\nHas failure_reason column: ${hasFailureReason}\n`);

  const q1Sql = hasFailureReason
    ? `SELECT 
      wa.id,
      wa.assignment_type,
      wa.status,
      wa.assigned_to,
      wa.assigned_by,
      wa.created_at,
      wa.updated_at,
      LEFT(wa.task_description, 200) AS task,
      wa.failure_reason,
      wa.quality_score,
      COUNT(tro.id)::text AS outcome_count
    FROM work_assignments wa
    LEFT JOIN task_run_outcomes tro ON tro.assignment_id = wa.id
    WHERE wa.assigned_by = 'chief-of-staff'
    AND wa.status = 'failed'
    AND wa.created_at > NOW() - INTERVAL '30 days'
    GROUP BY wa.id
    ORDER BY wa.created_at DESC
    LIMIT 20`
    : `SELECT 
      wa.id,
      wa.assignment_type,
      wa.status,
      wa.assigned_to,
      wa.assigned_by,
      wa.created_at,
      wa.updated_at,
      LEFT(wa.task_description, 200) AS task,
      wa.evaluation,
      wa.quality_score,
      COUNT(tro.id)::text AS outcome_count
    FROM work_assignments wa
    LEFT JOIN task_run_outcomes tro ON tro.assignment_id = wa.id
    WHERE wa.assigned_by = 'chief-of-staff'
    AND wa.status = 'failed'
    AND wa.created_at > NOW() - INTERVAL '30 days'
    GROUP BY wa.id
    ORDER BY wa.created_at DESC
    LIMIT 20`;

  console.log('=== 1. Failed Sarah assignments + outcome_count ===\n');
  try {
    const q1 = await systemQuery<Record<string, unknown>>(q1Sql);
    console.log(JSON.stringify(q1, null, 2));
  } catch (e) {
    console.error('Query 1 failed:', (e as Error).message);
  }

  console.log('\n=== 5. Stuck dispatched/pending > 2h (chief-of-staff) ===\n');
  const q5 = await systemQuery<Record<string, unknown>>(
    `SELECT 
      assigned_to,
      COUNT(*)::text AS stuck_count,
      MIN(created_at) AS oldest
    FROM work_assignments
    WHERE assigned_by = 'chief-of-staff'
    AND status IN ('dispatched', 'pending')
    AND created_at < NOW() - INTERVAL '2 hours'
    GROUP BY assigned_to
    ORDER BY COUNT(*) DESC`,
  );
  console.log(JSON.stringify(q5, null, 2));

}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
