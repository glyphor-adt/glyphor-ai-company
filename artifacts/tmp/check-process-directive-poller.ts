import { systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const wakes = await systemQuery<{
    id: string;
    status: string;
    created_at: string;
    dispatched_at: string | null;
    context: Record<string, unknown>;
  }>(
    `SELECT id, status, created_at, dispatched_at, context
       FROM agent_wake_queue
      WHERE agent_role = 'chief-of-staff'
        AND task = 'process_directive'
      ORDER BY created_at DESC
      LIMIT 5`,
    [],
  );

  const runs = await systemQuery<{
    id: string;
    status: string;
    task: string;
    tenant_id: string | null;
    created_at: string;
    completed_at: string | null;
    input: string | null;
    error: string | null;
  }>(
    `SELECT id, status, task, tenant_id, created_at, completed_at, input, error
       FROM agent_runs
      WHERE agent_id = 'chief-of-staff'
        AND task = 'process_directive'
      ORDER BY created_at DESC
      LIMIT 5`,
    [],
  );

  const recentChiefOfStaffRuns = await systemQuery<{
    id: string;
    status: string;
    task: string;
    tenant_id: string | null;
    created_at: string;
    input: string | null;
    error: string | null;
  }>(
    `SELECT id, status, task, tenant_id, created_at, input, error
       FROM agent_runs
      WHERE agent_id = 'chief-of-staff'
      ORDER BY created_at DESC
      LIMIT 10`,
    [],
  );

  console.log(JSON.stringify({ wakes, runs, recentChiefOfStaffRuns }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});