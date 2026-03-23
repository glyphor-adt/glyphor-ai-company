/**
 * Apply idempotent CMO schedule inserts (same as migration 20260324130000) and list GTM agent_schedules.
 *
 * Run: powershell -ExecutionPolicy Bypass -Command "& .\scripts\run-with-local-db-proxy.ps1 -Run npx -RunArgs 'tsx','scripts/_seed-cmo-schedules-query-gtm.ts'"
 */
import 'dotenv/config';
import { closePool, systemQuery } from '@glyphor/shared/db';

const INSERTS = [
  `INSERT INTO agent_schedules (agent_id, cron_expression, enabled, task, payload, tenant_id)
   SELECT 'cmo', '*/30 * * * *', true, 'process_assignments',
     '{"context": "check_and_execute_pending_assignments"}'::jsonb,
     '00000000-0000-0000-0000-000000000000'::uuid
   WHERE NOT EXISTS (
     SELECT 1 FROM agent_schedules s
     WHERE s.agent_id = 'cmo' AND s.cron_expression = '*/30 * * * *' AND s.task = 'process_assignments'
   )`,
  `INSERT INTO agent_schedules (agent_id, cron_expression, enabled, task, payload, tenant_id)
   SELECT 'cmo', '0 14 * * *', true, 'work_loop',
     '{"context": "morning_planning"}'::jsonb,
     '00000000-0000-0000-0000-000000000000'::uuid
   WHERE NOT EXISTS (
     SELECT 1 FROM agent_schedules s
     WHERE s.agent_id = 'cmo' AND s.cron_expression = '0 14 * * *' AND s.task = 'work_loop'
   )`,
  `INSERT INTO agent_schedules (agent_id, cron_expression, enabled, task, payload, tenant_id)
   SELECT 'cmo', '0 18 * * *', true, 'work_loop',
     '{"context": "midday_review"}'::jsonb,
     '00000000-0000-0000-0000-000000000000'::uuid
   WHERE NOT EXISTS (
     SELECT 1 FROM agent_schedules s
     WHERE s.agent_id = 'cmo' AND s.cron_expression = '0 18 * * *' AND s.task = 'work_loop'
   )`,
];

async function main(): Promise<void> {
  console.log('=== Applying CMO schedule inserts (idempotent) ===\n');
  for (const sql of INSERTS) {
    await systemQuery(sql);
  }
  console.log('Done.\n');

  console.log('=== CMO schedules (all rows) ===\n');
  const cmo = await systemQuery<Record<string, unknown>>(
    `SELECT agent_id, cron_expression, enabled, task, payload
     FROM agent_schedules
     WHERE agent_id = 'cmo'
     ORDER BY cron_expression, task`,
  );
  console.log(JSON.stringify(cmo, null, 2));

  console.log('\n=== GTM-related agent_schedules ===\n');
  const gtm = await systemQuery<Record<string, unknown>>(
    `SELECT agent_id, cron_expression, enabled, task, payload
     FROM agent_schedules
     WHERE agent_id IN (
       'content-creator',
       'seo-analyst',
       'social-media-manager',
       'chief-of-staff'
     )
     ORDER BY agent_id, cron_expression`,
  );
  console.log(JSON.stringify(gtm, null, 2));
}

main()
  .finally(() => closePool().catch(() => {}))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
