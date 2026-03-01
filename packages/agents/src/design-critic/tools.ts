/**
 * Design Critic (Sofia Marchetti) — Tools
 * Reports to Mia Tanaka (VP Design). Quality grading, anti-pattern detection.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';

const GRADE_ORDER = ['A+', 'A', 'B+', 'B', 'C', 'D', 'F'];

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
        const grade = String(params.grade);
        await systemQuery(
          'INSERT INTO design_artifacts (type, name, content, variant, author, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          ['build_grade', params.buildId, params.feedback, grade, 'design-critic', grade.startsWith('A') ? 'approved' : 'needs_revision', new Date().toISOString()]
        );
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
        const conditions = ['type = $1'];
        const sqlParams: unknown[] = ['build_grade'];
        let idx = 2;

        // Apply time period filter
        if (params.period && params.period !== 'all') {
          const days = parseInt(String(params.period)) || 7;
          const since = new Date(Date.now() - days * 86400_000).toISOString();
          conditions.push(`created_at >= $${idx++}`);
          sqlParams.push(since);
        }

        const data = await systemQuery(
          `SELECT * FROM design_artifacts WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${idx}`,
          [...sqlParams, 50]
        );
        let results = data;

        // Apply minimum grade filter
        if (params.minGrade) {
          const minIdx = GRADE_ORDER.indexOf(String(params.minGrade));
          if (minIdx >= 0) {
            results = results.filter((r: Record<string, unknown>) => {
              const idx = GRADE_ORDER.indexOf(String(r.variant));
              return idx >= 0 && idx <= minIdx;
            });
          }
        }

        return { success: true, data: results };
      },
    },

    /* ─── Lighthouse ─── */
    {
      name: 'run_lighthouse',
      description: 'Run a Lighthouse audit on a live URL to verify design quality with real performance and accessibility data.',
      parameters: {
        url: { type: 'string', description: 'Full URL to audit', required: true },
        strategy: { type: 'string', description: '"mobile" or "desktop" (default: desktop)' },
      },
      async execute(params): Promise<ToolResult> {
        const url = encodeURIComponent(params.url as string);
        const strategy = (params.strategy as string) || 'desktop';
        const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${url}&strategy=${strategy}&category=performance&category=accessibility&category=best-practices&category=seo`;
        try {
          const res = await fetch(apiUrl, { signal: AbortSignal.timeout(30_000) });
          if (!res.ok) return { success: false, error: `PageSpeed API returned ${res.status}` };
          const json = await res.json() as Record<string, unknown>;
          const cats = (json.lighthouseResult as Record<string, unknown>)?.categories as Record<string, { score: number; title: string }> | undefined;
          const audits = (json.lighthouseResult as Record<string, unknown>)?.audits as Record<string, { score: number | null; title: string; displayValue?: string }> | undefined;
          if (!cats) return { success: false, error: 'Unexpected PageSpeed response format' };
          const scores = Object.fromEntries(Object.entries(cats).map(([, v]) => [v.title, Math.round(v.score * 100)]));
          const opportunities = audits
            ? Object.values(audits)
                .filter((a) => a.score !== null && a.score < 0.9 && a.displayValue)
                .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
                .slice(0, 8)
                .map((a) => ({ title: a.title, score: Math.round((a.score ?? 0) * 100), detail: a.displayValue }))
            : [];
          return { success: true, data: { url: params.url, strategy, scores, opportunities, auditedAt: new Date().toISOString() } };
        } catch (err) {
          return { success: false, error: `Lighthouse audit failed: ${(err as Error).message}` };
        }
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
        await systemQuery(
          'INSERT INTO agent_activities (agent_role, activity_type, summary, details, created_at) VALUES ($1, $2, $3, $4, $5)',
          ['design-critic', 'quality_review', params.summary, params.details || null, new Date().toISOString()]
        );
        return { success: true };
      },
    },
  ];
}
