/**
 * Storybook Tools — Component development and visual testing
 *
 * Tools:
 *   storybook_list_stories      — List all stories from index
 *   storybook_screenshot        — Screenshot specific story
 *   storybook_screenshot_all    — Screenshot all stories at all viewports
 *   storybook_visual_diff       — Compare against approved baselines
 *   storybook_save_baseline     — Save current as approved baseline
 *   storybook_check_coverage    — Component vs story coverage analysis
 *   storybook_get_story_source  — Read story file source code
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { getFileContents, GLYPHOR_REPOS } from '@glyphor/integrations';
import { getPlaywrightServiceUrl } from './playwrightServiceUrl.js';

interface StoryEntry {
  id: string;
  title: string;
  name: string;
  importPath: string;
  tags?: string[];
}

function getStorybookUrl(): string {
  const url = process.env.STORYBOOK_URL;
  if (!url) throw new Error('STORYBOOK_URL not configured — deploy Storybook as a static site first');
  return url;
}

async function fetchStoryIndex(storybookUrl: string): Promise<StoryEntry[]> {
  let res = await fetch(`${storybookUrl}/index.json`, { signal: AbortSignal.timeout(15_000) });

  if (!res.ok) {
    // Fall back to /stories.json for older Storybook versions
    res = await fetch(`${storybookUrl}/stories.json`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(`Failed to fetch story index: HTTP ${res.status}`);
    }
  }

  const json = (await res.json()) as Record<string, unknown>;
  const entries = (json.entries ?? json.stories ?? {}) as Record<string, StoryEntry>;
  return Object.values(entries).map((entry) => ({
    id: entry.id,
    title: entry.title,
    name: entry.name,
    importPath: entry.importPath,
    tags: entry.tags,
  }));
}

export function createStorybookTools(): ToolDefinition[] {
  return [
    // ── storybook_list_stories ─────────────────────────────────────────
    {
      name: 'storybook_list_stories',
      description: 'Parse the Storybook index to list all available stories.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        try {
          const storybookUrl = getStorybookUrl();
          const stories = await fetchStoryIndex(storybookUrl);

          return {
            success: true,
            data: { total: stories.length, stories },
          };
        } catch (err) {
          return { success: false, error: `storybook_list_stories failed: ${(err as Error).message}` };
        }
      },
    },

    // ── storybook_screenshot ───────────────────────────────────────────
    {
      name: 'storybook_screenshot',
      description: 'Capture a screenshot of a specific Storybook story.',
      parameters: {
        story_id: { type: 'string', description: 'Story ID (e.g. "button--primary")', required: true },
        viewport_width: { type: 'number', description: 'Viewport width in pixels (default: 1440)', required: false },
        viewport_height: { type: 'number', description: 'Viewport height in pixels (default: 900)', required: false },
        theme: { type: 'string', description: 'Color theme', required: false, enum: ['light', 'dark'] },
        args: { type: 'string', description: 'JSON string of Storybook control overrides', required: false },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const storyId = params.story_id as string;
          if (!storyId) return { success: false, error: 'Parameter "story_id" is required.' };

          const storybookUrl = getStorybookUrl();
          const serviceUrl = getPlaywrightServiceUrl();
          const width = (params.viewport_width as number) || 1440;
          const height = (params.viewport_height as number) || 900;
          const theme = (params.theme as string) || 'light';
          const args = params.args as string | undefined;

          const iframeUrl =
            `${storybookUrl}/iframe.html?id=${storyId}&globals=theme:${theme}` +
            (args ? `&args=${encodeURIComponent(args)}` : '');

          const res = await fetch(`${serviceUrl}/screenshot`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: iframeUrl,
              viewport: { width, height },
              wait_for: 'networkidle',
            }),
            signal: AbortSignal.timeout(30_000),
          });

          if (!res.ok) {
            return { success: false, error: `Screenshot service returned ${res.status}: ${await res.text()}` };
          }

          const data = (await res.json()) as Record<string, unknown>;
          return {
            success: true,
            data: {
              story_id: storyId,
              image: data.image,
              width: data.width,
              height: data.height,
              theme,
            },
          };
        } catch (err) {
          return { success: false, error: `storybook_screenshot failed: ${(err as Error).message}` };
        }
      },
    },

    // ── storybook_screenshot_all ───────────────────────────────────────
    {
      name: 'storybook_screenshot_all',
      description: 'Screenshot ALL stories at all specified viewports and themes.',
      parameters: {
        viewports: {
          type: 'string',
          description: 'Comma-separated viewport widths (default: "375,768,1440")',
          required: false,
        },
        themes: {
          type: 'string',
          description: 'Comma-separated themes (default: "light,dark")',
          required: false,
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const storybookUrl = getStorybookUrl();
          const serviceUrl = getPlaywrightServiceUrl();

          const viewports = ((params.viewports as string) || '375,768,1440')
            .split(',')
            .map((v) => parseInt(v.trim(), 10));
          const themes = ((params.themes as string) || 'light,dark')
            .split(',')
            .map((t) => t.trim());

          const stories = await fetchStoryIndex(storybookUrl);

          const requests = stories.flatMap((story) =>
            viewports.flatMap((width) =>
              themes.map((theme) => ({
                story_id: story.id,
                url: `${storybookUrl}/iframe.html?id=${story.id}&globals=theme:${theme}`,
                viewport: { width, height: 900 },
                theme,
              })),
            ),
          );

          const res = await fetch(`${serviceUrl}/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests }),
            signal: AbortSignal.timeout(60_000),
          });

          if (!res.ok) {
            return { success: false, error: `Batch screenshot service returned ${res.status}: ${await res.text()}` };
          }

          const data = (await res.json()) as { results: Array<{ story_id: string; viewport: number; theme: string; image: string }> };

          const results = data.results.map((r) => ({
            story_id: r.story_id,
            viewport: r.viewport,
            theme: r.theme,
            image: r.image ? r.image.slice(0, 100) + '...' : null,
          }));

          return {
            success: true,
            data: { total: results.length, results },
          };
        } catch (err) {
          return { success: false, error: `storybook_screenshot_all failed: ${(err as Error).message}` };
        }
      },
    },

    // ── storybook_visual_diff ──────────────────────────────────────────
    {
      name: 'storybook_visual_diff',
      description: 'Compare current story renders against approved baselines to detect visual regressions.',
      parameters: {
        story_ids: {
          type: 'string',
          description: 'Comma-separated story IDs to compare (default: all stories)',
          required: false,
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const storybookUrl = getStorybookUrl();
          const serviceUrl = getPlaywrightServiceUrl();
          const baselineUrl = process.env.BASELINE_STORAGE_URL || 'gs://glyphor-company/storybook-baselines';

          const allStories = await fetchStoryIndex(storybookUrl);
          const storyIdFilter = params.story_ids as string | undefined;
          const targetIds = storyIdFilter
            ? storyIdFilter.split(',').map((s) => s.trim())
            : allStories.map((s) => s.id);

          const pairs = targetIds.map((id) => ({
            story_id: id,
            current_url: `${storybookUrl}/iframe.html?id=${id}`,
            baseline_url: `${baselineUrl}/${id}`,
          }));

          const res = await fetch(`${serviceUrl}/compare`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pairs }),
            signal: AbortSignal.timeout(60_000),
          });

          if (!res.ok) {
            return { success: false, error: `Visual diff service returned ${res.status}: ${await res.text()}` };
          }

          const data = (await res.json()) as {
            changed: Array<{ story_id: string; diff_percentage: number }>;
            new_stories: string[];
            removed_baselines: string[];
          };

          return {
            success: true,
            data: {
              changed: data.changed,
              new_stories: data.new_stories,
              removed_baselines: data.removed_baselines,
              total_compared: pairs.length,
            },
          };
        } catch (err) {
          return { success: false, error: `storybook_visual_diff failed: ${(err as Error).message}` };
        }
      },
    },

    // ── storybook_save_baseline ────────────────────────────────────────
    {
      name: 'storybook_save_baseline',
      description:
        'Save current screenshots as approved baselines for visual regression testing. YELLOW authority.',
      parameters: {
        story_ids: {
          type: 'string',
          description: 'Comma-separated story IDs to baseline (default: all)',
          required: false,
        },
        viewports: {
          type: 'string',
          description: 'Comma-separated viewport widths (default: "375,768,1440")',
          required: false,
        },
        themes: {
          type: 'string',
          description: 'Comma-separated themes (default: "light,dark")',
          required: false,
        },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const storybookUrl = getStorybookUrl();
          const serviceUrl = getPlaywrightServiceUrl();
          const baselineUrl = process.env.BASELINE_STORAGE_URL || 'gs://glyphor-company/storybook-baselines';

          const viewports = ((params.viewports as string) || '375,768,1440')
            .split(',')
            .map((v) => parseInt(v.trim(), 10));
          const themes = ((params.themes as string) || 'light,dark')
            .split(',')
            .map((t) => t.trim());

          const allStories = await fetchStoryIndex(storybookUrl);
          const storyIdFilter = params.story_ids as string | undefined;
          const targetIds = storyIdFilter
            ? storyIdFilter.split(',').map((s) => s.trim())
            : allStories.map((s) => s.id);

          // Screenshot the target stories
          const requests = targetIds.flatMap((id) =>
            viewports.flatMap((width) =>
              themes.map((theme) => ({
                story_id: id,
                url: `${storybookUrl}/iframe.html?id=${id}&globals=theme:${theme}`,
                viewport: { width, height: 900 },
                theme,
              })),
            ),
          );

          const screenshotRes = await fetch(`${serviceUrl}/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requests }),
            signal: AbortSignal.timeout(60_000),
          });

          if (!screenshotRes.ok) {
            return { success: false, error: `Screenshot batch failed: ${screenshotRes.status}` };
          }

          const screenshots = (await screenshotRes.json()) as { results: Array<Record<string, unknown>> };

          // Save as baselines
          const saveRes = await fetch(`${baselineUrl}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ images: screenshots.results }),
            signal: AbortSignal.timeout(60_000),
          });

          if (!saveRes.ok) {
            return { success: false, error: `Baseline save failed: ${saveRes.status}` };
          }

          return {
            success: true,
            data: {
              baselines_saved: requests.length,
              story_ids: targetIds,
              viewports,
              themes,
            },
          };
        } catch (err) {
          return { success: false, error: `storybook_save_baseline failed: ${(err as Error).message}` };
        }
      },
    },

    // ── storybook_check_coverage ───────────────────────────────────────
    {
      name: 'storybook_check_coverage',
      description:
        'Analyze coverage by cross-referencing component files against Storybook stories.',
      parameters: {},
      async execute(): Promise<ToolResult> {
        try {
          const storybookUrl = getStorybookUrl();

          // Get all stories from Storybook index
          const stories = await fetchStoryIndex(storybookUrl);
          const storyPaths = new Set(stories.map((s) => s.importPath));

          // Get component inventory from GitHub
          const componentsDir = await getFileContents(GLYPHOR_REPOS.company, 'src/components');
          const componentFiles: string[] = [];

          if (componentsDir && Array.isArray(componentsDir)) {
            for (const entry of componentsDir as Array<{ name: string; path: string; type: string }>) {
              if (entry.type === 'file' && /\.(tsx|jsx)$/.test(entry.name) && !entry.name.includes('.stories.')) {
                componentFiles.push(entry.path);
              }
            }
          }

          // Cross-reference: components with and without stories
          const withStories: string[] = [];
          const withoutStories: string[] = [];

          for (const comp of componentFiles) {
            const storyFile = comp.replace(/\.(tsx|jsx)$/, '.stories.$1');
            const hasStory = storyPaths.has(`./${storyFile}`) || storyPaths.has(storyFile);
            if (hasStory) {
              withStories.push(comp);
            } else {
              withoutStories.push(comp);
            }
          }

          // Detect stale stories (stories for components that no longer exist)
          const componentPathSet = new Set(componentFiles);
          const staleStories = stories.filter((s) => {
            const componentPath = s.importPath
              .replace(/^\.\//, '')
              .replace(/\.stories\.(tsx|jsx|ts|js)$/, '.tsx');
            return !componentPathSet.has(componentPath);
          });

          const total = componentFiles.length || 1;
          const coveragePercent = Math.round((withStories.length / total) * 100);

          return {
            success: true,
            data: {
              coverage_percentage: coveragePercent,
              total_components: componentFiles.length,
              with_stories: withStories.length,
              without_stories: withoutStories,
              stale_stories: staleStories.map((s) => s.id),
              total_stories: stories.length,
            },
          };
        } catch (err) {
          return { success: false, error: `storybook_check_coverage failed: ${(err as Error).message}` };
        }
      },
    },

    // ── storybook_get_story_source ─────────────────────────────────────
    {
      name: 'storybook_get_story_source',
      description: 'Read the source code of a Storybook story file.',
      parameters: {
        story_id: { type: 'string', description: 'Story ID to look up', required: true },
      },
      async execute(params): Promise<ToolResult> {
        try {
          const storyId = params.story_id as string;
          if (!storyId) return { success: false, error: 'Parameter "story_id" is required.' };

          const storybookUrl = getStorybookUrl();
          const stories = await fetchStoryIndex(storybookUrl);
          const story = stories.find((s) => s.id === storyId);

          if (!story) {
            return { success: false, error: `Story "${storyId}" not found in index.` };
          }

          const filePath = story.importPath.replace(/^\.\//, '');
          const contents = await getFileContents(GLYPHOR_REPOS.company, filePath);

          if (!contents) {
            return { success: false, error: `Could not read story file at "${filePath}".` };
          }

          return {
            success: true,
            data: {
              story_id: storyId,
              title: story.title,
              name: story.name,
              import_path: story.importPath,
              source: contents,
            },
          };
        } catch (err) {
          return { success: false, error: `storybook_get_story_source failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}
