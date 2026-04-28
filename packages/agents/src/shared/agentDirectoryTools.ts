/**
 * Shared Agent Directory Tools — Available to all agents
 *
 * Provides a dynamic lookup of the company's agents, their roles,
 * departments, skills, and status. Works in all context tiers
 * (including chat) so agents always know who to go to.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createAgentDirectoryTools(): ToolDefinition[] {
  return [
    {
      name: 'get_agent_directory',
      description:
        'Look up agents in the company directory. Each agent has `role` and `role_slug` (canonical DB identifiers) ' +
        'and `name` (human display name only). For create_work_assignments, dispatch_assignment, send_agent_message, ' +
        'and any tool that takes an agent role, always pass `role_slug` or `role` — never pass `name` or hyphenated ' +
        'person-name slugs (e.g. tyler-reed). Filter by department or get the full directory. ' +
        'Set include_tools=true for tool inventory, or include_skills=true for skills.',
      parameters: {
        department: {
          type: 'string',
          description:
            'Optional: filter by department (engineering, finance, product, marketing, sales, design, research, legal, operations, people)',
          required: false,
        },
        role: {
          type: 'string',
          description: 'Optional: look up a specific agent by role slug (e.g., "cto", "cfo")',
          required: false,
        },
        include_tools: {
          type: 'boolean',
          description: 'When true, include each agent\'s tool inventory from their active grants. Use when you need to verify an agent has a specific capability before routing work to them.',
          required: false,
        },
        include_skills: {
          type: 'boolean',
          description: 'When true, include each agent\'s skills and proficiency levels.',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        let data;
        try {
          if (params.role) {
            data = await systemQuery(
              `SELECT role, COALESCE(NULLIF(TRIM(display_name), ''), NULLIF(TRIM(name), ''), '') AS display_name,
                      title, department, status, is_core
               FROM company_agents WHERE role = $1 LIMIT 1`,
              [params.role as string],
            );
          } else if (params.department) {
            data = await systemQuery(
              `SELECT role, COALESCE(NULLIF(TRIM(display_name), ''), NULLIF(TRIM(name), ''), '') AS display_name,
                      title, department, status, is_core
               FROM company_agents WHERE status = $1 AND department = $2 ORDER BY department, is_core DESC`,
              ['active', params.department as string],
            );
          } else {
            data = await systemQuery(
              `SELECT role, COALESCE(NULLIF(TRIM(display_name), ''), NULLIF(TRIM(name), ''), '') AS display_name,
                      title, department, status, is_core
               FROM company_agents WHERE status = $1 ORDER BY department, is_core DESC`,
              ['active'],
            );
          }
        } catch (err) {
          return { success: false, error: (err as Error).message };
        }

        const roles = (data ?? []).map((a: { role: string }) => a.role);

        // Optionally load tool grants per agent
        let toolsByRole: Map<string, string[]> | null = null;
        if (params.include_tools && roles.length > 0) {
          try {
            const grants = await systemQuery<{ agent_role: string; tool_name: string }>(
              'SELECT agent_role, tool_name FROM agent_tool_grants WHERE agent_role = ANY($1) AND is_active = true ORDER BY tool_name',
              [roles],
            );
            toolsByRole = new Map();
            for (const g of grants) {
              const list = toolsByRole.get(g.agent_role) ?? [];
              list.push(g.tool_name);
              toolsByRole.set(g.agent_role, list);
            }
          } catch {
            // Non-critical — continue without tool data
          }
        }

        // Optionally load skills per agent
        let skillsByRole: Map<string, Array<{ skill: string; proficiency: string }>> | null = null;
        if (params.include_skills && roles.length > 0) {
          try {
            const skills = await systemQuery<{ agent_role: string; skill_name: string; proficiency: string }>(
              'SELECT agent_role, skill_name, proficiency FROM agent_skills WHERE agent_role = ANY($1) ORDER BY skill_name',
              [roles],
            );
            skillsByRole = new Map();
            for (const s of skills) {
              const list = skillsByRole.get(s.agent_role) ?? [];
              list.push({ skill: s.skill_name, proficiency: s.proficiency });
              skillsByRole.set(s.agent_role, list);
            }
          } catch {
            // Non-critical — skills table may not exist yet
          }
        }

        const agents = (data ?? []).map(
          (a: {
            role: string;
            display_name: string;
            title: string;
            department: string;
            status: string;
            is_core: boolean;
          }) => {
            const entry: Record<string, unknown> = {
              role: a.role,
              role_slug: a.role,
              // Human-readable label; assignments must use `role` / `role_slug`, not this field.
              name: a.display_name ?? '',
              title: a.title,
              department: a.department,
              is_executive: a.is_core,
              how_to_reach: `send_agent_message with to_agent="${a.role}"`,
            };
            if (toolsByRole) {
              const tools = toolsByRole.get(a.role) ?? [];
              entry.tool_count = tools.length;
              entry.tools = tools;
            }
            if (skillsByRole) {
              entry.skills = skillsByRole.get(a.role) ?? [];
            }
            return entry;
          },
        );

        return {
          success: true,
          data: {
            count: agents.length,
            agents,
            hint_for_assignments:
              'Use each agent\'s role_slug (or role) as assigned_to / to_agent. The name field is display-only and must not be used as a role.',
          },
        };
      },
    },

    {
      name: 'who_handles',
      description:
        'Quick lookup: find the right agent for a specific need. Describe what you need ' +
        '(e.g., "deploy to production", "create a Teams channel", "analyze costs") ' +
        'and get the best agent to contact. Searches by department, title, and capabilities.',
      parameters: {
        need: {
          type: 'string',
          description: 'What you need help with — describe the task or capability',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        if (!params.need) return { success: false, error: 'need parameter is required' };
        const need = (params.need as string).toLowerCase();

        // Static routing table — covers the most common cross-agent needs
        // This provides instant results without DB round-trips
        const ROUTING: Array<{
          keywords: string[];
          role: string;
          name: string;
          reason: string;
        }> = [
          {
            keywords: ['tool failure', 'tool error', 'tool broken', 'tool bug', 'tool fix', 'agent health', 'agent performance', 'fleet health', 'agent failing', 'agent broken', 'column does not exist', 'schema error', 'sql error', 'tool access', 'tool grant', 'tool block', 'performance score', 'eval score', 'prompt version', 'shadow run', 'reflection', 'agent paused', 'gtm readiness'],
            role: 'cto',
            name: 'Marcus Reeves',
            reason: 'CTO — diagnoses tool failures, fixes schema mismatches, manages tool grants, monitors agent fleet health, and creates code fix proposals.',
          },
          {
            keywords: ['infrastructure', 'deploy', 'cloud run', 'build', 'ci/cd', 'platform', 'incident', 'outage', 'tool request', 'new tool', 'api integration', 'tool registry'],
            role: 'cto',
            name: 'Marcus Reeves',
            reason: 'CTO — owns infrastructure, deployments, platform health, tool registry, and incident response',
          },
          {
            keywords: ['cost', 'budget', 'revenue', 'financial', 'pricing', 'expense', 'billing', 'margin', 'unit economics'],
            role: 'cfo',
            name: 'Nadia Okafor',
            reason: 'CFO — owns financial analysis, cost optimization, revenue tracking, and budgets',
          },
          {
            keywords: ['product', 'feature', 'roadmap', 'priorit', 'user research', 'competitive', 'backlog', 'spec'],
            role: 'cpo',
            name: 'Elena Vasquez',
            reason: 'CPO — owns product roadmap, feature prioritization, user research, and competitive intelligence',
          },
          {
            keywords: ['marketing', 'content', 'blog', 'social media', 'seo', 'brand', 'campaign', 'awareness'],
            role: 'cmo',
            name: 'Maya Brooks',
            reason: 'CMO — owns content strategy, social media, SEO, brand positioning, and campaigns',
          },
          {
            keywords: ['sales', 'pipeline', 'enterprise', 'proposal', 'deal', 'prospect', 'account', 'lead', 'contract'],
            role: 'cpo',
            name: 'Elena Vasquez',
            reason: 'CPO — owns sales pipeline, customer conversations, and deal strategy',
          },
          {
            keywords: ['design', 'ui', 'ux', 'template', 'frontend', 'component', 'figma', 'layout', 'visual'],
            role: 'vp-design',
            name: 'Mia Tanaka',
            reason: 'VP Design — owns design system, UI/UX audits, templates, and frontend visual quality',
          },
          {
            keywords: ['research', 'market', 'competitor', 'competitive', 'industry', 'tam', 'sam', 'trend'],
            role: 'vp-research',
            name: 'Sophia Lin',
            reason: 'VP Research — owns market research, competitive analysis, and industry intelligence',
          },
          {
            keywords: ['permission', 'access', 'iam', 'license', 'entra', 'gcp access', 'onboard', 'offboard', 'provision', 'teams channel', 'teams', 'm365', 'calendar', 'sharepoint', 'email config', 'channel', 'membership'],
            role: 'cto',
            name: 'Marcus Reeves',
            reason: 'CTO — owns access provisioning, GCP/Entra/M365 permissions, Teams/SharePoint config, and onboarding',
          },
          {
            keywords: ['coordinate', 'brief', 'directive', 'cross-department', 'escalat', 'route', 'assign', 'orchestrat', 'decision'],
            role: 'chief-of-staff',
            name: 'Sarah Chen',
            reason: 'Chief of Staff — coordinates cross-department work, routes tasks, manages directives and briefings',
          },
          {
            keywords: ['legal', 'compliance', 'contract review', 'privacy', 'gdpr', 'terms', 'ip', 'regulatory'],
            role: 'clo',
            name: 'Victoria Chase',
            reason: 'CLO — owns legal review, compliance, contracts, privacy, and regulatory matters',
          },
          {
            keywords: ['monitor', 'uptime', 'anomal', 'system health', 'alert', 'ops'],
            role: 'ops',
            name: 'Atlas Vega',
            reason: 'Ops — owns continuous monitoring, anomaly detection, uptime tracking, and system alerts',
          },
        ];

        const matches = ROUTING.filter((r) =>
          r.keywords.some((kw) => need.includes(kw)),
        );

        if (matches.length > 0) {
          // Check DB status for matched agents so we don't route to paused/inactive agents
          let activeRoles: Set<string>;
          try {
            const rows = await systemQuery<{ role: string }>(
              "SELECT role FROM company_agents WHERE status = 'active' AND role = ANY($1)",
              [matches.map((m) => m.role)],
            );
            activeRoles = new Set(rows.map((r) => r.role));
          } catch {
            // If DB is unreachable, return all matches (graceful degradation)
            activeRoles = new Set(matches.map((m) => m.role));
          }

          const activeMatches = matches.filter((m) => activeRoles.has(m.role));
          const pausedMatches = matches.filter((m) => !activeRoles.has(m.role));

          const result: Record<string, unknown> = {
            matches: activeMatches.map((m) => ({
              agent: m.name,
              role: m.role,
              why: m.reason,
              how_to_reach: `Use send_agent_message with to_agent="${m.role}"`,
            })),
          };

          if (pausedMatches.length > 0) {
            result.unavailable = pausedMatches.map((m) => ({
              agent: m.name,
              role: m.role,
              status: 'paused or inactive',
              note: `${m.name} is currently unavailable. Contact chief-of-staff to get them reactivated, or message ops (Atlas) to resume them.`,
            }));
          }

          // If all matches are paused, suggest Sarah as fallback
          if (activeMatches.length === 0) {
            result.matches = [{
              agent: 'Sarah Chen',
              role: 'chief-of-staff',
              why: `The usual handler(s) for this need (${pausedMatches.map(m => m.name).join(', ')}) are currently paused/inactive. Sarah can help route to an alternative or reactivate them.`,
              how_to_reach: 'Use send_agent_message with to_agent="chief-of-staff"',
            }];
          }

          return { success: true, data: result };
        }

        // Fallback: suggest Sarah as the router
        return {
          success: true,
          data: {
            matches: [
              {
                agent: 'Sarah Chen',
                role: 'chief-of-staff',
                why: 'Chief of Staff — the central coordinator. Message Sarah when you\'re not sure who handles something; she\'ll route it to the right person.',
                how_to_reach: 'Use send_agent_message with to_agent="chief-of-staff"',
              },
            ],
            note: `No exact match for "${params.need}". Sarah Chen (CoS) can help route your request.`,
          },
        };
      },
    },
  ];
}
