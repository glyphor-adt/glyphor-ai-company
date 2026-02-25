/**
 * Template Architect (Ryan Park) — Tools
 * Reports to Mia Tanaka (VP Design). Template structures, variant management, quality ceilings.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';

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
        const supabase = memory.getSupabaseClient();
        await supabase.from('design_artifacts').insert({
          type: 'template_variant',
          name: `${params.templateName}/${params.variant}`,
          content: params.constraints,
          variant: params.qualityCeiling || null,
          author: 'template-architect',
          status: 'draft',
          created_at: new Date().toISOString(),
        });
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
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('design_artifacts').select('*').eq('type', 'template_variant').order('created_at', { ascending: false });
        if (params.templateName && params.templateName !== 'all') { query = query.ilike('name', `%${params.templateName}%`); }
        if (params.status) { query = query.eq('status', params.status); }
        const { data } = await query.limit(30);
        return { success: true, data: data || [] };
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
        const supabase = memory.getSupabaseClient();
        const { data: existing } = await supabase.from('design_artifacts').select('id').eq('type', 'template_variant').eq('name', params.templateName).limit(1);
        if (!existing || existing.length === 0) {
          return { success: false, error: `Template "${params.templateName}" not found` };
        }
        await supabase.from('design_artifacts').update({ status: params.newStatus, content: `${params.reason}\n\nStatus changed to ${params.newStatus} at ${new Date().toISOString()}` }).eq('id', existing[0].id);
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
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('design_artifacts').select('*').eq('type', 'build_grade').ilike('name', `%${params.templateName}%`).order('created_at', { ascending: false }).limit(30);
        return { success: true, data: data || [] };
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
        const supabase = memory.getSupabaseClient();
        await supabase.from('agent_activities').insert({
          agent_role: 'template-architect',
          activity_type: 'template_design',
          summary: params.summary,
          details: params.details || null,
          created_at: new Date().toISOString(),
        });
        return { success: true };
      },
    },
  ];
}
