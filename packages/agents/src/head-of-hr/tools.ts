/**
 * Head of HR (Jasmine Rivera) — Domain Tools
 * Agent onboarding validation, workforce audits, and agent lifecycle management.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';

export function createHeadOfHRTools(memory: CompanyMemoryStore): ToolDefinition[] {
  const supabase = memory.getSupabaseClient();

  return [
    // ── Workforce Audit ──
    {
      name: 'audit_workforce',
      description:
        'Scan ALL agents in company_agents and check for incomplete profiles, missing briefs, ' +
        'missing display names, no avatar, missing reports_to, or stale/expired agents. Returns a structured audit report.',
      parameters: {
        status_filter: {
          type: 'string',
          description: 'Filter agents by status: active, paused, retired, or all.',
          required: false,
          enum: ['active', 'paused', 'retired', 'all'],
        },
      },
      execute: async (params) => {
        const statusFilter = (params.status_filter as string) || 'active';

        // Fetch all agents
        let agentsQuery = supabase.from('company_agents').select('*');
        if (statusFilter !== 'all') agentsQuery = agentsQuery.eq('status', statusFilter);
        const { data: agents, error: agentsErr } = await agentsQuery;
        if (agentsErr) return { success: false, output: `Failed to fetch agents: ${agentsErr.message}` };

        // Fetch all profiles
        const { data: profiles } = await supabase.from('agent_profiles').select('agent_role, personality_summary, backstory, avatar_url, communication_traits');
        const profileMap = new Map((profiles || []).map((p: Record<string, unknown>) => [p.agent_role, p]));

        // Fetch all briefs
        const { data: briefs } = await supabase.from('agent_briefs').select('agent_role, system_prompt');
        const briefMap = new Map((briefs || []).map((b: Record<string, unknown>) => [b.agent_role, b]));

        const issues: Array<{ role: string; problems: string[] }> = [];
        const validRoles = new Set((agents || []).map((a: Record<string, unknown>) => a.role));

        for (const agent of agents || []) {
          const problems: string[] = [];
          const role = agent.role as string;

          // Check display name
          if (!agent.display_name) problems.push('missing display_name');

          // Check profile
          const profile = profileMap.get(role) as Record<string, unknown> | undefined;
          if (!profile) {
            problems.push('no agent_profiles row');
          } else {
            if (!profile.personality_summary) problems.push('empty personality_summary');
            if (!profile.backstory) problems.push('empty backstory');
            if (!profile.avatar_url) problems.push('no avatar_url');
            const traits = profile.communication_traits as unknown[];
            if (!traits || traits.length === 0) problems.push('empty communication_traits');
          }

          // Check brief
          const brief = briefMap.get(role) as Record<string, unknown> | undefined;
          if (!brief) {
            problems.push('no agent_briefs row');
          } else if (!brief.system_prompt || (brief.system_prompt as string).length < 50) {
            problems.push('system_prompt is missing or too short');
          }

          // Check org chart
          if (!agent.reports_to) problems.push('missing reports_to');
          if (agent.reports_to && !validRoles.has(agent.reports_to)) {
            problems.push(`reports_to "${agent.reports_to}" does not exist`);
          }

          if (problems.length > 0) {
            issues.push({ role, problems });
          }
        }

        const total = (agents || []).length;
        const compliant = total - issues.length;

        return {
          success: true,
          output: JSON.stringify({
            totalAgents: total,
            compliant,
            issueCount: issues.length,
            complianceRate: total > 0 ? `${Math.round((compliant / total) * 100)}%` : 'N/A',
            issues,
          }, null, 2),
        };
      },
    },

    // ── Validate Single Agent ──
    {
      name: 'validate_agent',
      description:
        'Check a specific agent for onboarding completeness. Returns a pass/fail checklist ' +
        'with details on what is missing or incomplete.',
      parameters: {
        role: {
          type: 'string',
          description: 'The agent role slug to validate (e.g. "platform-engineer").',
          required: true,
        },
      },
      execute: async (params) => {
        const role = params.role as string;

        const { data: agent, error: agentErr } = await supabase
          .from('company_agents')
          .select('*')
          .eq('role', role)
          .maybeSingle();
        if (agentErr) return { success: false, output: `DB error: ${agentErr.message}` };
        if (!agent) return { success: false, output: `Agent "${role}" not found in company_agents.` };

        const { data: profile } = await supabase
          .from('agent_profiles')
          .select('*')
          .eq('agent_role', role)
          .maybeSingle();

        const { data: brief } = await supabase
          .from('agent_briefs')
          .select('*')
          .eq('agent_role', role)
          .maybeSingle();

        const checklist: Record<string, { pass: boolean; detail: string }> = {};

        // 1. Display name
        checklist['display_name'] = agent.display_name
          ? { pass: true, detail: agent.display_name }
          : { pass: false, detail: 'MISSING — shows as raw role ID' };

        // 2. Name
        checklist['name'] = agent.name
          ? { pass: true, detail: agent.name }
          : { pass: false, detail: 'MISSING' };

        // 3. Profile exists
        checklist['profile_exists'] = profile
          ? { pass: true, detail: 'agent_profiles row present' }
          : { pass: false, detail: 'No agent_profiles row' };

        if (profile) {
          checklist['personality_summary'] = profile.personality_summary
            ? { pass: true, detail: `${(profile.personality_summary as string).substring(0, 60)}...` }
            : { pass: false, detail: 'EMPTY' };

          checklist['backstory'] = profile.backstory
            ? { pass: true, detail: `${(profile.backstory as string).substring(0, 60)}...` }
            : { pass: false, detail: 'EMPTY' };

          checklist['avatar_url'] = profile.avatar_url
            ? { pass: true, detail: profile.avatar_url as string }
            : { pass: false, detail: 'No avatar' };

          const traits = profile.communication_traits as unknown[] | null;
          checklist['communication_traits'] = traits && traits.length >= 3
            ? { pass: true, detail: `${traits.length} traits` }
            : { pass: false, detail: `Only ${traits?.length ?? 0} traits (need 3+)` };

          const quirks = profile.quirks as unknown[] | null;
          checklist['quirks'] = quirks && quirks.length >= 1
            ? { pass: true, detail: `${quirks.length} quirks` }
            : { pass: false, detail: 'No quirks defined' };
        }

        // 4. Brief
        checklist['brief_exists'] = brief
          ? { pass: true, detail: 'agent_briefs row present' }
          : { pass: false, detail: 'No agent_briefs row' };

        if (brief) {
          const promptLen = (brief.system_prompt as string)?.length ?? 0;
          checklist['system_prompt_quality'] = promptLen >= 100
            ? { pass: true, detail: `${promptLen} chars` }
            : { pass: false, detail: `Only ${promptLen} chars (need 100+)` };
        }

        // 5. Org chart
        checklist['reports_to'] = agent.reports_to
          ? { pass: true, detail: agent.reports_to }
          : { pass: false, detail: 'MISSING — not in org chart' };

        // 6. Model
        checklist['model'] = agent.model === 'gemini-3-flash-preview'
          ? { pass: true, detail: agent.model }
          : { pass: false, detail: `${agent.model ?? 'NOT SET'} (should be gemini-3-flash-preview)` };

        const passed = Object.values(checklist).filter((c) => c.pass).length;
        const total = Object.values(checklist).length;

        return {
          success: true,
          output: JSON.stringify({
            role,
            displayName: agent.display_name || role,
            status: agent.status,
            score: `${passed}/${total}`,
            passRate: `${Math.round((passed / total) * 100)}%`,
            checklist,
          }, null, 2),
        };
      },
    },

    // ── Update Agent Profile ──
    {
      name: 'update_agent_profile',
      description:
        'Update or create an agent_profiles row for a given agent role. Use this to fix missing ' +
        'personality, backstory, communication traits, quirks, or avatar URL.',
      parameters: {
        role: {
          type: 'string',
          description: 'The agent role slug.',
          required: true,
        },
        personality_summary: {
          type: 'string',
          description: 'First-person personality summary (2+ sentences).',
          required: false,
        },
        backstory: {
          type: 'string',
          description: 'Agent backstory explaining why they exist and what gap they fill.',
          required: false,
        },
        communication_traits: {
          type: 'array',
          description: 'Array of communication trait strings (3+).',
          required: false,
          items: { type: 'string', description: 'A communication trait.' },
        },
        quirks: {
          type: 'array',
          description: 'Array of personality quirk strings (1+).',
          required: false,
          items: { type: 'string', description: 'A quirk.' },
        },
        tone_formality: {
          type: 'number',
          description: 'Tone formality 0.0-1.0 (0.3-0.8 recommended).',
          required: false,
        },
        verbosity: {
          type: 'number',
          description: 'Verbosity 0.0-1.0 (0.3-0.7 recommended).',
          required: false,
        },
        working_style: {
          type: 'string',
          description: 'Working style description.',
          required: false,
        },
        emoji_usage: {
          type: 'string',
          description: 'Emoji usage level.',
          required: false,
          enum: ['none', 'minimal', 'moderate', 'heavy'],
        },
      },
      execute: async (params) => {
        const role = params.role as string;
        const updateData: Record<string, unknown> = {};

        if (params.personality_summary) updateData.personality_summary = params.personality_summary;
        if (params.backstory) updateData.backstory = params.backstory;
        if (params.communication_traits) updateData.communication_traits = params.communication_traits;
        if (params.quirks) updateData.quirks = params.quirks;
        if (params.tone_formality !== undefined) updateData.tone_formality = params.tone_formality;
        if (params.verbosity !== undefined) updateData.verbosity = params.verbosity;
        if (params.working_style) updateData.working_style = params.working_style;
        if (params.emoji_usage) updateData.emoji_usage = params.emoji_usage;

        if (Object.keys(updateData).length === 0) {
          return { success: false, output: 'No fields provided to update.' };
        }

        const { error } = await supabase
          .from('agent_profiles')
          .upsert({ agent_role: role, ...updateData }, { onConflict: 'agent_role' });

        if (error) return { success: false, output: `Failed to update profile: ${error.message}` };
        return { success: true, output: `Profile for "${role}" updated: ${Object.keys(updateData).join(', ')}` };
      },
    },

    // ── Update Agent Display Name ──
    {
      name: 'update_agent_name',
      description: 'Set or fix display_name and name for an agent in company_agents.',
      parameters: {
        role: {
          type: 'string',
          description: 'The agent role slug.',
          required: true,
        },
        display_name: {
          type: 'string',
          description: 'Human-readable display name (e.g. "Jasmine Rivera").',
          required: true,
        },
      },
      execute: async (params) => {
        const role = params.role as string;
        const displayName = params.display_name as string;

        const { error } = await supabase
          .from('company_agents')
          .update({ display_name: displayName, name: displayName })
          .eq('role', role);

        if (error) return { success: false, output: `Failed: ${error.message}` };
        return { success: true, output: `Agent "${role}" display_name set to "${displayName}".` };
      },
    },

    // ── Retire Agent ──
    {
      name: 'retire_agent',
      description:
        'Mark an agent as retired. Updates status, disables schedules, and logs reason. ' +
        'Cannot retire founder accounts or the chief-of-staff.',
      parameters: {
        role: {
          type: 'string',
          description: 'The agent role slug to retire.',
          required: true,
        },
        reason: {
          type: 'string',
          description: 'Reason for retirement.',
          required: true,
        },
      },
      execute: async (params) => {
        const role = params.role as string;
        const reason = params.reason as string;

        const PROTECTED = ['chief-of-staff', 'head-of-hr'];
        if (PROTECTED.includes(role)) {
          return { success: false, output: `Cannot retire "${role}" — protected role.` };
        }

        // Update agent status
        const { error: agentErr } = await supabase
          .from('company_agents')
          .update({ status: 'retired' })
          .eq('role', role);
        if (agentErr) return { success: false, output: `Failed to retire: ${agentErr.message}` };

        // Disable schedules
        await supabase
          .from('agent_schedules')
          .update({ is_active: false })
          .eq('agent_role', role);

        // Log activity
        await supabase.from('activity_log').insert({
          agent_role: 'head-of-hr',
          action: 'agent_retired',
          details: { retired_role: role, reason },
        });

        return { success: true, output: `Agent "${role}" retired. Reason: ${reason}. Schedules disabled.` };
      },
    },

    // ── Reactivate Agent ──
    {
      name: 'reactivate_agent',
      description: 'Reactivate a previously retired or paused agent.',
      parameters: {
        role: {
          type: 'string',
          description: 'The agent role slug to reactivate.',
          required: true,
        },
      },
      execute: async (params) => {
        const role = params.role as string;

        const { error } = await supabase
          .from('company_agents')
          .update({ status: 'active' })
          .eq('role', role);

        if (error) return { success: false, output: `Failed: ${error.message}` };

        await supabase.from('activity_log').insert({
          agent_role: 'head-of-hr',
          action: 'agent_reactivated',
          details: { reactivated_role: role },
        });

        return { success: true, output: `Agent "${role}" reactivated.` };
      },
    },

    // ── List Stale Agents ──
    {
      name: 'list_stale_agents',
      description: 'Find agents with no recent runs (stale for 14+ days) who are still marked active.',
      parameters: {
        days_threshold: {
          type: 'number',
          description: 'Number of days without runs to consider stale (default: 14).',
          required: false,
        },
      },
      execute: async (params) => {
        const days = (params.days_threshold as number) || 14;
        const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

        // Get active agents
        const { data: agents } = await supabase
          .from('company_agents')
          .select('role, display_name, status')
          .eq('status', 'active');

        if (!agents || agents.length === 0) {
          return { success: true, output: 'No active agents found.' };
        }

        // Get recent runs
        const { data: recentRuns } = await supabase
          .from('agent_runs')
          .select('agent_role, started_at')
          .gte('started_at', cutoff);

        const recentRoles = new Set((recentRuns || []).map((r: Record<string, unknown>) => r.agent_role));

        const stale = agents.filter((a: Record<string, unknown>) => !recentRoles.has(a.role));

        return {
          success: true,
          output: JSON.stringify({
            threshold: `${days} days`,
            staleCount: stale.length,
            staleAgents: stale.map((a: Record<string, unknown>) => ({
              role: a.role,
              displayName: a.display_name || a.role,
            })),
          }, null, 2),
        };
      },
    },

    // ── Set Agent Reports-To ──
    {
      name: 'set_reports_to',
      description: 'Update the reports_to field for an agent in the org chart.',
      parameters: {
        role: {
          type: 'string',
          description: 'The agent role slug to update.',
          required: true,
        },
        manager_role: {
          type: 'string',
          description: 'The role slug of the manager this agent should report to.',
          required: true,
        },
      },
      execute: async (params) => {
        const role = params.role as string;
        const manager = params.manager_role as string;

        // Verify manager exists
        const { data: managerAgent } = await supabase
          .from('company_agents')
          .select('role')
          .eq('role', manager)
          .maybeSingle();

        if (!managerAgent) {
          return { success: false, output: `Manager "${manager}" not found in company_agents.` };
        }

        const { error } = await supabase
          .from('company_agents')
          .update({ reports_to: manager })
          .eq('role', role);

        if (error) return { success: false, output: `Failed: ${error.message}` };
        return { success: true, output: `Agent "${role}" now reports to "${manager}".` };
      },
    },

    // ── Write Admin Log ──
    {
      name: 'write_hr_log',
      description: 'Write an entry to the activity log for HR actions taken.',
      parameters: {
        action: {
          type: 'string',
          description: 'Action type (e.g. onboarding_audit, profile_update, agent_retirement).',
          required: true,
        },
        details: {
          type: 'string',
          description: 'JSON string with details about the action.',
          required: true,
        },
      },
      execute: async (params) => {
        let parsedDetails: Record<string, unknown>;
        try {
          parsedDetails = JSON.parse(params.details as string);
        } catch {
          parsedDetails = { raw: params.details };
        }

        const { error } = await supabase.from('activity_log').insert({
          agent_role: 'head-of-hr',
          action: params.action as string,
          details: parsedDetails,
        });

        if (error) return { success: false, output: `Failed to write log: ${error.message}` };
        return { success: true, output: 'HR action logged.' };
      },
    },
  ];
}
