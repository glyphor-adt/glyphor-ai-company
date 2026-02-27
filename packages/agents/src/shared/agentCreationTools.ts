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
import type { SupabaseClient } from '@supabase/supabase-js';

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

export function createAgentCreationTools(supabase: SupabaseClient): ToolDefinition[] {
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
          description: 'AI model to use (default: gemini-3-flash-preview)',
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
        const { count: activeCount } = await supabase
          .from('company_agents')
          .select('*', { count: 'exact', head: true })
          .eq('created_by', ctx.agentRole)
          .eq('is_temporary', true)
          .eq('status', 'active');

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

        const { data: agent, error: createErr } = await supabase
          .from('company_agents')
          .insert({
            role: agentId,
            display_name: name,
            name,
            title,
            department,
            reports_to: ctx.agentRole,
            status: 'active',
            model,
            temperature: 0.3,
            max_turns: MAX_TURNS_CAP,
            budget_per_run: MAX_BUDGET_PER_RUN,
            budget_daily: MAX_BUDGET_DAILY,
            budget_monthly: MAX_BUDGET_MONTHLY,
            is_temporary: true,
            is_core: false,
            created_by: ctx.agentRole,
            expires_at: expiresAt,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (createErr) {
          return { success: false, error: `Failed to create agent: ${createErr.message}` };
        }

        // ── Store dynamic brief ──
        await supabase.from('agent_briefs').upsert({
          agent_id: agentId,
          system_prompt: systemPrompt,
          skills: [],
          tools: [],
          updated_at: new Date().toISOString(),
        });

        // Ensure each dynamic agent has a profile avatar at creation time.
        await supabase.from('agent_profiles').upsert({
          agent_id: agentId,
          avatar_url: avatarUrl,
          avatar_emoji: '🤖',
          personality_summary: personalitySummary,
          backstory: backstory,
          communication_traits: ['clear', 'structured', 'action-oriented'],
          quirks: ['summarizes key decisions before details'],
          tone_formality: 0.6,
          emoji_usage: 0.1,
          verbosity: 0.45,
          working_style: 'outcome-driven',
          updated_at: new Date().toISOString(),
        });

        // ── Store schedule if provided ──
        if (cronExpression) {
          await supabase.from('agent_schedules').insert({
            agent_id: agentId,
            cron_expression: cronExpression,
            task: 'scheduled_run',
            enabled: true,
          });
        }

        // ── Log creation as a Yellow-tier decision for founder visibility ──
        await supabase.from('decisions').insert({
          proposed_by: ctx.agentRole,
          tier: 'yellow',
          title: `New specialist agent: ${name}`,
          summary: `${ctx.agentRole} created a temporary specialist agent.\n\nJustification: ${justification}\n\nAgent: ${name} (${agentId})\nDepartment: ${department}\nModel: ${model}\nTTL: ${ttlDays} days (expires ${expiresAt})\nBudget: $${MAX_BUDGET_PER_RUN}/run, $${MAX_BUDGET_DAILY}/day, $${MAX_BUDGET_MONTHLY}/month${cronExpression ? `\nSchedule: ${cronExpression}` : '\nSchedule: on-demand only'}`,
          reasoning: justification,
          status: 'pending',
          assigned_to: ['kristina', 'andrew'],
          created_at: new Date().toISOString(),
        });

        // ── Activity log ──
        await supabase.from('activity_log').insert({
          agent_role: ctx.agentRole,
          action: 'agent.created',
          summary: `Created specialist agent: ${name} (${agentId}) — ${justification}`,
          created_at: new Date().toISOString(),
        });

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
        const { data, error } = await supabase
          .from('company_agents')
          .select('role, name, title, department, status, model, created_at, expires_at, budget_per_run, budget_daily, budget_monthly')
          .eq('created_by', ctx.agentRole)
          .eq('is_temporary', true)
          .order('created_at', { ascending: false })
          .limit(20);

        if (error) return { success: false, error: error.message };

        const agents = (data ?? []).map((a: Record<string, unknown>) => ({
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
        const { data: agent } = await supabase
          .from('company_agents')
          .select('role, name, created_by, is_temporary')
          .eq('role', agentId)
          .single();

        if (!agent) {
          return { success: false, error: `Agent '${agentId}' not found.` };
        }
        if (agent.created_by !== ctx.agentRole) {
          return { success: false, error: `You can only retire agents you created. '${agentId}' was created by ${agent.created_by}.` };
        }

        // Deactivate
        const { error } = await supabase
          .from('company_agents')
          .update({ status: 'retired', updated_at: new Date().toISOString() })
          .eq('role', agentId);

        if (error) return { success: false, error: error.message };

        // Disable schedules
        await supabase
          .from('agent_schedules')
          .update({ enabled: false })
          .eq('agent_id', agentId);

        // Log
        await supabase.from('activity_log').insert({
          agent_role: ctx.agentRole,
          action: 'agent.retired',
          summary: `Retired specialist agent: ${agent.name} (${agentId}) — ${reason}`,
          created_at: new Date().toISOString(),
        });

        return {
          success: true,
          data: { agentId, name: agent.name, status: 'retired', reason },
        };
      },
    },
  ];
}
