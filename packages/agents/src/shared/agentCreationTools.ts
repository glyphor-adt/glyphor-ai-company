/**
 * Shared Agent Creation Tools — Spin up specialist agents on demand
 *
 * Tools:
 *   create_specialist_agent  — Create a temporary specialist agent
 *   list_my_created_agents   — List agents you've created
 *   retire_created_agent     — Deactivate a created agent early
 *
 * Guardrails:
 *   - Max 3 active dynamic agents per creator
 *   - Always temporary (default 7d, max 30d TTL)
 *   - Budget capped: $0.10/run, $1.00/day, $20/month
 *   - Only executives can create agents
 *   - Creation logged + decision filed for founder visibility
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { EXECUTIVE_ROLES } from '@glyphor/agent-runtime';
import type { CompanyAgentRole } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

/** Hard limits — cannot be overridden by agents */
const MAX_ACTIVE_PER_CREATOR = 3;
const MAX_TTL_DAYS = 30;
const DEFAULT_TTL_DAYS = 7;
const MAX_BUDGET_PER_RUN = 0.10;
const MAX_BUDGET_DAILY = 1.00;
const MAX_BUDGET_MONTHLY = 20;
const MAX_TURNS_CAP = 10;

function buildGeneratedAvatarUrl(name: string): string {
  const seed = encodeURIComponent(name.trim() || 'Agent');
  return `https://api.dicebear.com/9.x/initials/svg?seed=${seed}&radius=50&bold=true`;
}

function buildDefaultPersonalitySummary(name: string, title: string, department: string): string {
  return `${name} is a focused ${title} in ${department} who prioritizes clear recommendations, practical execution steps, and concise communication.`;
}

function buildDefaultBackstory(title: string, department: string): string {
  return `Provisioned as a specialist ${title} to support ${department} with targeted expertise on high-priority initiatives.`;
}

/**
 * Creates tools that allow agents to provision specialist agents.
 */
