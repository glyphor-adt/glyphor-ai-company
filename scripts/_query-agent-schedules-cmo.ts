/**
 * CMO rows in agent_schedules.
 *
 * Schema note: this table uses agent_id (role id), cron_expression, last_triggered_at,
 * enabled — not agent_role / schedule / last_run_at / is_active / next_run_at.
 *
 * Run: powershell -ExecutionPolicy Bypass -Command "& .\scripts\run-with-local-db-proxy.ps1 -Run npx -RunArgs 'tsx','scripts/_query-agent-schedules-cmo.ts'"
 */
import 'dotenv/config';
import { closePool, systemQuery } from '@glyphor/shared/db';

async function main(): Promise<void> {
  const rows = await systemQuery<Record<string, unknown>>(
    `SELECT
       cron_expression AS schedule,
       last_triggered_at AS last_run_at,
       enabled AS is_active,
       id,
       task,
       payload
     FROM agent_schedules
     WHERE agent_id = 'cmo'`,
  );
  console.log(JSON.stringify(rows, null, 2));
  console.log('\nNote: next_run_at is not stored; DynamicScheduler matches cron each minute (UTC).');
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
