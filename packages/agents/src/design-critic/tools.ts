/**
 * Design Critic (Sofia Marchetti) — Tools
 * Reports to Mia Tanaka (VP Design). Quality grading, anti-pattern detection.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition } from '@glyphor/agent-runtime';

export function createDesignCriticTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    {
      name: 'grade_build',
      description: 'Grade a Fuse build on the quality rubric (A+ to F). Stores the grade and feedback.',
      parameters: {
        buildId: { type: 'string', description: 'Build or template identifier', required: true },
        grade: { type: 'string', description: 'Letter grade: A+, A, B+, B, C, D, F', required: true },
        feedback: { type: 'string', description: 'Detailed critique with specific issues and fix recommendations', required: true },
        antiPatterns: { type: 'string', description: 'Comma-separated list of anti-patterns detected' },
      },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const grade = String(params.grade);
        await supabase.from('design_artifacts').insert({
          type: 'build_grade',
          name: params.buildId,
          content: params.feedback,
          variant: grade,
          author: 'design-critic',
          status: grade.startsWith('A') ? 'approved' : 'needs_revision',
          created_at: new Date().toISOString(),
        });
        return { success: true, message: `Build "${params.buildId}" graded: ${params.grade}` };
      },
    },
    {
      name: 'query_build_grades',
      description: 'Query past build grades and quality trends.',
      parameters: {
        period: { type: 'string', description: 'Time period: 7d, 30d, 90d, all' },
        minGrade: { type: 'string', description: 'Minimum grade to show (e.g., "B" shows B and above)' },
      },
      async execute(params) {
        const supabase = memory.getSupabaseClient();
        const { data } = await supabase.from('design_artifacts').select('*').eq('type', 'build_grade').order('created_at', { ascending: false }).limit(50);
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
          agent_role: 'design-critic',
          activity_type: 'quality_review',
          summary: params.summary,
          details: params.details || null,
          created_at: new Date().toISOString(),
        });
        return { success: true };
      },
    },
  ];
}
