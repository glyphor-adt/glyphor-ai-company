/**
 * Screenshot Tools — Visual capture and comparison via Playwright service
 *
 * Tools:
 *   screenshot_page        — Capture screenshot of any URL
 *   screenshot_component   — Render and capture isolated component
 *   compare_screenshots    — Visual diff between two images
 *   check_responsive       — Screenshots at 5 breakpoints
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { getPlaywrightServiceUrl } from './playwrightServiceUrl.js';

const VIEWPORT_MAP: Record<string, { width: number; height: number }> = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
};

async function postJson(path: string, body: Record<string, unknown>): Promise<Response> {
  const serviceUrl = getPlaywrightServiceUrl();
  return fetch(`${serviceUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
}

export function createScreenshotTools(): ToolDefinition[] {
  return [
    // ── screenshot_page ──────────────────────────────────────────────
    {
      name: 'screenshot_page',
      description: 'Capture a screenshot of any URL at a given viewport size.',
      parameters: {
        url: { type: 'string', description: 'URL to capture', required: true },
        viewport: {
          type: 'string',
          description: 'Viewport preset',
          required: false,
          enum: ['desktop', 'tablet', 'mobile'],
        },
        full_page: {
          type: 'boolean',
          description: 'Capture the full scrollable page',
          required: false,
        },
        selector: {
          type: 'string',
          description: 'CSS selector to screenshot a specific element',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const viewport = (params.viewport as string) || 'desktop';
          const res = await postJson('/screenshot', {
            url: params.url,
            viewport: VIEWPORT_MAP[viewport],
            full_page: params.full_page ?? false,
            selector: params.selector,
            wait_for: 'networkidle',
          });

          if (!res.ok) {
            return { success: false, error: `Screenshot service returned ${res.status}: ${await res.text()}` };
          }

          const data = await res.json() as Record<string, unknown>;
          return {
            success: true,
            data: {
              image: data.image,
              width: data.width,
              height: data.height,
            },
          };
        } catch (err) {
          return { success: false, error: `screenshot_page failed: ${(err as Error).message}` };
        }
      },
    },

    // ── screenshot_component ─────────────────────────────────────────
    {
      name: 'screenshot_component',
      description: 'Render a React component in isolation (via Storybook) and capture a screenshot.',
      parameters: {
        component_path: {
          type: 'string',
          description: 'Path to the component (e.g. "Button" or "ui/Card")',
          required: true,
        },
        props: {
          type: 'string',
          description: 'JSON string of props to pass to the component',
          required: false,
        },
        viewport: {
          type: 'string',
          description: 'Viewport preset',
          required: false,
          enum: ['desktop', 'tablet', 'mobile'],
        },
        theme: {
          type: 'string',
          description: 'Color theme for the component',
          required: false,
          enum: ['light', 'dark'],
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const viewport = (params.viewport as string) || 'desktop';
          const theme = (params.theme as string) || 'light';
          const storybookUrl = process.env.STORYBOOK_URL;

          let note: string | undefined;
          if (!storybookUrl) {
            note = 'STORYBOOK_URL is not set — the screenshot service will not be able to render the component without a running Storybook instance.';
          }

          const componentId = (params.component_path as string).replace(/\//g, '-').toLowerCase();
          const iframeUrl = storybookUrl
            ? `${storybookUrl}/iframe.html?id=${componentId}&globals=theme:${theme}`
            : `http://localhost:6006/iframe.html?id=${componentId}&globals=theme:${theme}`;

          const body: Record<string, unknown> = {
            url: iframeUrl,
            viewport: VIEWPORT_MAP[viewport],
            full_page: false,
            wait_for: 'networkidle',
          };

          if (params.props) {
            body.props = params.props;
          }

          const res = await postJson('/screenshot', body);

          if (!res.ok) {
            return { success: false, error: `Screenshot service returned ${res.status}: ${await res.text()}` };
          }

          const data = await res.json() as Record<string, unknown>;
          return {
            success: true,
            data: {
              image: data.image,
              width: data.width,
              height: data.height,
              component: params.component_path,
              theme,
              ...(note ? { note } : {}),
            },
          };
        } catch (err) {
          return { success: false, error: `screenshot_component failed: ${(err as Error).message}` };
        }
      },
    },

    // ── compare_screenshots ──────────────────────────────────────────
    {
      name: 'compare_screenshots',
      description: 'Perform a visual diff between two screenshots (base64 PNGs).',
      parameters: {
        image_a: { type: 'string', description: 'First image as base64-encoded PNG', required: true },
        image_b: { type: 'string', description: 'Second image as base64-encoded PNG', required: true },
        threshold: {
          type: 'number',
          description: 'Pixel-match threshold between 0 and 1 (default 0.1)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const res = await postJson('/compare', {
            image_a: params.image_a,
            image_b: params.image_b,
            threshold: params.threshold ?? 0.1,
          });

          if (!res.ok) {
            return { success: false, error: `Compare service returned ${res.status}: ${await res.text()}` };
          }

          const data = await res.json() as Record<string, unknown>;
          return {
            success: true,
            data: {
              diff_image: data.diff_image,
              changed_percentage: data.changed_percentage,
              regions_changed: data.regions_changed,
            },
          };
        } catch (err) {
          return { success: false, error: `compare_screenshots failed: ${(err as Error).message}` };
        }
      },
    },

    // ── check_responsive ─────────────────────────────────────────────
    {
      name: 'check_responsive',
      description: 'Capture screenshots of a URL at 5 standard responsive breakpoints.',
      parameters: {
        url: { type: 'string', description: 'URL to capture across breakpoints', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const res = await postJson('/responsive', {
            url: params.url,
            viewports: [
              { width: 375, height: 812 },
              { width: 768, height: 1024 },
              { width: 1024, height: 768 },
              { width: 1440, height: 900 },
              { width: 1920, height: 1080 },
            ],
          });

          if (!res.ok) {
            return { success: false, error: `Responsive service returned ${res.status}: ${await res.text()}` };
          }

          const data = await res.json() as Record<string, unknown>;
          return {
            success: true,
            data: {
              screenshots: data.screenshots,
            },
          };
        } catch (err) {
          return { success: false, error: `check_responsive failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}
