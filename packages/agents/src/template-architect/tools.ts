/**
 * Template Architect (Ryan Park) — Tools
 * Reports to Mia Tanaka (VP Design). Template structures, variant management, quality ceilings.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

export function createTemplateArchitectTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'save_template_variant',
      description: 'Save a template variant definition with constraints and quality ceiling.',
      parameters: {
        templateName: { type: 'string', description: 'Template name (e.g., SaaS-Landing, Portfolio)', required: true },
        variant: { type: 'string', description: 'Variant name (e.g., minimal, bold, corporate)', required: true },
        constraints: { type: 'string', description: 'Constraint rules in Markdown (max sections, color limits, etc.)', required: true },
        qualityCeiling: { type: 'string', description: 'Expected quality ceiling grade (A+, A, B+, etc.)' },
      },
      async execute(params) {
        await systemQuery('INSERT INTO design_artifacts (type, name, content, variant, author, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', ['template_variant', `${params.templateName}/${params.variant}`, params.constraints, params.qualityCeiling || null, 'template-architect', 'draft', new Date().toISOString()]);
        return { success: true, message: `Template "${params.templateName}/${params.variant}" saved.` };
      },
    },
    {
      name: 'query_template_variants',
      description: 'Query existing template variants and their quality scores.',
      parameters: {
        templateName: { type: 'string', description: 'Template name filter (or "all")' },
        status: { type: 'string', description: 'Filter by status: draft, active, deprecated' },
      },
      async execute(params) {
        const conditions = ['type=$1'];
        const values: unknown[] = ['template_variant'];
        if (params.templateName && params.templateName !== 'all') { conditions.push(`name ILIKE $${values.length + 1}`); values.push(`%${params.templateName}%`); }
        if (params.status) { conditions.push(`status=$${values.length + 1}`); values.push(params.status); }
        const data = await systemQuery(`SELECT * FROM design_artifacts WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 30`, values);
        return { success: true, data };
      },
    },
    {
      name: 'update_template_status',
      description: 'Update the status of a template variant (activate, deprecate, or revert to draft).',
      parameters: {
        templateName: { type: 'string', description: 'Full template name (e.g., "SaaS-Landing/minimal")', required: true },
        newStatus: { type: 'string', description: 'New status: draft, active, deprecated', required: true },
        reason: { type: 'string', description: 'Reason for the status change', required: true },
      },
      async execute(params) {
        const existing = await systemQuery('SELECT id FROM design_artifacts WHERE type=$1 AND name=$2 LIMIT 1', ['template_variant', params.templateName]);
        if (existing.length === 0) {
          return { success: false, error: `Template "${params.templateName}" not found` };
        }
        await systemQuery('UPDATE design_artifacts SET status=$1, content=$2 WHERE id=$3', [params.newStatus, `${params.reason}\n\nStatus changed to ${params.newStatus} at ${new Date().toISOString()}`, existing[0].id]);
        return { success: true, message: `Template "${params.templateName}" status updated to ${params.newStatus}` };
      },
    },
    {
      name: 'query_build_grades_by_template',
      description: 'Query build grades filtered by template to assess template quality ceiling performance.',
      parameters: {
        templateName: { type: 'string', description: 'Template name to filter grades for', required: true },
      },
      async execute(params) {
        const data = await systemQuery('SELECT * FROM design_artifacts WHERE type=$1 AND name ILIKE $2 ORDER BY created_at DESC LIMIT 30', ['build_grade', `%${params.templateName}%`]);
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
        await systemQuery('INSERT INTO agent_activities (agent_role, activity_type, summary, details, created_at) VALUES ($1, $2, $3, $4, $5)', ['template-architect', 'template_design', params.summary, params.details || null, new Date().toISOString()]);
        return { success: true };
      },
    },
  ];
}
