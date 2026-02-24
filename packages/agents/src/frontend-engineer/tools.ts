/**
 * Frontend Engineer (Ava Chen) — Tools
 * Reports to Mia Tanaka (VP Design). Tailwind components, accessibility, performance.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';

export function createFrontendEngineerTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'save_component_implementation',
      description: 'Save a component implementation (Tailwind CSS / HTML) for review.',
      parameters: {
        componentName: { type: 'string', description: 'Component name matching the spec', required: true },
        code: { type: 'string', description: 'Component code (HTML + Tailwind classes)', required: true },
        a11yNotes: { type: 'string', description: 'Accessibility notes (ARIA labels, keyboard nav)' },
      },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        await supabase.from('design_artifacts').insert({
          type: 'component_implementation',
          name: params.componentName,
          content: params.code,
          variant: params.a11yNotes || null,
          author: 'frontend-engineer',
          status: 'review',
          created_at: new Date().toISOString(),
        });
        return { success: true, message: `Implementation for "${params.componentName}" saved for review.` };
      },
    },
    {
      name: 'query_component_specs',
      description: 'Query component specs from the design system to implement.',
      parameters: {
        componentName: { type: 'string', description: 'Component name to look up (or "all" for listing)' },
        status: { type: 'string', description: 'Filter by status: draft, approved, implemented' },
      },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        let query = supabase.from('design_artifacts').select('*').eq('type', 'component_spec').order('created_at', { ascending: false });
        if (params.componentName && params.componentName !== 'all') { query = query.ilike('name', `%${params.componentName}%`); }
        if (params.status) { query = query.eq('status', params.status); }
        const { data } = await query.limit(20);
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
          agent_role: 'frontend-engineer',
          activity_type: 'implementation',
          summary: params.summary,
          details: params.details || null,
          created_at: new Date().toISOString(),
        });
        return { success: true };
      },
    },
  ];
}