export function createAgentCreationTools(): ToolDefinition[] {
  return [
    {
      name: 'create_specialist_agent',
      description: `Create a temporary specialist agent for a task that no existing team member can handle. The agent is automatically retired after its TTL expires (default ${DEFAULT_TTL_DAYS} days, max ${MAX_TTL_DAYS}). You may have at most ${MAX_ACTIVE_PER_CREATOR} active specialist agents at a time. Use this when you need expertise outside the current team — e.g., an Azure migration specialist, a Snowflake analyst, a security auditor, a Kubernetes expert, etc.`,
      parameters: {
        name: {
          type: 'string',
          description: 'Agent name (e.g., "Azure Migration Specialist"). Will be converted to a role ID automatically.',
          required: true,
        },
        title: {
          type: 'string',
          description: 'Job title (e.g., "Cloud Migration Engineer")',
          required: true,
        },
        department: {
          type: 'string',
          description: 'Department this agent belongs to (e.g., "Engineering", "Finance", "Marketing")',
          required: true,
        },
        system_prompt: {
          type: 'string',
          description: 'The agent\'s system prompt — define its personality, expertise, responsibilities, and instructions. Be specific about what tools it should use and what output it should produce.',
          required: true,
        },
        justification: {
          type: 'string',
          description: 'Why this specialist is needed and what existing gap it fills. This is logged for founder visibility.',
          required: true,
        },
        ttl_days: {
          type: 'number',
          description: `How many days until auto-retirement (default: ${DEFAULT_TTL_DAYS}, max: ${MAX_TTL_DAYS})`,
          required: false,
        },
        model: {
          type: 'string',
          description: 'AI model to use (default: gpt-5-mini-2025-08-07)',
          required: false,
        },
        cron_expression: {
          type: 'string',
          description: 'Optional cron schedule (e.g., "0 */6 * * *" for every 6 hours). Omit for on-demand only.',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        // ── Guard: only executives can create agents ──
        if (!EXECUTIVE_ROLES.includes(ctx.agentRole as CompanyAgentRole)) {
          return {
            success: false,
            error: `Only executives can create specialist agents. Your role (${ctx.agentRole}) is not authorized. Ask your VP or C-level manager to create one on your behalf.`,
          };
        }

        const name = params.name as string;
        const title = params.title as string;
        const department = params.department as string;
        const systemPrompt = params.system_prompt as string;
        const justification = params.justification as string;
        const ttlDays = Math.min((params.ttl_days as number) || DEFAULT_TTL_DAYS, MAX_TTL_DAYS);
        const model = (params.model as string) || 'gemini-3-flash-preview';
        const cronExpression = params.cron_expression as string | undefined;

        if (!name || !systemPrompt || !justification) {
          return { success: false, error: 'name, system_prompt, and justification are required.' };
        }

        // ── Guard: check active agent count for this creator ──
        const [{ count: activeCount }] = await systemQuery<{ count: number }>(
          'SELECT COUNT(*)::int as count FROM company_agents WHERE created_by = $1 AND is_temporary = true AND status = $2',
          [ctx.agentRole, 'active']
        );

        if ((activeCount ?? 0) >= MAX_ACTIVE_PER_CREATOR) {
          return {
            success: false,
            error: `You already have ${activeCount} active specialist agents (limit: ${MAX_ACTIVE_PER_CREATOR}). Retire an existing one with retire_created_agent before creating a new one, or wait for one to auto-expire.`,
          };
        }

        // ── Create the agent ──
        const agentId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const expiresAt = new Date(Date.now() + ttlDays * 86400000).toISOString();
        const avatarUrl = buildGeneratedAvatarUrl(name);
        const personalitySummary = buildDefaultPersonalitySummary(name, title, department);
        const backstory = buildDefaultBackstory(title, department);

        let agent: Record<string, unknown>;
        try {
          const rows = await systemQuery(
            `INSERT INTO company_agents (role, display_name, name, title, department, reports_to, status, model, temperature, max_turns, budget_per_run, budget_daily, budget_monthly, is_temporary, is_core, created_by, expires_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING *`,
            [agentId, name, name, title, department, ctx.agentRole, 'active', model, 0.3, MAX_TURNS_CAP, MAX_BUDGET_PER_RUN, MAX_BUDGET_DAILY, MAX_BUDGET_MONTHLY, true, false, ctx.agentRole, expiresAt, new Date().toISOString(), new Date().toISOString()]
          );
          agent = rows[0] as Record<string, unknown>;
        } catch (createErr) {
          return { success: false, error: `Failed to create agent: ${(createErr as Error).message}` };
        }

        // ── Store dynamic brief ──
        await systemQuery(
          `INSERT INTO agent_briefs (agent_id, system_prompt, skills, tools, updated_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (agent_id) DO UPDATE SET system_prompt = EXCLUDED.system_prompt, skills = EXCLUDED.skills, tools = EXCLUDED.tools, updated_at = EXCLUDED.updated_at`,
          [agentId, systemPrompt, JSON.stringify([]), JSON.stringify([]), new Date().toISOString()]
        );

        // Ensure each dynamic agent has a profile at creation time.
        await systemQuery(
          `INSERT INTO agent_profiles (agent_id, personality_summary, backstory, communication_traits, quirks, tone_formality, emoji_usage, verbosity, working_style, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (agent_id) DO UPDATE SET personality_summary = EXCLUDED.personality_summary, backstory = EXCLUDED.backstory, communication_traits = EXCLUDED.communication_traits, quirks = EXCLUDED.quirks, tone_formality = EXCLUDED.tone_formality, emoji_usage = EXCLUDED.emoji_usage, verbosity = EXCLUDED.verbosity, working_style = EXCLUDED.working_style, updated_at = EXCLUDED.updated_at`,
          [agentId, personalitySummary, backstory, JSON.stringify(['clear', 'structured', 'action-oriented']), JSON.stringify(['summarizes key decisions before details']), 0.6, 0.1, 0.45, 'outcome-driven', new Date().toISOString()]
        );

        // Set DiceBear avatar only for new profiles (don't overwrite existing PNG avatars)
        await systemQuery(
          'UPDATE agent_profiles SET avatar_url = $1 WHERE agent_id = $2 AND avatar_url IS NULL',
          [avatarUrl, agentId]
        );

        // ── Store schedule if provided ──
        if (cronExpression) {
          await systemQuery(
            'INSERT INTO agent_schedules (agent_id, cron_expression, task, enabled) VALUES ($1, $2, $3, $4)',
            [agentId, cronExpression, 'scheduled_run', true]
          );
        }

        // ── Log creation as a Yellow-tier decision for founder visibility ──
        await systemQuery(
          'INSERT INTO decisions (proposed_by, tier, title, summary, reasoning, status, assigned_to, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [ctx.agentRole, 'yellow', `New specialist agent: ${name}`, `${ctx.agentRole} created a temporary specialist agent.\n\nJustification: ${justification}\n\nAgent: ${name} (${agentId})\nDepartment: ${department}\nModel: ${model}\nTTL: ${ttlDays} days (expires ${expiresAt})\nBudget: $${MAX_BUDGET_PER_RUN}/run, $${MAX_BUDGET_DAILY}/day, $${MAX_BUDGET_MONTHLY}/month${cronExpression ? `\nSchedule: ${cronExpression}` : '\nSchedule: on-demand only'}`, justification, 'pending', JSON.stringify(['kristina', 'andrew']), new Date().toISOString()]
        );

        // ── Activity log ──
        await systemQuery(
          'INSERT INTO activity_log (agent_role, action, summary, created_at) VALUES ($1, $2, $3, $4)',
          [ctx.agentRole, 'agent.created', `Created specialist agent: ${name} (${agentId}) — ${justification}`, new Date().toISOString()]
        );

        return {
          success: true,
          data: {
            agentId,
            name,
            title,
            department,
            reportsTo: ctx.agentRole,
            model,
            expiresAt,
            ttlDays,
            budget: { perRun: MAX_BUDGET_PER_RUN, daily: MAX_BUDGET_DAILY, monthly: MAX_BUDGET_MONTHLY },
            schedule: cronExpression || 'on-demand only',
            avatarUrl,
            note: `Agent is active and ready. It will auto-retire on ${expiresAt.split('T')[0]}. Use assign_task to give it work, or trigger it via the scheduler. You can retire it early with retire_created_agent.`,
          },
        };
      },
    },

    {
      name: 'list_my_created_agents',
      description: 'List specialist agents you have created — shows their status, TTL, budget usage, and expiration.',
      parameters: {},
      execute: async (_params, ctx): Promise<ToolResult> => {
        const data = await systemQuery<Record<string, unknown>>(
          'SELECT role, name, title, department, status, model, created_at, expires_at, budget_per_run, budget_daily, budget_monthly FROM company_agents WHERE created_by = $1 AND is_temporary = true ORDER BY created_at DESC LIMIT $2',
          [ctx.agentRole, 20]
        );

        const agents = data.map((a: Record<string, unknown>) => ({
          ...a,
          isExpired: a.expires_at ? new Date(a.expires_at as string) < new Date() : false,
          daysRemaining: a.expires_at
            ? Math.max(0, Math.round((new Date(a.expires_at as string).getTime() - Date.now()) / 86400000))
            : null,
        }));

        const active = agents.filter((a: Record<string, unknown>) => a.status === 'active' && !a.isExpired);

        return {
          success: true,
          data: {
            activeCount: active.length,
            maxAllowed: MAX_ACTIVE_PER_CREATOR,
            slotsRemaining: MAX_ACTIVE_PER_CREATOR - active.length,
            agents,
          },
        };
      },
    },

    {
      name: 'retire_created_agent',
      description: 'Retire (deactivate) a specialist agent you created. Frees up a creation slot.',
      parameters: {
        agent_id: {
          type: 'string',
          description: 'The agent role/ID to retire (from list_my_created_agents)',
          required: true,
        },
        reason: {
          type: 'string',
          description: 'Why you are retiring this agent',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const agentId = params.agent_id as string;
        const reason = params.reason as string;

        // Verify this agent was created by the caller
        const rows = await systemQuery<Record<string, unknown>>(
          'SELECT role, name, created_by, is_temporary FROM company_agents WHERE role = $1',
          [agentId]
        );
        const agent = rows[0];

        if (!agent) {
          return { success: false, error: `Agent '${agentId}' not found.` };
        }
        if (agent.created_by !== ctx.agentRole) {
          return { success: false, error: `You can only retire agents you created. '${agentId}' was created by ${agent.created_by}.` };
        }

        // Deactivate
        try {
          await systemQuery(
            'UPDATE company_agents SET status = $1, updated_at = $2 WHERE role = $3',
            ['retired', new Date().toISOString(), agentId]
          );
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }

        // Disable schedules
        await systemQuery(
          'UPDATE agent_schedules SET enabled = false WHERE agent_id = $1',
          [agentId]
        );

        // Log
        await systemQuery(
          'INSERT INTO activity_log (agent_role, action, summary, created_at) VALUES ($1, $2, $3, $4)',
          [ctx.agentRole, 'agent.retired', `Retired specialist agent: ${agent.name} (${agentId}) — ${reason}`, new Date().toISOString()]
        );

        return {
          success: true,
          data: { agentId, name: agent.name, status: 'retired', reason },
        };
      },
    },
  ];
}
