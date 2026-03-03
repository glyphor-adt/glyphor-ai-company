/**
 * Audit Tools — Quality auditing for design team
 *
 * Tools:
 *   run_lighthouse_audit       — Lighthouse via PageSpeed Insights
 *   run_accessibility_audit    — Accessibility check via axe-core
 *   check_ai_smell             — Detect AI-generated design patterns
 *   validate_brand_compliance  — Check against Prism brand guidelines
 *   check_bundle_size          — Analyze frontend bundle
 *   check_build_errors         — Check TypeScript/ESLint CI results
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { getGitHubClient, GLYPHOR_REPOS, type GlyphorRepo } from '@glyphor/integrations';

const ALL_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;

const AI_SMELL_PATTERNS = [
  { pattern: /lorem ipsum/i, label: 'Lorem ipsum placeholder text' },
  { pattern: /welcome to (?:our|the|my|your)/i, label: 'Generic "Welcome to" heading' },
  { pattern: /your content here/i, label: '"Your Content Here" placeholder' },
  { pattern: /click here to learn more/i, label: 'Generic CTA text' },
  { pattern: /placeholder/i, label: 'Placeholder reference' },
  { pattern: /sample text/i, label: 'Sample text placeholder' },
  { pattern: /https?:\/\/(?:via\.placeholder|placekitten|placehold\.it|picsum\.photos)/i, label: 'Stock/placeholder image URL' },
  { pattern: /unsplash\.com\/photos/i, label: 'Unsplash stock photo' },
];

/** Known Prism brand tokens for compliance checking */
const BRAND_TOKENS = {
  colors: {
    primary: '#00E0FF',
    secondary: '#623CEA',
    background: '#1A1A2E',
    text: '#E0E0E0',
    success: '#00C853',
    warning: '#FFB300',
    error: '#FF1744',
    info: '#2979FF',
  },
  fonts: ['Segoe UI', 'Cascadia Code'],
};

function getScreenshotServiceUrl(): string {
  const url = process.env.SCREENSHOT_SERVICE_URL;
  if (!url) throw new Error('SCREENSHOT_SERVICE_URL not configured');
  return url;
}

function resolveRepo(repo?: string): { repoKey: GlyphorRepo; repoName: string } | null {
  const key = (repo || 'company') as GlyphorRepo;
  const name = GLYPHOR_REPOS[key];
  if (!name) return null;
  return { repoKey: key, repoName: name };
}

