/**
 * UI/UX Designer (Leo Vargas) — Tools
 * Reports to Mia Tanaka (VP Design). Component specs and design system work.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';

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
        const supabase = memory.getSupabaseClient();
        await supabase.from('design_artifacts').insert({
          type: 'component_spec',
          name: params.componentName,
          content: params.spec,
          variant: params.variant || null,
          author: 'ui-ux-designer',
          status: 'draft',
          created_at: new Date().toISOString(),
        });
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
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('design_artifacts').select('*').eq('type', 'design_token').order('created_at', { ascending: false });
        if (params.category !== 'all') { query = query.eq('variant', params.category); }
        const { data } = await query.limit(50);
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
          agent_role: 'ui-ux-designer',
          activity_type: 'design',
          summary: params.summary,
          details: params.details || null,
          created_at: new Date().toISOString(),
        });
        return { success: true };
      },
    },
  ];
}
