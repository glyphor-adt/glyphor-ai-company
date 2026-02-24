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
