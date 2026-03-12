/**
 * Frontend Engineer (Ava Chen) — Tools
 * Reports to Mia Tanaka (VP Design). Tailwind components, accessibility, performance.
 */
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { systemQuery } from '@glyphor/shared/db';
import {
  getFileContents, createOrUpdateFile, createBranch, createGitHubPR,
  GLYPHOR_REPOS, type GlyphorRepo,
} from '@glyphor/integrations';

export function createFrontendEngineerTools(memory: CompanyMemoryStore): ToolDefinition[] {
  return [
    /* ─── Lighthouse ─── */
    {
      name: 'run_lighthouse',
      description: 'Run a Lighthouse audit on a live URL via Google PageSpeed Insights. Returns performance, accessibility, best-practices, and SEO scores.',
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

    /* ─── GitHub: read source code ─── */
    {
      name: 'get_file_contents',
      description: 'Read a file from a Glyphor GitHub repository to inspect current implementations.',
      parameters: {
        repo: { type: 'string', description: 'Repo key: company', required: true },
        path: { type: 'string', description: 'File path within the repo', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const repoName = GLYPHOR_REPOS[params.repo as GlyphorRepo];
        if (!repoName) return { success: false, error: `Unknown repo "${params.repo}". Use: company` };
        const result = await getFileContents(repoName, params.path as string);
        if (!result) return { success: false, error: `File not found: ${params.path}` };
        return { success: true, data: result };
      },
    },

    /* ─── GitHub: push component code ─── */
    {
      name: 'push_component',
      description: 'Push a component implementation to a branch in a Glyphor repo.',
      parameters: {
        repo: { type: 'string', description: 'Repo key: company', required: true },
        branch: { type: 'string', description: 'Target branch name', required: true },
        path: { type: 'string', description: 'File path for the component', required: true },
        content: { type: 'string', description: 'File content to push', required: true },
        message: { type: 'string', description: 'Commit message', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const repoName = GLYPHOR_REPOS[params.repo as GlyphorRepo];
        if (!repoName) return { success: false, error: `Unknown repo "${params.repo}"` };
        await createOrUpdateFile(repoName, params.path as string, params.content as string, params.message as string, params.branch as string);
        return { success: true, data: `Pushed ${params.path} to ${params.branch}` };
      },
    },

    /* ─── GitHub: create branch + PR ─── */
    {
      name: 'create_component_branch',
      description: 'Create a new branch for component work.',
      parameters: {
        repo: { type: 'string', description: 'Repo key: company', required: true },
        branch: { type: 'string', description: 'New branch name (e.g., feat/hero-card-component)', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const repoName = GLYPHOR_REPOS[params.repo as GlyphorRepo];
        if (!repoName) return { success: false, error: `Unknown repo "${params.repo}"` };
        await createBranch(repoName, params.branch as string);
        return { success: true, data: `Branch "${params.branch}" created` };
      },
    },
    {
      name: 'create_component_pr',
      description: 'Open a PR for a component implementation, requesting review from the design team.',
      parameters: {
        repo: { type: 'string', description: 'Repo key: company', required: true },
        branch: { type: 'string', description: 'Source branch name', required: true },
        title: { type: 'string', description: 'PR title', required: true },
        body: { type: 'string', description: 'PR description with a11y notes and Lighthouse scores', required: true },
      },
      async execute(params): Promise<ToolResult> {
        const repoName = GLYPHOR_REPOS[params.repo as GlyphorRepo];
        if (!repoName) return { success: false, error: `Unknown repo "${params.repo}"` };
        const pr = await createGitHubPR(repoName, params.branch as string, params.title as string, params.body as string);
        return { success: true, data: pr };
      },
    },

    /* ─── Design artifacts ─── */
    {
      name: 'save_component_implementation',
      description: 'Save a component implementation (Tailwind CSS / HTML) for review.',
      parameters: {
        componentName: { type: 'string', description: 'Component name matching the spec', required: true },
        code: { type: 'string', description: 'Component code (HTML + Tailwind classes)', required: true },
        a11yNotes: { type: 'string', description: 'Accessibility notes (ARIA labels, keyboard nav)' },
      },
      async execute(params) {
        await systemQuery(
          'INSERT INTO design_artifacts (type, name, content, variant, author, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          ['component_implementation', params.componentName, params.code, params.a11yNotes || null, 'frontend-engineer', 'review', new Date().toISOString()]
        );
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
        const conditions = ['type = $1'];
        const sqlParams: unknown[] = ['component_spec'];
        let idx = 2;
        if (params.componentName && params.componentName !== 'all') { conditions.push(`name ILIKE $${idx++}`); sqlParams.push(`%${params.componentName}%`); }
        if (params.status) { conditions.push(`status = $${idx++}`); sqlParams.push(params.status); }
        const data = await systemQuery(
          `SELECT * FROM design_artifacts WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${idx}`,
          [...sqlParams, 20]
        );
        return { success: true, data };
      },
    },
    {
      name: 'query_my_implementations',
      description: 'Query your own saved component implementations. Use this to review past work and check statuses.',
      parameters: {
        componentName: { type: 'string', description: 'Component name filter (or "all")' },
        status: { type: 'string', description: 'Filter by status: review, approved, needs_revision' },
      },
      async execute(params) {
        const conditions = ['type = $1', 'author = $2'];
        const sqlParams: unknown[] = ['component_implementation', 'frontend-engineer'];
        let idx = 3;
        if (params.componentName && params.componentName !== 'all') { conditions.push(`name ILIKE $${idx++}`); sqlParams.push(`%${params.componentName}%`); }
        if (params.status) { conditions.push(`status = $${idx++}`); sqlParams.push(params.status); }
        const data = await systemQuery(
          `SELECT * FROM design_artifacts WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${idx}`,
          [...sqlParams, 20]
        );
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
        await systemQuery(
          'INSERT INTO agent_activities (agent_role, activity_type, summary, details, created_at) VALUES ($1, $2, $3, $4, $5)',
          ['frontend-engineer', 'implementation', params.summary, params.details || null, new Date().toISOString()]
        );
        return { success: true };
      },
    },
  ];
}
