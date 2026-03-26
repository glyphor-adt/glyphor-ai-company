import { systemQuery } from '@glyphor/shared/db';

type GrantRow = { tool_name: string; is_active: boolean; is_blocked: boolean | null; updated_at: string | null; created_at: string };
type ScheduleRow = { agent_id: string; task: string; cron_expression: string; enabled: boolean; created_at: string; last_triggered_at: string | null };

async function ensureGrant(): Promise<void> {
  await systemQuery(
    `INSERT INTO agent_tool_grants (agent_role, tool_name, granted_by, reason, is_active, is_blocked)
     VALUES ('platform-intel', 'grant_tool_to_agent', 'system', 'Enable Nexus autonomous remediation', true, false)
     ON CONFLICT (agent_role, tool_name) DO UPDATE
       SET is_active = true,
           is_blocked = false,
           granted_by = EXCLUDED.granted_by,
           reason = EXCLUDED.reason,
           updated_at = NOW()`,
  );
}

async function ensureSchedules(): Promise<void> {
  const desired: Array<{ task: string; cron: string }> = [
    { task: 'watch_tool_gaps', cron: '*/30 * * * *' },
    { task: 'daily_analysis', cron: '0 8 * * *' },
    { task: 'remediate_tool_gaps', cron: '0 * * * *' },
    { task: 'fleet_audit', cron: '0 9 * * 1' },
  ];

  for (const item of desired) {
    await systemQuery(
      `INSERT INTO agent_schedules (agent_id, task, cron_expression, enabled, created_at, payload)
       SELECT $1, $2, $3, true, NOW(), '{}'::jsonb
       WHERE NOT EXISTS (
         SELECT 1
         FROM agent_schedules
         WHERE agent_id = $1
           AND task = $2
           AND cron_expression = $3
       )`,
      ['platform-intel', item.task, item.cron],
    );

    await systemQuery(
      `UPDATE agent_schedules
       SET enabled = true
       WHERE agent_id = $1
         AND task = $2
         AND cron_expression = $3`,
      ['platform-intel', item.task, item.cron],
    );
  }
}

async function verify() {
  const grant = await systemQuery<GrantRow>(
    `SELECT tool_name, is_active, is_blocked, updated_at, created_at
     FROM agent_tool_grants
     WHERE agent_role = 'platform-intel' AND tool_name = 'grant_tool_to_agent'`,
  );

  const schedules = await systemQuery<ScheduleRow>(
    `SELECT agent_id, task, cron_expression, enabled, created_at, last_triggered_at
     FROM agent_schedules
     WHERE agent_id = 'platform-intel'
       AND task IN ('watch_tool_gaps', 'daily_analysis', 'remediate_tool_gaps', 'fleet_audit')
     ORDER BY task`,
  );

  console.log(JSON.stringify({ grant, schedules }, null, 2));
}

async function main() {
  await ensureGrant();
  await ensureSchedules();
  await verify();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
