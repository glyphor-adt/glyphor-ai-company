import { systemQuery } from '@glyphor/shared/db';

type NexusRun = {
  task_type: string | null;
  status: string | null;
  created_at: string;
  result: string | null;
};

type AgentSchedule = {
  task_type: string | null;
  schedule: string | null;
  last_run: string | null;
  next_run: string | null;
  status: string;
};

type ToolGrant = {
  tool_name: string;
};

async function main() {
  const runs = await systemQuery<NexusRun>(
    `SELECT
       task AS task_type,
       status,
       created_at,
       COALESCE(result_summary, output, error) AS result
     FROM agent_runs
     WHERE agent_id = 'platform-intel'
     ORDER BY created_at DESC
     LIMIT 10`,
  );

  const schedules = await systemQuery<AgentSchedule>(
    `SELECT
       task AS task_type,
       cron_expression AS schedule,
       last_triggered_at AS last_run,
       NULL::timestamptz AS next_run,
       CASE WHEN enabled THEN 'enabled' ELSE 'disabled' END AS status
     FROM agent_schedules
     WHERE agent_id = 'platform-intel'
     ORDER BY created_at DESC`,
  );

  const grants = await systemQuery<ToolGrant>(
    `SELECT tool_name
     FROM agent_tool_grants
     WHERE agent_role = 'platform-intel'
       AND is_active = true
       AND COALESCE(is_blocked, false) = false
     ORDER BY tool_name`,
  );

  console.log(JSON.stringify({ runs, schedules, grants }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
