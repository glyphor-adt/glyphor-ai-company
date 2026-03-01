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
        const { data: profiles } = await supabase.from('agent_profiles').select('agent_id, personality_summary, backstory, avatar_url, communication_traits');
        const profileMap = new Map((profiles || []).map((p: Record<string, unknown>) => [p.agent_id, p]));

        // Fetch all briefs
        const { data: briefs } = await supabase.from('agent_briefs').select('agent_id, system_prompt');
        const briefMap = new Map((briefs || []).map((b: Record<string, unknown>) => [b.agent_id, b]));

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
          .eq('agent_id', role)
          .maybeSingle();

        const { data: brief } = await supabase
          .from('agent_briefs')
          .select('*')
          .eq('agent_id', role)
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
          .upsert({ agent_id: role, ...updateData }, { onConflict: 'agent_id' });

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
          .eq('agent_id', role);

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
          .select('agent_id, started_at')
          .gte('started_at', cutoff);

        const recentRoles = new Set((recentRuns || []).map((r: Record<string, unknown>) => r.agent_id));

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

    // ── Generate Avatar ──
    {
      name: 'generate_avatar',
      description:
        'Generate a professional AI headshot for an agent using Imagen and upload it to GCS. ' +
        'Updates agent_profiles.avatar_url with the resulting public URL.',
      parameters: {
        role: { type: 'string', description: 'Agent role slug.', required: true },
        name: { type: 'string', description: 'Human name for the agent.', required: true },
        appearance_description: {
          type: 'string',
          description:
            'Physical appearance description for the headshot (ethnicity, age range, hair, style, distinguishing features).',
          required: true,
        },
      },
      execute: async (params) => {
        const role = params.role as string;
        const name = params.name as string;
        const desc = params.appearance_description as string;

        const apiKey = process.env.GOOGLE_AI_API_KEY;
        if (!apiKey) {
          return { success: false, output: 'GOOGLE_AI_API_KEY not set — cannot generate avatar.' };
        }

        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });

        const prompt =
          `Professional corporate headshot portrait photo of ${desc}. ` +
          `Clean solid neutral background, soft studio lighting, shot from chest up. ` +
          `High quality, photorealistic, corporate photography style. ` +
          `The person looks like a tech industry professional. ` +
          `No text, no watermark, no logo.`;

        try {
          const response = await ai.models.generateImages({
            model: 'imagen-4.0-generate-001',
            prompt,
            config: { numberOfImages: 1, aspectRatio: '1:1' },
          });

          const image = response.generatedImages?.[0];
          if (!image?.image?.imageBytes) {
            return { success: false, output: `Imagen returned no image for "${name}".` };
          }

          // Upload to GCS
          const { Storage } = await import('@google-cloud/storage');
          const storage = new Storage();
          const bucketName = process.env.GCS_BUCKET || 'glyphor-company';
          const gcsPath = `avatars/${role}.png`;
          const file = storage.bucket(bucketName).file(gcsPath);

          await file.save(Buffer.from(image.image.imageBytes, 'base64'), {
            contentType: 'image/png',
            metadata: { cacheControl: 'public, max-age=86400' },
          });

          const avatarUrl = `https://storage.googleapis.com/${bucketName}/${gcsPath}`;

          // Update agent_profiles with the new URL
          await supabase
            .from('agent_profiles')
            .upsert({ agent_id: role, avatar_url: avatarUrl }, { onConflict: 'agent_id' });

          return {
            success: true,
            output: `Avatar generated for "${name}" (${role}) and uploaded to ${avatarUrl}.`,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return { success: false, output: `Avatar generation failed: ${message}` };
        }
      },
    },

    // ── Provision Agent ──
    {
      name: 'provision_agent',
      description:
        'Create a new permanent agent in company_agents. Use this to onboard a new team member ' +
        'that does not yet exist in the system. This creates the base record — follow up with ' +
        'update_agent_profile or enrich_agent_profile to complete their profile, and generate_avatar for their headshot.',
      parameters: {
        role: {
          type: 'string',
          description: 'Agent role slug (lowercase, hyphenated, e.g. "vp-partnerships"). Must be unique.',
          required: true,
        },
        name: {
          type: 'string',
          description: 'Human name (e.g. "Elena Vance").',
          required: true,
        },
        title: {
          type: 'string',
          description: 'Job title (e.g. "VP of Partnerships").',
          required: true,
        },
        department: {
          type: 'string',
          description: 'Department (e.g. "Sales", "Engineering", "Legal").',
          required: true,
        },
        reports_to: {
          type: 'string',
          description: 'Role slug of the manager this agent reports to (e.g. "chief-of-staff").',
          required: true,
        },
        model: {
          type: 'string',
          description: 'AI model to use (default: gemini-3-flash-preview).',
          required: false,
        },
      },
      execute: async (params) => {
        const role = (params.role as string).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
        const name = params.name as string;
        const title = params.title as string;
        const department = params.department as string;
        const reportsTo = params.reports_to as string;
        const model = (params.model as string) || 'gemini-3-flash-preview';

        if (!role || !name || !title || !department || !reportsTo) {
          return { success: false, output: 'role, name, title, department, and reports_to are all required.' };
        }

        // Verify manager exists
        const { data: mgr } = await supabase
          .from('company_agents')
          .select('role')
          .eq('role', reportsTo)
          .maybeSingle();
        if (!mgr) {
          return { success: false, output: `Manager "${reportsTo}" not found in company_agents.` };
        }

        // Check if agent already exists
        const { data: existing } = await supabase
          .from('company_agents')
          .select('role')
          .eq('role', role)
          .maybeSingle();
        if (existing) {
          return { success: false, output: `Agent "${role}" already exists. Use validate_agent to check its profile.` };
        }

        const { error: insertErr } = await supabase
          .from('company_agents')
          .insert({
            role,
            display_name: name,
            name,
            title,
            department,
            reports_to: reportsTo,
            model,
            status: 'active',
            is_core: false,
            is_temporary: false,
          });

        if (insertErr) {
          return { success: false, output: `Failed to provision agent: ${insertErr.message}` };
        }

        // Log the provisioning
        await supabase.from('activity_log').insert({
          agent_role: 'head-of-hr',
          action: 'agent_provisioned',
          details: { role, name, title, department, reports_to: reportsTo },
        });

        return {
          success: true,
          output: `Agent "${name}" (${role}) provisioned successfully in ${department}, reporting to ${reportsTo}.\n\nNext steps:\n1. Use enrich_agent_profile to generate personality\n2. Use generate_avatar to create headshot\n3. Use validate_agent to confirm onboarding completeness`,
        };
      },
    },

    // ── Enrich Agent Profile ──
    {
      name: 'enrich_agent_profile',
      description:
        'Use AI to generate a rich personality profile for a new or sparse agent. ' +
        'Generates personality_summary, backstory, communication_traits, quirks, ' +
        'working_style, tone_formality, verbosity, and emoji_usage based on agent context.',
      parameters: {
        role: { type: 'string', description: 'Agent role slug.', required: true },
        title: { type: 'string', description: 'Job title (e.g. "VP of Sales").', required: false },
        department: { type: 'string', description: 'Department (e.g. "Revenue").', required: false },
        name: { type: 'string', description: 'Human name for the agent.', required: false },
      },
      execute: async (params) => {
        const role = params.role as string;
        const title = (params.title as string) || role;
        const department = (params.department as string) || 'General';
        const agentName = (params.name as string) || role;

        const apiKey = process.env.GOOGLE_AI_API_KEY;
        if (!apiKey) {
          return { success: false, output: 'GOOGLE_AI_API_KEY not set — cannot enrich profile.' };
        }

        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });

        const genPrompt =
          `You are generating a personality profile for an AI agent at a tech company called Glyphor.\n\n` +
          `Agent details:\n` +
          `- Role slug: ${role}\n` +
          `- Title: ${title}\n` +
          `- Department: ${department}\n` +
          `- Name: ${agentName}\n\n` +
          `Generate a JSON object with these fields:\n` +
          `- personality_summary: 2-3 sentence first-person personality summary\n` +
          `- backstory: 2-3 sentences on why they joined Glyphor and what drives them\n` +
          `- communication_traits: array of 4-5 trait strings\n` +
          `- quirks: array of 2-3 personality quirks\n` +
          `- working_style: 1 sentence description\n` +
          `- tone_formality: number 0.0-1.0\n` +
          `- verbosity: number 0.0-1.0\n` +
          `- emoji_usage: "none" | "minimal" | "moderate"\n\n` +
          `Return ONLY the JSON object, no markdown fencing.`;

        try {
          const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: genPrompt,
          });

          const text = response.text?.trim();
          if (!text) {
            return { success: false, output: 'Gemini returned empty response.' };
          }

          const cleaned = text.replace(/^```json\s*/, '').replace(/```\s*$/, '');
          const profile = JSON.parse(cleaned) as Record<string, unknown>;

          const { error } = await supabase
            .from('agent_profiles')
            .upsert(
              {
                agent_id: role,
                personality_summary: profile.personality_summary,
                backstory: profile.backstory,
                communication_traits: profile.communication_traits,
                quirks: profile.quirks,
                working_style: profile.working_style,
                tone_formality: profile.tone_formality,
                verbosity: profile.verbosity,
                emoji_usage: profile.emoji_usage,
              },
              { onConflict: 'agent_id' },
            );

          if (error) return { success: false, output: `DB upsert failed: ${error.message}` };

          return {
            success: true,
            output: `Profile enriched for "${agentName}" (${role}):\n${JSON.stringify(profile, null, 2)}`,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return { success: false, output: `Profile enrichment failed: ${message}` };
        }
      },
    },
  ];
}
