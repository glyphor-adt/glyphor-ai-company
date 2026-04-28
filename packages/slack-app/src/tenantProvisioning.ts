/**
 * Tenant Provisioning — Creates the marketing agent fleet for a new customer tenant.
 *
 * Called after onboarding completes (asset ingestion + synthesis). Inserts rows into
 * `tenant_agents` and `agent_schedules` so the worker knows which agents to run.
 */

import { systemQuery } from '@glyphor/shared/db';

interface AgentSpec {
  role: string;
  display_name: string;
  title: string;
  model_tier: string;
  brief_template: string;
}

const MARKETING_AGENTS: AgentSpec[] = [
  { role: 'cmo',                  display_name: 'Maya Brooks',  title: 'Chief Marketing Officer', model_tier: 'high',    brief_template: 'Review customer brand knowledge, plan content calendar, and coordinate the marketing team.' },
];

interface ScheduleSpec {
  agent_id: string;
  task: string;
  cron_expression: string;
}

const DEFAULT_SCHEDULES: ScheduleSpec[] = [
  { agent_id: 'cmo',                  task: 'weekly_report',    cron_expression: '0 9 * * 1' },
];

export async function provisionMarketingDepartment(tenantId: string): Promise<void> {
  for (const agent of MARKETING_AGENTS) {
    await systemQuery(
      `INSERT INTO tenant_agents
         (tenant_id, agent_role, display_name, title, model_tier, brief_template, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
       ON CONFLICT (tenant_id, agent_role) DO NOTHING`,
      [tenantId, agent.role, agent.display_name, agent.title, agent.model_tier, agent.brief_template],
    );
  }

  for (const schedule of DEFAULT_SCHEDULES) {
    await systemQuery(
      `INSERT INTO agent_schedules (tenant_id, agent_id, task, cron_expression, enabled, created_at)
       VALUES ($1, $2, $3, $4, true, NOW())
       ON CONFLICT DO NOTHING`,
      [tenantId, schedule.agent_id, schedule.task, schedule.cron_expression],
    );
  }

  console.log(`[Provisioning] Marketing department provisioned for tenant=${tenantId}`);
}