export function createAuditTools(): ToolDefinition[] {
  return [
    // ── 1. run_lighthouse_audit ──────────────────────────────────────────
    {
      name: 'run_lighthouse_audit',
      description:
        'Run a Lighthouse audit on a live URL via Google PageSpeed Insights API. ' +
        'Returns scores and top issues per category (performance, accessibility, best-practices, seo).',
      parameters: {
        url: {
          type: 'string',
          description: 'Full URL to audit (e.g., https://example.com)',
          required: true,
        },
        strategy: {
          type: 'string',
          description: 'Device strategy: "mobile" or "desktop" (default: desktop)',
          enum: ['mobile', 'desktop'],
        },
        categories: {
          type: 'array',
          description: 'Categories to audit (default: all). Options: performance, accessibility, best-practices, seo',
          items: { type: 'string', description: 'A Lighthouse category' },
        },
      },
      async execute(params): Promise<ToolResult> {
        const rawUrl = params.url as string;
        const strategy = (params.strategy as string) || 'desktop';
        const categories = (params.categories as string[]) || [...ALL_CATEGORIES];

        try {
          const encodedUrl = encodeURIComponent(rawUrl);
          const categoryParams = categories.map((c) => `category=${c}`).join('&');
          const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodedUrl}&strategy=${strategy}&${categoryParams}`;

          const res = await fetch(apiUrl, { signal: AbortSignal.timeout(30_000) });
          if (!res.ok) return { success: false, error: `PageSpeed API returned ${res.status}` };

          const json = (await res.json()) as Record<string, unknown>;
          const lhr = json.lighthouseResult as Record<string, unknown> | undefined;
          if (!lhr) return { success: false, error: 'Unexpected PageSpeed response format' };

          const cats = lhr.categories as Record<string, { score: number; title: string }> | undefined;
          const audits = lhr.audits as Record<string, { score: number | null; title: string; displayValue?: string; description?: string }> | undefined;
          if (!cats) return { success: false, error: 'No categories in Lighthouse result' };

          const scores = Object.fromEntries(
            Object.entries(cats).map(([, v]) => [v.title, Math.round(v.score * 100)]),
          );

          // Top 5 issues per category
          const issuesByCategory: Record<string, { title: string; score: number; detail?: string }[]> = {};
          if (audits) {
            for (const category of categories) {
              const catAudits = Object.values(audits)
                .filter((a) => a.score !== null && a.score < 0.9 && a.displayValue)
                .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
                .slice(0, 5)
                .map((a) => ({
                  title: a.title,
                  score: Math.round((a.score ?? 0) * 100),
                  detail: a.displayValue,
                }));
              if (catAudits.length > 0) issuesByCategory[category] = catAudits;
            }
          }

          return {
            success: true,
            data: {
              url: rawUrl,
              strategy,
              scores,
              issuesByCategory,
              auditedAt: new Date().toISOString(),
            },
          };
        } catch (err) {
          return { success: false, error: `Lighthouse audit failed: ${(err as Error).message}` };
        }
      },
    },

    // ── 2. run_accessibility_audit ────────────────────────────────────────
    {
      name: 'run_accessibility_audit',
      description:
        'Check accessibility of a URL via the screenshot service (axe-core). ' +
        'Returns violations grouped by severity with affected elements and WCAG criteria.',
      parameters: {
        url: {
          type: 'string',
          description: 'Full URL to audit for accessibility',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const url = params.url as string;

        try {
          const serviceUrl = getScreenshotServiceUrl();
          const res = await fetch(`${serviceUrl}/audit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, type: 'accessibility' }),
            signal: AbortSignal.timeout(30_000),
          });

          if (!res.ok) {
            return { success: false, error: `Accessibility audit service returned ${res.status}` };
          }

          const result = (await res.json()) as {
            violations?: {
              id: string;
              impact: string;
              description: string;
              helpUrl: string;
              tags: string[];
              nodes: { html: string; target: string[] }[];
            }[];
          };

          const violations = result.violations || [];
          const bySeverity: Record<string, typeof violations> = {
            critical: [],
            serious: [],
            moderate: [],
            minor: [],
          };

          for (const v of violations) {
            const severity = v.impact || 'minor';
            if (bySeverity[severity]) bySeverity[severity].push(v);
          }

          const summary = Object.fromEntries(
            Object.entries(bySeverity).map(([severity, items]) => [
              severity,
              items.map((v) => ({
                rule: v.id,
                description: v.description,
                wcag: v.tags.filter((t) => t.startsWith('wcag')),
                affectedElements: v.nodes.slice(0, 5).map((n) => ({
                  html: n.html.slice(0, 200),
                  selector: n.target.join(' > '),
                })),
                helpUrl: v.helpUrl,
              })),
            ]),
          );

          return {
            success: true,
            data: {
              url,
              totalViolations: violations.length,
              bySeverity: {
                critical: bySeverity.critical.length,
                serious: bySeverity.serious.length,
                moderate: bySeverity.moderate.length,
                minor: bySeverity.minor.length,
              },
              violations: summary,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Accessibility audit failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ── 3. check_ai_smell ────────────────────────────────────────────────
    {
      name: 'check_ai_smell',
      description:
        'Analyze a page for AI-generated design signals: generic placeholder text, ' +
        'inconsistent spacing, default styling, stock photo patterns. Returns a smell score (0-100) ' +
        'and specific instances found.',
      parameters: {
        url: {
          type: 'string',
          description: 'Full URL to analyze for AI-generated design patterns',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const url = params.url as string;
        let html = '';
        let source: 'screenshot_service' | 'direct_fetch' = 'screenshot_service';

        try {
          // Try screenshot service first for HTML + screenshot
          try {
            const serviceUrl = getScreenshotServiceUrl();
            const res = await fetch(`${serviceUrl}/screenshot`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url, fullPage: true }),
              signal: AbortSignal.timeout(30_000),
            });
            if (res.ok) {
              const data = (await res.json()) as { html?: string };
              html = data.html || '';
            }
          } catch {
            // Screenshot service unavailable — fall back to direct fetch
          }

          // Fallback: fetch page HTML directly
          if (!html) {
            source = 'direct_fetch';
            const res = await fetch(url, {
              signal: AbortSignal.timeout(30_000),
              headers: {
                'User-Agent': 'Glyphor-Audit-Agent/1.0',
                Accept: 'text/html',
              },
            });
            if (!res.ok) {
              return { success: false, error: `Failed to fetch page: HTTP ${res.status}` };
            }
            html = await res.text();
          }

          // Analyze for AI smell patterns
          const instances: { pattern: string; matches: string[] }[] = [];
          let totalMatches = 0;

          for (const { pattern, label } of AI_SMELL_PATTERNS) {
            const matches = html.match(new RegExp(pattern.source, pattern.flags + 'g')) || [];
            if (matches.length > 0) {
              instances.push({ pattern: label, matches: matches.slice(0, 3) });
              totalMatches += matches.length;
            }
          }

          // Check for spacing inconsistencies (multiple different margin/padding values)
          const spacingValues = html.match(/(?:margin|padding):\s*[\d.]+(?:px|rem|em)/gi) || [];
          const uniqueSpacing = new Set(spacingValues.map((s) => s.toLowerCase()));
          const spacingInconsistency = uniqueSpacing.size > 10;
          if (spacingInconsistency) {
            instances.push({
              pattern: 'Inconsistent spacing (many unique margin/padding values)',
              matches: [`${uniqueSpacing.size} unique spacing values found`],
            });
            totalMatches += 2;
          }

          // Check for default styling patterns (e.g., inline styles with common defaults)
          const defaultBorders = (html.match(/border:\s*1px solid #(?:ccc|ddd|eee|000)/gi) || []).length;
          if (defaultBorders > 3) {
            instances.push({
              pattern: 'Default border styling patterns',
              matches: [`${defaultBorders} default border declarations`],
            });
            totalMatches += defaultBorders;
          }

          // Score: 0 = clean, 100 = heavily AI-generated
          const smellScore = Math.min(100, totalMatches * 8);

          return {
            success: true,
            data: {
              url,
              source,
              smellScore,
              rating:
                smellScore <= 10 ? 'clean' :
                smellScore <= 30 ? 'minor concerns' :
                smellScore <= 60 ? 'significant signals' :
                'heavily AI-generated',
              totalInstances: totalMatches,
              instances,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `AI smell check failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ── 4. validate_brand_compliance ──────────────────────────────────────
    {
      name: 'validate_brand_compliance',
      description:
        'Check a page against Prism brand guidelines. Screenshots the page and compares colors ' +
        'against the known brand palette. Returns a compliance score and specific violations.',
      parameters: {
        url: {
          type: 'string',
          description: 'Full URL to check against brand guidelines',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const url = params.url as string;

        try {
          // Capture page via screenshot service
          const serviceUrl = getScreenshotServiceUrl();
          const res = await fetch(`${serviceUrl}/screenshot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, fullPage: true }),
            signal: AbortSignal.timeout(30_000),
          });

          if (!res.ok) {
            return { success: false, error: `Screenshot service returned ${res.status}` };
          }

          const data = (await res.json()) as { html?: string; colors?: string[] };
          const html = data.html || '';
          const pageColors = data.colors || [];

          // Extract colors from inline styles and CSS
          const colorMatches = html.match(/#[0-9A-Fa-f]{3,8}\b/g) || [];
          const allColors = [...new Set([...pageColors, ...colorMatches].map((c) => c.toUpperCase()))];

          // Compare against brand palette
          const brandHexes = new Set(
            Object.values(BRAND_TOKENS.colors).map((c) => c.toUpperCase()),
          );
          const onBrand = allColors.filter((c) => brandHexes.has(c));
          const offBrand = allColors.filter((c) => !brandHexes.has(c));

          // Check font usage
          const fontMatches = html.match(/font-family:\s*([^;}"]+)/gi) || [];
          const fontsUsed = fontMatches.map((f) => f.replace(/font-family:\s*/i, '').trim());
          const offBrandFonts = fontsUsed.filter(
            (f) => !BRAND_TOKENS.fonts.some((bf) => f.toLowerCase().includes(bf.toLowerCase())),
          );

          const violations: string[] = [];
          if (offBrand.length > 0) {
            violations.push(`${offBrand.length} off-brand colors detected: ${offBrand.slice(0, 5).join(', ')}`);
          }
          if (offBrandFonts.length > 0) {
            violations.push(`Off-brand fonts detected: ${[...new Set(offBrandFonts)].slice(0, 3).join(', ')}`);
          }

          const totalChecks = allColors.length + fontsUsed.length;
          const passingChecks = onBrand.length + (fontsUsed.length - offBrandFonts.length);
          const complianceScore = totalChecks > 0 ? Math.round((passingChecks / totalChecks) * 100) : 100;

          return {
            success: true,
            data: {
              url,
              complianceScore,
              brandPalette: BRAND_TOKENS.colors,
              colorsFound: allColors.length,
              onBrandColors: onBrand.length,
              offBrandColors: offBrand.slice(0, 10),
              fontsUsed: [...new Set(fontsUsed)],
              offBrandFonts: [...new Set(offBrandFonts)],
              violations,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Brand compliance check failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ── 5. check_bundle_size ─────────────────────────────────────────────
    {
      name: 'check_bundle_size',
      description:
        'Analyze frontend build output and bundle size. Reads build stats or package.json ' +
        'dependencies from GitHub. Returns total size estimate and largest dependencies.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repository key: "company", "fuse", or "pulse" (default: company)',
          enum: ['company', 'fuse', 'pulse'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const resolved = resolveRepo(params.repo as string | undefined);
        if (!resolved) {
          return { success: false, error: `Unknown repo "${params.repo}". Use: company, fuse, or pulse.` };
        }
        const { repoName } = resolved;
        const gh = getGitHubClient();
        const owner = 'glyphor-adt';

        try {
          // Try to read build stats file (webpack stats, next build output)
          const statsFiles = [
            '.next/build-manifest.json',
            'dist/stats.json',
            '.next/package.json',
            'build/asset-manifest.json',
          ];

          let statsData: Record<string, unknown> | null = null;
          let statsPath = '';

          for (const path of statsFiles) {
            try {
              const { data } = await gh.repos.getContent({ owner, repo: repoName, path });
              if ('content' in data && typeof data.content === 'string') {
                statsData = JSON.parse(Buffer.from(data.content, 'base64').toString()) as Record<string, unknown>;
                statsPath = path;
                break;
              }
            } catch {
              // File doesn't exist — try next
            }
          }

          // Read package.json for dependency analysis
          let dependencies: Record<string, string> = {};
          let devDependencies: Record<string, string> = {};
          try {
            const { data } = await gh.repos.getContent({ owner, repo: repoName, path: 'package.json' });
            if ('content' in data && typeof data.content === 'string') {
              const pkg = JSON.parse(Buffer.from(data.content, 'base64').toString()) as Record<string, unknown>;
              dependencies = (pkg.dependencies as Record<string, string>) || {};
              devDependencies = (pkg.devDependencies as Record<string, string>) || {};
            }
          } catch {
            return { success: false, error: 'Could not read package.json from repository' };
          }

          // Known heavy dependencies and estimated sizes (KB, gzipped)
          const heavyDeps: Record<string, number> = {
            react: 45, 'react-dom': 130, next: 90, '@mui/material': 300,
            '@chakra-ui/react': 200, lodash: 70, moment: 65, 'date-fns': 30,
            axios: 15, d3: 250, 'three': 600, 'chart.js': 70,
            '@tanstack/react-query': 40, framer: 150, 'framer-motion': 110,
          };

          const depAnalysis = Object.keys(dependencies)
            .map((dep) => ({
              name: dep,
              version: dependencies[dep],
              estimatedSizeKB: heavyDeps[dep] || null,
            }))
            .sort((a, b) => (b.estimatedSizeKB || 0) - (a.estimatedSizeKB || 0));

          const estimatedTotal = depAnalysis.reduce((sum, d) => sum + (d.estimatedSizeKB || 5), 0);

          return {
            success: true,
            data: {
              repo: repoName,
              buildStatsAvailable: !!statsData,
              buildStatsPath: statsPath || null,
              buildStats: statsData,
              dependencyCount: Object.keys(dependencies).length,
              devDependencyCount: Object.keys(devDependencies).length,
              estimatedBundleSizeKB: estimatedTotal,
              largestDependencies: depAnalysis.filter((d) => d.estimatedSizeKB).slice(0, 10),
              allDependencies: depAnalysis,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Bundle size check failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },

    // ── 6. check_build_errors ────────────────────────────────────────────
    {
      name: 'check_build_errors',
      description:
        'Check TypeScript/ESLint CI results by reading the latest GitHub Actions build run. ' +
        'Returns pass/fail status, error count, and error details if available.',
      parameters: {
        repo: {
          type: 'string',
          description: 'Repository key: "company", "fuse", or "pulse" (default: company)',
          enum: ['company', 'fuse', 'pulse'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const resolved = resolveRepo(params.repo as string | undefined);
        if (!resolved) {
          return { success: false, error: `Unknown repo "${params.repo}". Use: company, fuse, or pulse.` };
        }
        const { repoName } = resolved;
        const gh = getGitHubClient();
        const owner = 'glyphor-adt';

        try {
          // Find latest build run
          const { data: runsData } = await gh.actions.listWorkflowRunsForRepo({
            owner,
            repo: repoName,
            per_page: 5,
          });

          const runs = runsData.workflow_runs;
          if (runs.length === 0) {
            return { success: true, data: { repo: repoName, message: 'No workflow runs found' } };
          }

          const latestRun = runs[0];

          // Get jobs for the latest run
          const { data: jobsData } = await gh.actions.listJobsForWorkflowRun({
            owner,
            repo: repoName,
            run_id: latestRun.id,
          });

          const jobs = jobsData.jobs.map((job) => ({
            name: job.name,
            status: job.status,
            conclusion: job.conclusion,
            startedAt: job.started_at,
            completedAt: job.completed_at,
            steps: job.steps?.map((s) => ({
              name: s.name,
              status: s.status,
              conclusion: s.conclusion,
            })),
          }));

          const failedJobs = jobs.filter((j) => j.conclusion === 'failure');
          const passed = failedJobs.length === 0 && latestRun.conclusion !== 'failure';

          return {
            success: true,
            data: {
              repo: repoName,
              passed,
              runId: latestRun.id,
              runName: latestRun.name ?? 'unknown',
              runStatus: latestRun.status,
              runConclusion: latestRun.conclusion,
              branch: latestRun.head_branch,
              commitSha: latestRun.head_sha?.slice(0, 7),
              commitMessage: latestRun.head_commit?.message?.split('\n')[0] ?? '',
              runUrl: latestRun.html_url,
              totalJobs: jobs.length,
              failedJobCount: failedJobs.length,
              jobs,
              failedJobs: failedJobs.length > 0 ? failedJobs : undefined,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: `Build error check failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    },
  ];
}
