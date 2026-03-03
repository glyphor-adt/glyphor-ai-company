/**
 * Asset Tools — Visual asset generation and management
 *
 * Tools:
 *   generate_image       — Generate images via DALL-E 3
 *   upload_asset         — Upload to asset storage (GCS)
 *   list_assets          — List visual assets by category
 *   optimize_image       — Compress/optimize for web
 *   generate_favicon_set — Generate complete favicon/icon set
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';

const PRISM_STYLE_AUGMENT =
  'Use the Glyphor Prism brand palette: deep indigo (#1E1B4B), electric violet (#7C3AED), ' +
  'soft lavender (#C4B5FD), crisp white (#FFFFFF). Clean, modern, geometric style with subtle gradients.';

function getAssetServiceUrl(): string {
  const url = process.env.ASSET_SERVICE_URL;
  if (!url) throw new Error('ASSET_SERVICE_URL not configured');
  return url;
}

function getScreenshotServiceUrl(): string {
  const url = process.env.SCREENSHOT_SERVICE_URL;
  if (!url) throw new Error('SCREENSHOT_SERVICE_URL not configured');
  return url;
}

export function createAssetTools(): ToolDefinition[] {
  return [
    // ── generate_image ─────────────────────────────────────────────────
    {
      name: 'generate_image',
      description: 'Generate an image using DALL-E 3. Optionally constrain to Glyphor brand palette.',
      parameters: {
        prompt: { type: 'string', description: 'Image generation prompt', required: true },
        style: {
          type: 'string',
          description: 'Visual style for the generated image',
          required: false,
          enum: ['illustration', 'photo', 'icon', 'abstract'],
        },
        dimensions: {
          type: 'string',
          description: 'Image dimensions',
          required: false,
          enum: ['1024x1024', '1792x1024', '1024x1792'],
        },
        brand_constrained: {
          type: 'boolean',
          description: 'When true, augments prompt with Prism palette and brand style info',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) {
            return { success: false, error: 'OPENAI_API_KEY not configured' };
          }

          const style = (params.style as string) || 'illustration';
          const dimensions = (params.dimensions as string) || '1024x1024';
          const brandConstrained = params.brand_constrained ?? false;

          let finalPrompt = `${params.prompt as string} (style: ${style})`;
          if (brandConstrained) {
            finalPrompt = `${finalPrompt}. ${PRISM_STYLE_AUGMENT}`;
          }

          const res = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: 'dall-e-3',
              prompt: finalPrompt,
              size: dimensions,
              quality: 'standard',
              n: 1,
            }),
            signal: AbortSignal.timeout(60_000),
          });

          if (!res.ok) {
            return { success: false, error: `DALL-E API returned ${res.status}: ${await res.text()}` };
          }

          const data = await res.json() as Record<string, unknown>;
          const images = data.data as Array<Record<string, unknown>> | undefined;
          const image = images?.[0];
          return {
            success: true,
            data: {
              url: image?.url,
              revised_prompt: image?.revised_prompt,
              dimensions,
              style,
              brand_constrained: brandConstrained,
            },
          };
        } catch (err) {
          return { success: false, error: `generate_image failed: ${(err as Error).message}` };
        }
      },
    },

    // ── upload_asset ───────────────────────────────────────────────────
    {
      name: 'upload_asset',
      description: 'Upload an image to Glyphor asset storage (GCS).',
      parameters: {
        image_url: {
          type: 'string',
          description: 'URL to download from or base64-encoded image data',
          required: true,
        },
        filename: { type: 'string', description: 'Target filename for the asset', required: true },
        category: {
          type: 'string',
          description: 'Asset category',
          required: true,
          enum: ['icon', 'illustration', 'hero', 'thumbnail', 'avatar', 'brand'],
        },
        alt_text: { type: 'string', description: 'Alt text for accessibility', required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const category = params.category as string;
          const filename = params.filename as string;
          const serviceUrl = getAssetServiceUrl();

          const res = await fetch(`${serviceUrl}/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_url: params.image_url,
              filename,
              category,
              alt_text: params.alt_text,
            }),
            signal: AbortSignal.timeout(60_000),
          });

          if (!res.ok) {
            return { success: false, error: `Asset upload returned ${res.status}: ${await res.text()}` };
          }

          const data = await res.json() as Record<string, unknown>;
          return {
            success: true,
            data: {
              path: data.path ?? `gs://glyphor-company/assets/${category}/${filename}`,
              filename,
              category,
              alt_text: params.alt_text,
            },
          };
        } catch (err) {
          return { success: false, error: `upload_asset failed: ${(err as Error).message}` };
        }
      },
    },

    // ── list_assets ────────────────────────────────────────────────────
    {
      name: 'list_assets',
      description: 'List visual assets in storage, optionally filtered by category or search term.',
      parameters: {
        category: {
          type: 'string',
          description: 'Filter by asset category',
          required: false,
          enum: ['icon', 'illustration', 'hero', 'thumbnail', 'avatar', 'brand'],
        },
        search: { type: 'string', description: 'Search assets by name', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const serviceUrl = getAssetServiceUrl();
          const query = new URLSearchParams();
          if (params.category) query.set('category', params.category as string);
          if (params.search) query.set('search', params.search as string);

          const res = await fetch(`${serviceUrl}/list?${query.toString()}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(30_000),
          });

          if (!res.ok) {
            return { success: false, error: `Asset list returned ${res.status}: ${await res.text()}` };
          }

          const data = await res.json() as Record<string, unknown>;
          return {
            success: true,
            data: {
              assets: data.assets as Array<{
                filename: string;
                url: string;
                category: string;
                dimensions: string;
                upload_date: string;
              }>,
              total: data.total ?? (data.assets as unknown[])?.length ?? 0,
            },
          };
        } catch (err) {
          return { success: false, error: `list_assets failed: ${(err as Error).message}` };
        }
      },
    },

    // ── optimize_image ─────────────────────────────────────────────────
    {
      name: 'optimize_image',
      description: 'Compress and optimize an image for web delivery.',
      parameters: {
        image_url: { type: 'string', description: 'URL of the image to optimize', required: true },
        format: {
          type: 'string',
          description: 'Target image format',
          required: false,
          enum: ['webp', 'avif', 'png', 'jpeg'],
        },
        max_width: {
          type: 'number',
          description: 'Maximum width in pixels (maintains aspect ratio)',
          required: false,
        },
        quality: {
          type: 'number',
          description: 'Compression quality (1-100)',
          required: false,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const screenshotUrl = getScreenshotServiceUrl();
          const format = (params.format as string) || 'webp';
          const quality = (params.quality as number) || 80;

          const body: Record<string, unknown> = {
            image_url: params.image_url,
            format,
            quality,
          };
          if (params.max_width) body.max_width = params.max_width;

          const res = await fetch(`${screenshotUrl}/optimize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60_000),
          });

          if (!res.ok) {
            return { success: false, error: `Optimize returned ${res.status}: ${await res.text()}` };
          }

          const data = await res.json() as Record<string, unknown>;
          return {
            success: true,
            data: {
              optimized_url: data.optimized_url,
              format,
              original_size: data.original_size,
              optimized_size: data.optimized_size,
              savings_percent: data.savings_percent,
            },
          };
        } catch (err) {
          return { success: false, error: `optimize_image failed: ${(err as Error).message}` };
        }
      },
    },

    // ── generate_favicon_set ───────────────────────────────────────────
    {
      name: 'generate_favicon_set',
      description:
        'Generate a complete favicon and icon set from a source image at standard sizes ' +
        '(16x16, 32x32, 48x48, 180x180, 192x192, 512x512) plus favicon.ico and manifest snippet.',
      parameters: {
        source_image_url: {
          type: 'string',
          description: 'URL of the source image to generate favicons from',
          required: true,
        },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const screenshotUrl = getScreenshotServiceUrl();

          const res = await fetch(`${screenshotUrl}/favicon-set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: params.source_image_url }),
            signal: AbortSignal.timeout(60_000),
          });

          if (!res.ok) {
            return { success: false, error: `Favicon generation returned ${res.status}: ${await res.text()}` };
          }

          const data = await res.json() as Record<string, unknown>;
          return {
            success: true,
            data: {
              icons: data.icons as Array<{ size: string; url: string }>,
              favicon_ico: data.favicon_ico,
              manifest_snippet: data.manifest_snippet,
              sizes: ['16x16', '32x32', '48x48', '180x180', '192x192', '512x512'],
            },
          };
        } catch (err) {
          return { success: false, error: `generate_favicon_set failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}
