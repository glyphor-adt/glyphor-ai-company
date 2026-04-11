/**
 * Head of HR (Jasmine Rivera) — Domain Tools
 * Agent onboarding validation, workforce audits, and agent lifecycle management.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import { getGoogleAiApiKey, getTierModel } from '@glyphor/shared';
import { systemQuery } from '@glyphor/shared/db';

const DEFAULT_AGENT_MODEL = getTierModel('default');

/** Safely coerce an AI-generated value to a number for DECIMAL columns. */
function toNumeric(value: unknown, fallback: number): number {
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function createHeadOfHRTools(memory: CompanyMemoryStore): ToolDefinition[] {

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
        let agents: Record<string, unknown>[];
        try {
          if (statusFilter !== 'all') {
            agents = await systemQuery('SELECT * FROM company_agents WHERE status = $1', [statusFilter]);
          } else {
            agents = await systemQuery('SELECT * FROM company_agents', []);
          }
        } catch (err) {
          return { success: false, error: `Failed to fetch agents: ${(err as Error).message}` };
        }

        // Fetch all profiles
        const profiles = await systemQuery('SELECT agent_id, personality_summary, backstory, avatar_url, communication_traits FROM agent_profiles', []);
        const profileMap = new Map(profiles.map((p: Record<string, unknown>) => [p.agent_id, p]));

        // Fetch all briefs
        const briefs = await systemQuery('SELECT agent_id, system_prompt FROM agent_briefs', []);
        const briefMap = new Map(briefs.map((b: Record<string, unknown>) => [b.agent_id, b]));

        const issues: Array<{ role: string; problems: string[] }> = [];
        const validRoles = new Set((agents).map((a: Record<string, unknown>) => a.role));

        for (const agent of agents) {
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

        const total = agents.length;
        const compliant = total - issues.length;

        return {
          success: true,
          data: JSON.stringify({
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

        const agentRows = await systemQuery('SELECT * FROM company_agents WHERE role = $1', [role]);
        const agent = agentRows[0] ?? null;
        if (!agent) return { success: false, error: `Agent "${role}" not found in company_agents.` };

        const profileRows = await systemQuery('SELECT * FROM agent_profiles WHERE agent_id = $1', [role]);
        const profile = profileRows[0] ?? null;

        const briefRows = await systemQuery('SELECT * FROM agent_briefs WHERE agent_id = $1', [role]);
        const brief = briefRows[0] ?? null;

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
        checklist['model'] = agent.model === DEFAULT_AGENT_MODEL
          ? { pass: true, detail: agent.model }
          : { pass: false, detail: `${agent.model ?? 'NOT SET'} (should be ${DEFAULT_AGENT_MODEL})` };

        const passed = Object.values(checklist).filter((c) => c.pass).length;
        const total = Object.values(checklist).length;

        return {
          success: true,
          data: JSON.stringify({
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
          type: 'number',
          description: 'Emoji usage 0.0-1.0 (0.0 = none, 0.3 = minimal, 0.5 = moderate).',
          required: false,
        },
      },
      execute: async (params) => {
        const role = params.role as string;
        const updateData: Record<string, unknown> = {};

        if (params.personality_summary) updateData.personality_summary = params.personality_summary;
        if (params.backstory) updateData.backstory = params.backstory;
        if (params.communication_traits) {
          const arr = params.communication_traits as string[];
          updateData.communication_traits = Array.isArray(arr) ? arr.map(String) : arr;
        }
        if (params.quirks) {
          const arr = params.quirks as string[];
          updateData.quirks = Array.isArray(arr) ? arr.map(String) : arr;
        }
        if (params.tone_formality !== undefined) updateData.tone_formality = toNumeric(params.tone_formality, 0.6);
        if (params.verbosity !== undefined) updateData.verbosity = toNumeric(params.verbosity, 0.5);
        if (params.working_style) updateData.working_style = params.working_style;
        if (params.emoji_usage !== undefined) updateData.emoji_usage = toNumeric(params.emoji_usage, 0.1);

        if (Object.keys(updateData).length === 0) {
          return { success: false, error: 'No fields provided to update.' };
        }

        try {
          const keys = Object.keys(updateData);
          const allCols = ['agent_id', ...keys];
          const placeholders = allCols.map((_, i) => `$${i + 1}`).join(', ');
          const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
          await systemQuery(
            `INSERT INTO agent_profiles (${allCols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (agent_id) DO UPDATE SET ${setClauses}`,
            [role, ...keys.map(k => updateData[k])]
          );
        } catch (err) {
          return { success: false, error: `Failed to update profile: ${(err as Error).message}` };
        }
        return { success: true, data: `Profile for "${role}" updated: ${Object.keys(updateData).join(', ')}` };
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

        try {
          await systemQuery('UPDATE company_agents SET display_name = $1, name = $1 WHERE role = $2', [displayName, role]);
        } catch (err) {
          return { success: false, error: `Failed: ${(err as Error).message}` };
        }
        return { success: true, data: `Agent "${role}" display_name set to "${displayName}".` };
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
          return { success: false, error: `Cannot retire "${role}" — protected role.` };
        }

        // Update agent status
        try {
          await systemQuery('UPDATE company_agents SET status = $1 WHERE role = $2', ['retired', role]);
        } catch (err) {
          return { success: false, error: `Failed to retire: ${(err as Error).message}` };
        }

        // Disable schedules
        await systemQuery('UPDATE agent_schedules SET is_active = $1 WHERE agent_id = $2', [false, role]);

        // Log activity
        await systemQuery(
          'INSERT INTO activity_log (agent_role, action, details) VALUES ($1, $2, $3)',
          ['head-of-hr', 'agent_retired', JSON.stringify({ retired_role: role, reason })]
        );

        return { success: true, data: `Agent "${role}" retired. Reason: ${reason}. Schedules disabled.` };
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

        try {
          await systemQuery('UPDATE company_agents SET status = $1 WHERE role = $2', ['active', role]);
        } catch (err) {
          return { success: false, error: `Failed: ${(err as Error).message}` };
        }

        await systemQuery(
          'INSERT INTO activity_log (agent_role, action, details) VALUES ($1, $2, $3)',
          ['head-of-hr', 'agent_reactivated', JSON.stringify({ reactivated_role: role })]
        );

        return { success: true, data: `Agent "${role}" reactivated.` };
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
        const agents = await systemQuery('SELECT role, display_name, status FROM company_agents WHERE status = $1', ['active']);

        if (agents.length === 0) {
          return { success: true, data: 'No active agents found.' };
        }

        // Get recent runs
        const recentRuns = await systemQuery('SELECT agent_id, started_at FROM agent_runs WHERE started_at >= $1', [cutoff]);

        const recentRoles = new Set(recentRuns.map((r: Record<string, unknown>) => r.agent_id));

        const stale = agents.filter((a: Record<string, unknown>) => !recentRoles.has(a.role));

        return {
          success: true,
          data: JSON.stringify({
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
        const [managerAgent] = await systemQuery('SELECT role FROM company_agents WHERE role = $1', [manager]);

        if (!managerAgent) {
          return { success: false, error: `Manager "${manager}" not found in company_agents.` };
        }

        try {
          await systemQuery('UPDATE company_agents SET reports_to = $1 WHERE role = $2', [manager, role]);
        } catch (err) {
          return { success: false, error: `Failed: ${(err as Error).message}` };
        }
        return { success: true, data: `Agent "${role}" now reports to "${manager}".` };
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

        try {
          await systemQuery(
            'INSERT INTO activity_log (agent_role, action, details) VALUES ($1, $2, $3)',
            ['head-of-hr', params.action as string, JSON.stringify(parsedDetails)]
          );
        } catch (err) {
          return { success: false, error: `Failed to write log: ${(err as Error).message}` };
        }
        return { success: true, data: 'HR action logged.' };
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

        const apiKey = getGoogleAiApiKey();
        if (!apiKey) {
          return { success: false, error: 'Google AI API key not configured (GCP Secret Manager google-ai-api-key → GOOGLE_AI_API_KEY).' };
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
            return { success: false, error: `Imagen returned no image for "${name}".` };
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
          await systemQuery(
            'INSERT INTO agent_profiles (agent_id, avatar_url) VALUES ($1, $2) ON CONFLICT (agent_id) DO UPDATE SET avatar_url = $2',
            [role, avatarUrl]
          );

          return {
            success: true,
            data: `Avatar generated for "${name}" (${role}) and uploaded to ${avatarUrl}.`,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return { success: false, error: `Avatar generation failed: ${message}` };
        }
      },
    },

    // ── Provision Agent ──
    {
      name: 'provision_agent',
      description:
        'Create a fully onboarded permanent agent — inserts company_agents, agent_briefs (system prompt), ' +
        'and agent_profiles (personality, backstory, traits, avatar) in one atomic operation. ' +
        'After provisioning, use generate_avatar to upgrade the placeholder headshot and enrich_agent_profile for richer personality.',
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
        system_prompt: {
          type: 'string',
          description: 'The agent\'s system prompt defining personality, expertise, responsibilities, and instructions. Must be 100+ chars.',
          required: true,
        },
        personality_summary: {
          type: 'string',
          description: 'First-person personality summary (2+ sentences). E.g. "I\'m a data-driven marketer who thrives on turning analytics into action..."',
          required: true,
        },
        backstory: {
          type: 'string',
          description: 'Why this agent exists and what gap they fill at Glyphor (2+ sentences).',
          required: true,
        },
        communication_traits: {
          type: 'array',
          description: 'Array of 3+ communication trait strings (e.g. ["concise", "data-driven", "collaborative"]).',
          required: true,
          items: { type: 'string', description: 'A communication trait.' },
        },
        quirks: {
          type: 'array',
          description: 'Array of 1+ personality quirk strings (e.g. ["always leads with metrics"]).',
          required: true,
          items: { type: 'string', description: 'A quirk.' },
        },
        skills: {
          type: 'array',
          description: 'Array of skill names this agent should have (e.g. ["social-media-management", "content-strategy"]).',
          required: false,
          items: { type: 'string', description: 'A skill name.' },
        },
        tools: {
          type: 'array',
          description: 'Array of tool names to grant this agent (e.g. ["send_agent_message", "check_messages"]).',
          required: false,
          items: { type: 'string', description: 'A tool name.' },
        },
        working_style: {
          type: 'string',
          description: 'Working style description (e.g. "outcome-driven", "collaborative and iterative").',
          required: false,
        },
        tone_formality: {
          type: 'number',
          description: 'Tone formality 0.0-1.0 (0.3-0.8 recommended). Default: 0.6.',
          required: false,
        },
        verbosity: {
          type: 'number',
          description: 'Verbosity 0.0-1.0 (0.3-0.7 recommended). Default: 0.5.',
          required: false,
        },
        model: {
          type: 'string',
          description: 'AI model to use (defaults to configured default tier model).',
          required: false,
        },
      },
      execute: async (params) => {
        const role = (params.role as string).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
        const name = params.name as string;
        const title = params.title as string;
        const department = params.department as string;
        const reportsTo = params.reports_to as string;
        const systemPrompt = params.system_prompt as string;
        const personalitySummary = params.personality_summary as string;
        const backstory = params.backstory as string;
        const communicationTraits = (params.communication_traits as string[] | undefined) ?? [];
        const quirks = (params.quirks as string[] | undefined) ?? [];
        const skills = (params.skills as string[] | undefined) ?? [];
        const tools = (params.tools as string[] | undefined) ?? [];
        const workingStyle = (params.working_style as string) || 'outcome-driven';
        const toneFormality = toNumeric(params.tone_formality, 0.6);
        const verbosity = toNumeric(params.verbosity, 0.5);
        const model = (params.model as string) || DEFAULT_AGENT_MODEL;

        // ── Validate required fields ──
        if (!role || !name || !title || !department || !reportsTo) {
          return { success: false, error: 'role, name, title, department, and reports_to are all required.' };
        }
        if (!systemPrompt || systemPrompt.length < 100) {
          return { success: false, error: 'system_prompt is required and must be at least 100 characters. Define the agent\'s expertise, responsibilities, and personality.' };
        }
        if (!personalitySummary || personalitySummary.length < 20) {
          return { success: false, error: 'personality_summary is required (2+ sentences, first-person voice).' };
        }
        if (!backstory || backstory.length < 20) {
          return { success: false, error: 'backstory is required (explain why this agent exists and what gap they fill).' };
        }
        if (!Array.isArray(communicationTraits) || communicationTraits.length < 3) {
          return { success: false, error: 'communication_traits must be an array with 3+ trait strings.' };
        }
        if (!Array.isArray(quirks) || quirks.length < 1) {
          return { success: false, error: 'quirks must be an array with at least 1 entry.' };
        }

        // Verify manager exists
        const [mgr] = await systemQuery('SELECT role FROM company_agents WHERE role = $1', [reportsTo]);
        if (!mgr) {
          return { success: false, error: `Manager "${reportsTo}" not found in company_agents.` };
        }

        // Check if agent already exists
        const [existing] = await systemQuery('SELECT role FROM company_agents WHERE role = $1', [role]);
        if (existing) {
          return { success: false, error: `Agent "${role}" already exists. Use validate_agent to check its profile.` };
        }

        // ── 1. Create company_agents row ──
        try {
          await systemQuery(
            'INSERT INTO company_agents (role, display_name, name, title, department, reports_to, model, status, is_core, is_temporary) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
            [role, name, name, title, department, reportsTo, model, 'active', false, false]
          );
        } catch (err) {
          return { success: false, error: `Failed to provision agent: ${(err as Error).message}` };
        }

        // ── 2. Create agent_briefs row (system prompt, skills, tools) ──
        await systemQuery(
          `INSERT INTO agent_briefs (agent_id, system_prompt, skills, tools, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (agent_id) DO UPDATE SET system_prompt = EXCLUDED.system_prompt, skills = EXCLUDED.skills, tools = EXCLUDED.tools, updated_at = NOW()`,
          [role, systemPrompt, skills, tools]
        );

        // ── 3. Create agent_profiles row (personality, backstory, traits, avatar) ──
        const avatarSeed = encodeURIComponent(name.trim() || 'Agent');
        const avatarUrl = `https://api.dicebear.com/9.x/initials/svg?seed=${avatarSeed}&radius=50&bold=true`;

        await systemQuery(
          `INSERT INTO agent_profiles (agent_id, personality_summary, backstory, communication_traits, quirks, tone_formality, emoji_usage, verbosity, working_style, avatar_url, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
           ON CONFLICT (agent_id) DO UPDATE SET personality_summary = EXCLUDED.personality_summary, backstory = EXCLUDED.backstory, communication_traits = EXCLUDED.communication_traits, quirks = EXCLUDED.quirks, tone_formality = EXCLUDED.tone_formality, emoji_usage = EXCLUDED.emoji_usage, verbosity = EXCLUDED.verbosity, working_style = EXCLUDED.working_style, avatar_url = COALESCE(agent_profiles.avatar_url, EXCLUDED.avatar_url), updated_at = NOW()`,
          [role, personalitySummary, backstory, communicationTraits.map(String), quirks.map(String), toneFormality, 0, verbosity, workingStyle, avatarUrl]
        );

        // ── 4. Log the provisioning ──
        await systemQuery(
          'INSERT INTO activity_log (agent_role, action, details) VALUES ($1, $2, $3)',
          ['head-of-hr', 'agent_provisioned', JSON.stringify({ role, name, title, department, reports_to: reportsTo, has_brief: true, has_profile: true })]
        );

        return {
          success: true,
          data: `Agent "${name}" (${role}) fully provisioned in ${department}, reporting to ${reportsTo}.\n\nCreated:\n- company_agents row (name, title, department, model)\n- agent_briefs row (system prompt: ${systemPrompt.length} chars, ${skills.length} skills, ${tools.length} tools)\n- agent_profiles row (personality, backstory, ${communicationTraits.length} traits, ${quirks.length} quirks, avatar)\n\nOptional next steps:\n1. Use generate_avatar to upgrade from DiceBear placeholder to AI headshot\n2. Use enrich_agent_profile if you want to regenerate a richer personality via AI\n3. Use validate_agent to confirm onboarding completeness`,
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

        const apiKey = getGoogleAiApiKey();
        if (!apiKey) {
          return { success: false, error: 'Google AI API key not configured (GCP Secret Manager google-ai-api-key → GOOGLE_AI_API_KEY).' };
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
          `- emoji_usage: number 0.0-1.0 (0.0 = none, 0.3 = minimal, 0.5 = moderate)\n\n` +
          `Return ONLY the JSON object, no markdown fencing.`;

        try {
          const response = await ai.models.generateContent({
            model: DEFAULT_AGENT_MODEL,
            contents: genPrompt,
          });

          const text = response.text?.trim();
          if (!text) {
            return { success: false, error: 'Gemini returned empty response.' };
          }

          const cleaned = text.replace(/^```json\s*/, '').replace(/```\s*$/, '');
          const profile = JSON.parse(cleaned) as Record<string, unknown>;

          try {
            // Pass native JS arrays — the pg driver converts them to PostgreSQL array format
            const traits = Array.isArray(profile.communication_traits)
              ? profile.communication_traits.map(String)
              : null;
            const quirks = Array.isArray(profile.quirks)
              ? profile.quirks.map(String)
              : null;

            await systemQuery(
              `INSERT INTO agent_profiles (agent_id, personality_summary, backstory, communication_traits, quirks, working_style, tone_formality, verbosity, emoji_usage)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (agent_id) DO UPDATE SET
                 personality_summary = $2, backstory = $3, communication_traits = $4, quirks = $5,
                 working_style = $6, tone_formality = $7, verbosity = $8, emoji_usage = $9`,
              [role, profile.personality_summary, profile.backstory, traits, quirks, profile.working_style, toNumeric(profile.tone_formality, 0.6), toNumeric(profile.verbosity, 0.5), toNumeric(profile.emoji_usage, 0.1)]
            );
          } catch (err) {
            return { success: false, error: `DB upsert failed: ${(err as Error).message}` };
          }

          return {
            success: true,
            data: `Profile enriched for "${agentName}" (${role}):\n${JSON.stringify(profile, null, 2)}`,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return { success: false, error: `Profile enrichment failed: ${message}` };
        }
      },
    },
  ];
}
