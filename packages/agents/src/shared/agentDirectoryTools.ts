/**
 * Shared Agent Directory Tools — Available to all agents
 *
 * Provides a dynamic lookup of the company's agents, their roles,
 * departments, skills, and status. Works in all context tiers
 * (including chat) so agents always know who to go to.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createAgentDirectoryTools(
  supabase: SupabaseClient,
): ToolDefinition[] {
  return [
    {
      name: 'get_agent_directory',
      description:
        'Look up agents in the company directory. Returns name, title, department, status, ' +
        'and what they handle. Use this when you need to find the right agent to message, ' +
        'delegate to, or collaborate with. Filter by department or get the full directory.',
      parameters: {
        department: {
          type: 'string',
          description:
            'Optional: filter by department (engineering, finance, product, marketing, sales, customer-success, design, operations, legal, people)',
          required: false,
        },
        role: {
          type: 'string',
          description: 'Optional: look up a specific agent by role slug (e.g., "cto", "cfo")',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        let query = supabase
          .from('company_agents')
          .select('role, display_name, title, department, status, is_core')
          .eq('status', 'active')
          .order('department')
          .order('is_core', { ascending: false });

        if (params.role) {
          query = supabase
            .from('company_agents')
            .select('role, display_name, title, department, status, is_core')
            .eq('role', params.role as string)
            .limit(1);
        } else if (params.department) {
          query = query.eq('department', params.department as string);
        }

        const { data, error } = await query;
        if (error) return { success: false, error: error.message };

        const agents = (data ?? []).map(
          (a: {
            role: string;
            display_name: string;
            title: string;
            department: string;
            status: string;
            is_core: boolean;
          }) => ({
            role: a.role,
            name: a.display_name,
            title: a.title,
            department: a.department,
            is_executive: a.is_core,
            how_to_reach: `send_agent_message with to_agent="${a.role}"`,
          }),
        );

        return {
          success: true,
          data: { count: agents.length, agents },
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
            keywords: ['customer', 'churn', 'onboarding', 'support', 'health score', 'nps', 'retention', 'ticket'],
            role: 'vp-customer-success',
            name: 'James Turner',
            reason: 'VP Customer Success — owns customer health, churn prevention, support triage, and onboarding',
          },
          {
            keywords: ['sales', 'pipeline', 'enterprise', 'proposal', 'deal', 'prospect', 'account', 'lead', 'contract'],
            role: 'vp-sales',
            name: 'Rachel Kim',
            reason: 'VP Sales — owns sales pipeline, enterprise accounts, proposals, and deal strategy',
          },
          {
            keywords: ['design', 'ui', 'ux', 'template', 'frontend', 'component', 'figma', 'layout', 'visual'],
            role: 'vp-design',
            name: 'Mia Tanaka',
            reason: 'VP Design — owns design system, UI/UX audits, templates, and frontend visual quality',
          },
          {
            keywords: ['permission', 'access', 'iam', 'license', 'entra', 'gcp access', 'onboard', 'offboard', 'provision'],
            role: 'global-admin',
            name: 'Morgan Blake',
            reason: 'Global Admin — owns access provisioning, GCP/Entra/M365 permissions, and onboarding',
          },
          {
            keywords: ['teams channel', 'teams', 'm365', 'calendar', 'sharepoint', 'email config', 'channel', 'membership'],
            role: 'm365-admin',
            name: 'Riley Morgan',
            reason: 'M365 Admin — owns Teams channels, calendars, SharePoint, and M365 platform operations',
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
          return {
            success: true,
            data: {
              matches: matches.map((m) => ({
                agent: m.name,
                role: m.role,
                why: m.reason,
                how_to_reach: `Use send_agent_message with to_agent="${m.role}"`,
              })),
            },
          };
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
