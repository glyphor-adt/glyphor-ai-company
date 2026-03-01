/**
 * UI/UX Designer (Leo Vargas) — Tools
 * Reports to Mia Tanaka (VP Design). Component specs and design system work.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createUiUxDesignerTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'save_component_spec',
      description: 'Save a component specification with design tokens and spacing values.',
      parameters: {
        componentName: { type: 'string', description: 'Component name (e.g., HeroCard, PricingTable)', required: true },
        spec: { type: 'string', description: 'Full component spec in Markdown (tokens, spacing, typography, colors)', required: true },
        variant: { type: 'string', description: 'Variant name if applicable (e.g., dark, compact)' },
      },
      async execute(params) {
        await systemQuery('INSERT INTO design_artifacts (type, name, content, variant, author, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', ['component_spec', params.componentName, params.spec, params.variant || null, 'ui-ux-designer', 'draft', new Date().toISOString()]);
        return { success: true, message: `Component spec "${params.componentName}" saved.` };
      },
    },
    {
      name: 'query_design_tokens',
      description: 'Query the current design token system (colors, spacing, typography).',
      parameters: {
        category: { type: 'string', description: 'Token category: colors, spacing, typography, shadows, all', required: true },
      },
      async execute(params) {
        const conditions = ['type=$1'];
        const values: unknown[] = ['design_token'];
        if (params.category !== 'all') { conditions.push(`variant=$${values.length + 1}`); values.push(params.category); }
        const data = await systemQuery(`SELECT * FROM design_artifacts WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 50`, values);
        return { success: true, data };
      },
    },
    {
      name: 'query_component_implementations',
      description: 'Query component implementations from Ava to verify specs were implemented correctly.',
      parameters: {
        componentName: { type: 'string', description: 'Component name filter (or "all")' },
        status: { type: 'string', description: 'Filter by status: review, approved, needs_revision' },
      },
      async execute(params) {
        const conditions = ['type=$1'];
        const values: unknown[] = ['component_implementation'];
        if (params.componentName && params.componentName !== 'all') { conditions.push(`name ILIKE $${values.length + 1}`); values.push(`%${params.componentName}%`); }
        if (params.status) { conditions.push(`status=$${values.length + 1}`); values.push(params.status); }
        const data = await systemQuery(`SELECT * FROM design_artifacts WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 20`, values);
        return { success: true, data };
      },
    },
    {
      name: 'log_activity',
      description: 'Log an activity or finding to the agent activity log.',
      parameters: {
        summary: { type: 'string', description: 'Activity summary', required: true },
        details: { type: 'string', description: 'Detailed notes' },
      },
      async execute(params) {
        await systemQuery('INSERT INTO agent_activities (agent_role, activity_type, summary, details, created_at) VALUES ($1, $2, $3, $4, $5)', ['ui-ux-designer', 'design', params.summary, params.details || null, new Date().toISOString()]);
        return { success: true };
      },
    },
  ];
}
