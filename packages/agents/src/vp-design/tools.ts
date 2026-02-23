/**
 * VP Design & Frontend — Tool Definitions
 *
 * Tools for: design quality auditing, Lighthouse performance audits,
 * component library management, design token governance, and output quality.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { CompanyMemoryStore } from '@glyphor/company-memory';

export function createVPDesignTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'run_lighthouse',
      description: 'Run a Lighthouse audit on any live URL using Google PageSpeed Insights. Returns performance, accessibility, best-practices, and SEO scores plus specific opportunities.',
      parameters: {
        url: {
          type: 'string',
          description: 'Full URL to audit (e.g. https://app.usefuse.ai or https://glyphor.ai)',
          required: true,
        },
        strategy: {
          type: 'string',
          description: 'Device strategy: "mobile" or "desktop" (default: desktop)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const url = encodeURIComponent(params.url as string);
        const strategy = (params.strategy as string) || 'desktop';
        const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${url}&strategy=${strategy}&category=performance&category=accessibility&category=best-practices&category=seo`;
        try {
          const res = await fetch(apiUrl, { signal: AbortSignal.timeout(30_000) });
          if (!res.ok) {
            return { success: false, error: `PageSpeed API returned ${res.status}` };
          }
          const json = await res.json() as Record<string, unknown>;
          const cats = (json.lighthouseResult as Record<string, unknown>)?.categories as Record<string, { score: number; title: string }> | undefined;
          const audits = (json.lighthouseResult as Record<string, unknown>)?.audits as Record<string, { score: number | null; title: string; description: string; displayValue?: string }> | undefined;
          if (!cats) return { success: false, error: 'Unexpected PageSpeed response format' };

          const scores = Object.fromEntries(
            Object.entries(cats).map(([k, v]) => [v.title, Math.round(v.score * 100)]),
          );

          // Pull top opportunities (audits with score < 0.9 and a displayValue)
          const opportunities = audits
            ? Object.values(audits)
                .filter((a) => a.score !== null && a.score < 0.9 && a.displayValue)
                .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
                .slice(0, 8)
                .map((a) => ({ title: a.title, score: Math.round((a.score ?? 0) * 100), detail: a.displayValue }))
            : [];

          return {
            success: true,
            data: {
              url: params.url,
              strategy,
              scores,
              opportunities,
              auditedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: `Lighthouse audit failed: ${(err as Error).message}` };
        }
      },
    },

    {
      name: 'run_lighthouse_batch',
      description: 'Run Lighthouse audits on multiple URLs and compare scores side-by-side.',
      parameters: {
        urls: {
          type: 'array',
          description: 'List of URLs to audit (max 5)',
          required: true,
          items: { type: 'string', description: 'URL' },
        },
        strategy: {
          type: 'string',
          description: '"mobile" or "desktop" (default: desktop)',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const urls = (params.urls as string[]).slice(0, 5);
        const strategy = (params.strategy as string) || 'desktop';
        const results = [];
        for (const url of urls) {
          try {
            const encoded = encodeURIComponent(url);
            const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encoded}&strategy=${strategy}&category=performance&category=accessibility&category=best-practices&category=seo`;
            const res = await fetch(apiUrl, { signal: AbortSignal.timeout(30_000) });
            if (!res.ok) { results.push({ url, error: `HTTP ${res.status}` }); continue; }
            const json = await res.json() as Record<string, unknown>;
            const cats = (json.lighthouseResult as Record<string, unknown>)?.categories as Record<string, { score: number; title: string }> | undefined;
            if (!cats) { results.push({ url, error: 'bad response' }); continue; }
            results.push({
              url,
              scores: Object.fromEntries(Object.entries(cats).map(([, v]) => [v.title, Math.round(v.score * 100)])),
            });
          } catch (err) {
            results.push({ url, error: (err as Error).message });
          }
        }
        return { success: true, data: { strategy, results, auditedAt: new Date().toISOString() } };
      },
    },


    {
      name: 'get_design_quality_summary',
      description: 'Get a summary of recent Fuse output quality: grade distribution, dimension scores, and trends.',
      parameters: {
        days: {
          type: 'number',
          description: 'Number of days to look back (default: 7)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const days = (params.days as number) || 7;
        const data = await memory.read('design.quality.latest');
        const trends = await memory.read('design.quality.trends');
        if (!data && !trends) {
          return {
            success: true,
            data: { NO_DATA: true, message: 'No design quality data exists in memory. No Fuse audit has run yet or no builds have been graded. You must report this honestly — do not invent any grades or activity.' },
          };
        }
        return {
          success: true,
          data: { period: `${days} days`, qualitySummary: data, trends },
        };
      },
    },

    {
      name: 'get_design_tokens',
      description: 'Get current design token values: typography scale, color palette, spacing scale, border/shadow system.',
      parameters: {
        category: {
          type: 'string',
          description: 'Token category to retrieve (or "all")',
          required: false,
          enum: ['typography', 'color', 'spacing', 'borders', 'shadows', 'all'],
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const category = (params.category as string) || 'all';
        const tokens = await memory.read(`design.tokens.${category === 'all' ? 'current' : category}`);
        return { success: true, data: tokens ?? { NO_DATA: true, message: `No design tokens stored for "${category}" yet. Do not invent token values.` } };
      },
    },

    {
      name: 'get_component_library',
      description: 'Get the component library: all components, their variants, and usage frequency.',
      parameters: {
        component: {
          type: 'string',
          description: 'Specific component name (or omit for full library)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const key = params.component
          ? `design.components.${params.component as string}`
          : 'design.components.registry';
        const data = await memory.read(key);
        return { success: true, data: data ?? { NO_DATA: true, message: 'No component library data stored yet. Do not invent component counts or variants.' } };
      },
    },

    {
      name: 'get_template_registry',
      description: 'Get all templates with usage data, quality grades, and completion rates.',
      parameters: {},
      execute: async (_params, _ctx): Promise<ToolResult> => {
        const data = await memory.read('design.templates.registry');
        return { success: true, data: data ?? { NO_DATA: true, message: 'No template registry exists yet. Do not invent template data.' } };
      },
    },

    {
      name: 'write_design_audit',
      description: 'Save a design quality audit report with grades and recommendations.',
      parameters: {
        report_markdown: {
          type: 'string',
          description: 'The audit report content in markdown format',
          required: true,
        },
        grade_distribution: {
          type: 'object',
          description: 'Grade counts: { "A+": n, "A": n, "B": n, "C": n, "F": n }',
          required: true,
        },
        a_plus_a_rate: {
          type: 'number',
          description: 'Percentage of builds at A+ or A grade',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const date = new Date().toISOString().split('T')[0];
        await memory.writeDocument(
          `reports/design/audit/${date}.md`,
          params.report_markdown as string,
        );
        await memory.write(
          'design.quality.latest',
          {
            date,
            gradeDistribution: params.grade_distribution,
            aPlusARate: params.a_plus_a_rate,
            report: params.report_markdown,
          },
          ctx.agentId,
        );
        return { success: true, data: { archived: true }, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'get_recent_activity',
      description: 'Get all agent and system activity from the last N hours.',
      parameters: {
        hours: {
          type: 'number',
          description: 'Number of hours to look back (default: 24)',
          required: false,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const hours = (params.hours as number) || 24;
        const activity = await memory.getRecentActivity(hours);
        return { success: true, data: activity };
      },
    },

    {
      name: 'read_company_memory',
      description: 'Read a value from company shared memory by key.',
      parameters: {
        key: {
          type: 'string',
          description: 'Memory namespace key to read (e.g., "design.tokens.current", "design.quality.trends")',
          required: true,
        },
      },
      execute: async (params, _ctx): Promise<ToolResult> => {
        const value = await memory.read(params.key as string);
        return { success: true, data: value };
      },
    },

    {
      name: 'log_activity',
      description: 'Log a design activity to the company activity feed.',
      parameters: {
        action: {
          type: 'string',
          description: 'Action type',
          required: true,
          enum: ['analysis', 'alert', 'content'],
        },
        summary: {
          type: 'string',
          description: 'Short summary of the activity',
          required: true,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        await memory.appendActivity({
          agentRole: ctx.agentRole,
          action: params.action as 'analysis' | 'alert' | 'content',
          product: 'company',
          summary: params.summary as string,
          createdAt: new Date().toISOString(),
        });
        return { success: true, memoryKeysWritten: 1 };
      },
    },

    {
      name: 'create_decision',
      description: 'Create a decision that requires founder approval (e.g., design token change, component library update).',
      parameters: {
        tier: {
          type: 'string',
          description: 'Decision tier',
          required: true,
          enum: ['yellow', 'red'],
        },
        title: {
          type: 'string',
          description: 'Short decision title',
          required: true,
        },
        summary: {
          type: 'string',
          description: 'Decision context and recommendation',
          required: true,
        },
        reasoning: {
          type: 'string',
          description: 'Design justification with evidence',
          required: true,
        },
        assigned_to: {
          type: 'array',
          description: 'Founders to assign',
          required: true,
          items: { type: 'string', description: 'Founder name' },
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const id = await memory.createDecision({
          tier: params.tier as 'yellow' | 'red',
          status: 'pending',
          title: params.title as string,
          summary: params.summary as string,
          proposedBy: ctx.agentRole,
          reasoning: params.reasoning as string,
          assignedTo: params.assigned_to as string[],
        });
        return { success: true, data: { decisionId: id }, memoryKeysWritten: 1 };
      },
    },
  ];
}
