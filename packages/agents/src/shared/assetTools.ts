/**
 * Asset Tools — Visual asset generation and management
 *
 * Storage (upload_asset, list_assets, publish flows):
 *   - Preferred: commit files into a GitHub repo via ASSET_GITHUB_REPO + ASSET_GITHUB_OWNER + GITHUB_TOKEN.
 *   - Legacy: HTTP service with POST /upload and GET /list (ASSET_SERVICE_URL).
 *
 * Tools:
 *   generate_image              — Generate images via Gemini Imagen 4 (GOOGLE_AI_API_KEY / GEMINI_API_KEY)
 *   generate_and_publish_asset  — Generate + store + sync + publish a design asset deliverable
 *   publish_asset_deliverable   — Store + sync + publish an existing asset as a durable deliverable
 *   upload_asset                — Upload image bytes to GitHub path or legacy asset service
 *   list_assets                 — List assets in GitHub folder or legacy service
 *   optimize_image              — Compress/optimize for web
 *   generate_favicon_set        — Generate complete favicon/icon set
 */

import type { GlyphorEventBus, ToolDefinition, ToolResult, ToolContext } from '@glyphor/agent-runtime';
import { GoogleGenAI } from '@google/genai';
import {
  uploadToSharePoint,
  createOrUpdateBinaryFile,
  getGitHubClient,
  GLYPHOR_GITHUB_ORG,
} from '@glyphor/integrations';
import { createDeliverableTools } from './deliverableTools.js';
import { getPlaywrightServiceUrl } from './playwrightServiceUrl.js';

const PRISM_STYLE_AUGMENT =
  'Use the Glyphor Prism brand palette: deep indigo (#1E1B4B), electric violet (#7C3AED), ' +
  'soft lavender (#C4B5FD), crisp white (#FFFFFF). Clean, modern, geometric style with subtle gradients.';

const VALID_ASSET_CATEGORIES = [
  'icon',
  'illustration',
  'hero',
  'thumbnail',
  'avatar',
  'brand',
] as const;

type AssetCategory = (typeof VALID_ASSET_CATEGORIES)[number];

interface GithubAssetConfig {
  /** GitHub org / user (e.g. glyphor-adt, glyphor-fuse). */
  owner: string;
  repo: string;
  branch: string;
  pathPrefix: string;
}

function resolveGithubAssetConfig(): GithubAssetConfig | null {
  const repo = process.env.ASSET_GITHUB_REPO?.trim();
  if (!repo) return null;
  const owner =
    process.env.ASSET_GITHUB_OWNER?.trim() ||
    process.env.ASSET_GITHUB_ORG?.trim() ||
    GLYPHOR_GITHUB_ORG;
  return {
    owner,
    repo,
    branch: process.env.ASSET_GITHUB_BRANCH?.trim() || 'main',
    pathPrefix: (process.env.ASSET_GITHUB_PATH_PREFIX ?? 'public/images/design-assets')
      .trim()
      .replace(/^[/\\]+|[/\\]+$/g, ''),
  };
}

function getLegacyAssetServiceUrl(): string | null {
  const url = process.env.ASSET_SERVICE_URL?.trim();
  return url || null;
}

function assetStorageNotConfiguredMessage(): string {
  return (
    'Asset storage not configured: set ASSET_GITHUB_REPO, optional ASSET_GITHUB_OWNER ' +
    `(glyphor-adt or glyphor-fuse; defaults to ${GLYPHOR_GITHUB_ORG}), ` +
    'optional ASSET_GITHUB_BRANCH / ASSET_GITHUB_PATH_PREFIX, and GITHUB_TOKEN with repo contents access, ' +
    'or set ASSET_SERVICE_URL for legacy HTTP upload service.'
  );
}

function basenameOnly(filename: string): string {
  const trimmed = filename.trim().replace(/^[/\\]+/, '');
  const parts = trimmed.split(/[/\\]/);
  const base = parts[parts.length - 1] ?? trimmed;
  return base || trimmed;
}

async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  if (/^data:/i.test(imageUrl)) {
    const match = /^data:[^;]+;base64,(.+)$/i.exec(imageUrl);
    if (!match) {
      throw new Error('image_url data URL must be base64-encoded');
    }
    return Buffer.from(match[1], 'base64');
  }
  if (/^https?:\/\//i.test(imageUrl)) {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      throw new Error(`Failed to download image: ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  const asB64 = imageUrl.replace(/\s/g, '');
  if (asB64.length > 64 && /^[a-z0-9+/=_-]+$/i.test(asB64.slice(0, 256))) {
    return Buffer.from(asB64, 'base64');
  }
  throw new Error('image_url must be a data: URL, https URL, or base64 image bytes');
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sanitizeFilename(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, '-').trim();
}

function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function resolveSharePointFolder(category: AssetCategory, folder?: string): string {
  const rootFolder = (process.env.SHAREPOINT_ROOT_FOLDER ?? 'Company-Agent-Knowledge')
    .trim()
    .replace(/[\\/]+$/, '');

  const normalized = folder?.trim().replace(/^[/\\]+|[/\\]+$/g, '');
  if (!normalized) {
    return `${rootFolder}/Deliverables/Design Assets/${category}`;
  }

  if (normalized === rootFolder || normalized.startsWith(`${rootFolder}/`)) {
    return normalized;
  }

  return `${rootFolder}/${normalized}`;
}

function resolveSharePointReferenceFileName(filename: string, override?: string): string {
  const baseName = sanitizeFilename(override?.trim() || filename);
  const extension = getFileExtension(baseName);
  if (extension === '.md' || extension === '.txt' || extension === '.docx') {
    return baseName;
  }

  const withoutExtension = extension ? baseName.slice(0, -extension.length) : baseName;
  return `${withoutExtension}.md`;
}

function resolveGeminiApiKeyForImages(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_AI_API_KEY?.trim() || null;
}

/** Map legacy DALL-E size strings to Imagen aspect ratios. */
function dimensionsToImagenAspectRatio(dimensions: string): '1:1' | '16:9' | '9:16' {
  if (dimensions === '1792x1024') return '16:9';
  if (dimensions === '1024x1792') return '9:16';
  return '1:1';
}

/**
 * Generate an image with Gemini Imagen 4 (same stack as video storyboards / web build).
 * Returns a data: URL so downstream upload accepts it without public HTTPS hosting.
 */
export async function generateImageWithImagen(params: {
  prompt: string;
  style?: string;
  dimensions?: string;
  brand_constrained?: boolean;
}): Promise<ToolResult> {
  try {
    const apiKey = resolveGeminiApiKeyForImages();
    if (!apiKey) {
      return {
        success: false,
        error: 'GOOGLE_AI_API_KEY or GEMINI_API_KEY not configured (required for Imagen image generation)',
      };
    }

    const style = params.style || 'illustration';
    const dimensions = params.dimensions || '1024x1024';
    const brandConstrained = params.brand_constrained ?? false;

    let finalPrompt = `${params.prompt} (style: ${style})`;
    if (brandConstrained) {
      finalPrompt = `${finalPrompt}. ${PRISM_STYLE_AUGMENT}`;
    }

    const genai = new GoogleGenAI({ apiKey });
    const aspectRatio = dimensionsToImagenAspectRatio(dimensions);
    const response = await genai.models.generateImages({
      model: 'imagen-4.0-fast-generate-001',
      prompt: finalPrompt,
      config: {
        numberOfImages: 1,
        aspectRatio,
      },
    });

    const imageBytes = response.generatedImages?.[0]?.image?.imageBytes;
    if (!imageBytes) {
      return { success: false, error: 'Imagen returned no image data' };
    }

    const dataUrl = `data:image/jpeg;base64,${imageBytes}`;
    return {
      success: true,
      data: {
        url: dataUrl,
        revised_prompt: undefined,
        dimensions,
        style,
        brand_constrained: brandConstrained,
      },
    };
  } catch (err) {
    return { success: false, error: `Image generation failed: ${(err as Error).message}` };
  }
}

function deriveDeliverableTitle(filename: string, category: AssetCategory, override?: string): string {
  if (override?.trim()) return override.trim();

  const withoutExtension = filename.replace(/\.[^.]+$/, '');
  return `${withoutExtension.replace(/[-_]+/g, ' ')} (${category})`;
}

function buildDeliverableSummary(input: {
  title: string;
  filename: string;
  category: AssetCategory;
  altText: string;
  storagePath: string;
  sharePointUrl: string;
}): string {
  return [
    `Published design asset deliverable: ${input.title}`,
    `File: ${input.filename}`,
    `Category: ${input.category}`,
    `Alt text: ${input.altText}`,
    `SharePoint: ${input.sharePointUrl}`,
    `Storage: ${input.storagePath}`,
  ].join('\n');
}

async function generateImageInternal(params: {
  prompt: string;
  style?: string;
  dimensions?: string;
  brand_constrained?: boolean;
}): Promise<ToolResult> {
  return generateImageWithImagen(params);
}

async function uploadAssetInternal(params: {
  image_url: string;
  filename: string;
  category: AssetCategory;
  alt_text: string;
}): Promise<ToolResult> {
  try {
    const ghConfig = resolveGithubAssetConfig();
    if (ghConfig) {
      const buffer = await fetchImageBuffer(params.image_url);
      const safeName = sanitizeFilename(basenameOnly(params.filename));
      if (!safeName) {
        return { success: false, error: 'upload_asset: invalid filename' };
      }
      const repoPath = `${ghConfig.pathPrefix}/${params.category}/${safeName}`.replace(/\/{2,}/g, '/');
      const commit = await createOrUpdateBinaryFile(
        ghConfig.owner,
        ghConfig.repo,
        repoPath,
        buffer,
        ghConfig.branch,
        `chore(assets): add ${params.category} ${safeName}`,
      );
      const rawUrl =
        commit.download_url ??
        `https://raw.githubusercontent.com/${ghConfig.owner}/${ghConfig.repo}/${ghConfig.branch}/${repoPath}`;
      const publicSitePath = `/${repoPath}`.replace(/\/{2,}/g, '/');
      return {
        success: true,
        data: {
          path: rawUrl,
          html_url: commit.html_url,
          commit_sha: commit.commit_sha,
          repo_path: repoPath,
          public_site_path: publicSitePath,
          filename: safeName,
          category: params.category,
          alt_text: params.alt_text,
        },
      };
    }

    const serviceUrl = getLegacyAssetServiceUrl();
    if (serviceUrl) {
      const res = await fetch(`${serviceUrl.replace(/\/+$/, '')}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: params.image_url,
          filename: params.filename,
          category: params.category,
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
          path: data.path ?? `gs://glyphor-company/assets/${params.category}/${params.filename}`,
          filename: params.filename,
          category: params.category,
          alt_text: params.alt_text,
        },
      };
    }

    return { success: false, error: assetStorageNotConfiguredMessage() };
  } catch (err) {
    return { success: false, error: `upload_asset failed: ${(err as Error).message}` };
  }
}

function classifyImageSource(imageUrl: string): 'remote_url' | 'data_url' | 'base64' {
  if (/^https?:\/\//i.test(imageUrl)) return 'remote_url';
  if (/^data:/i.test(imageUrl)) return 'data_url';
  return 'base64';
}

async function publishAssetDeliverableInternal(
  params: {
    image_url: string;
    filename: string;
    category: AssetCategory;
    alt_text: string;
    title?: string;
    initiative_id?: string;
    directive_id?: string;
    assignment_id?: string;
    metadata?: unknown;
    sharepoint_folder?: string;
    sharepoint_file_name?: string;
    content?: string;
  },
  ctx: ToolContext,
  glyphorEventBus?: GlyphorEventBus,
): Promise<ToolResult> {
  const storageResult = await uploadAssetInternal({
    image_url: params.image_url,
    filename: params.filename,
    category: params.category,
    alt_text: params.alt_text,
  });

  if (!storageResult.success) {
    return storageResult;
  }

  try {
    const sourceKind = classifyImageSource(params.image_url);
    const sharePointFileName = resolveSharePointReferenceFileName(params.filename, params.sharepoint_file_name);
    const sharePointFolder = resolveSharePointFolder(params.category, params.sharepoint_folder);
    const title = deriveDeliverableTitle(params.filename, params.category, params.title);
    const storagePath = (storageResult.data as { path: string }).path;
    const referenceContent = params.content || [
      `# Design Asset Deliverable: ${title}`,
      '',
      `- Asset file: ${params.filename}`,
      `- Asset category: ${params.category}`,
      `- Alt text: ${params.alt_text}`,
      `- Durable storage path: ${storagePath}`,
      `- Producing agent: ${ctx.agentRole}`,
      `- Source kind: ${sourceKind}`,
      '',
      'This SharePoint document is the durable reference for the published design asset deliverable.',
    ].join('\n');

    const sharePointResult = await uploadToSharePoint(
      sharePointFileName,
      referenceContent,
      { folder: sharePointFolder, agentRole: ctx.agentRole },
    );
    const durableReference = sharePointResult.webUrl || `sharepoint://${sharePointFolder}/${sharePointFileName}`;

    const publishTool = createDeliverableTools(glyphorEventBus)
      .find((tool) => tool.name === 'publish_deliverable');

    if (!publishTool) {
      return { success: false, error: 'publish_deliverable tool is unavailable in this runtime.' };
    }

    const sharePointSummary = params.content || buildDeliverableSummary({
      title,
      filename: sharePointFileName,
      category: params.category,
      altText: params.alt_text,
      storagePath,
      sharePointUrl: durableReference,
    });

    const metadata = {
      ...normalizeMetadata(params.metadata),
      asset_filename: params.filename,
      asset_category: params.category,
      asset_storage_url: storagePath,
      sharepoint_file_name: sharePointFileName,
      sharepoint_folder: sharePointFolder,
      sharepoint_path: `${sharePointFolder}/${sharePointFileName}`,
      sharepoint_web_url: sharePointResult.webUrl,
      sharepoint_reference: durableReference,
      sharepoint_knowledge_id: sharePointResult.knowledgeId,
      alt_text: params.alt_text,
      uploaded_by: ctx.agentRole,
      source_kind: sourceKind,
    };

    const publishResult = await publishTool.execute(
      {
        title,
        type: 'design_asset',
        content: sharePointSummary,
        storage_url: durableReference,
        initiative_id: params.initiative_id,
        directive_id: params.directive_id,
        assignment_id: params.assignment_id,
        metadata,
      },
      ctx,
    );

    if (!publishResult.success) {
      return {
        success: false,
        error: publishResult.error ?? 'Failed to publish deliverable record.',
        data: {
          storage_path: storagePath,
          sharepoint_url: durableReference,
          sharepoint_path: `${sharePointFolder}/${sharePointFileName}`,
          sharepoint_knowledge_id: sharePointResult.knowledgeId,
        },
      };
    }

    return {
      success: true,
      data: {
        ...(publishResult.data as Record<string, unknown>),
        title,
        filename: params.filename,
        category: params.category,
        storage_path: storagePath,
        sharepoint_url: durableReference,
        sharepoint_web_url: sharePointResult.webUrl,
        sharepoint_path: `${sharePointFolder}/${sharePointFileName}`,
        sharepoint_knowledge_id: sharePointResult.knowledgeId,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `publish_asset_deliverable failed: ${(err as Error).message}`,
      data: storageResult.data,
    };
  }
}

export function createAssetTools(glyphorEventBus?: GlyphorEventBus): ToolDefinition[] {
  return [
    // ── generate_image ─────────────────────────────────────────────────
    {
      name: 'generate_image',
      description: 'Generate an image using Gemini Imagen 4 (requires GOOGLE_AI_API_KEY or GEMINI_API_KEY). Optionally constrain to Glyphor brand palette.',
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
      execute: async (params): Promise<ToolResult> => generateImageInternal({
        prompt: params.prompt as string,
        style: params.style as string | undefined,
        dimensions: params.dimensions as string | undefined,
        brand_constrained: params.brand_constrained as boolean | undefined,
      }),
    },

    // ── generate_and_publish_asset ────────────────────────────────────
    {
      name: 'generate_and_publish_asset',
      description:
        'Generate an image, store it in asset storage, upload it to SharePoint, and publish it as a design_asset deliverable.',
      parameters: {
        prompt: { type: 'string', description: 'Image generation prompt', required: true },
        filename: { type: 'string', description: 'Target filename for the generated asset', required: true },
        category: {
          type: 'string',
          description: 'Asset category',
          required: true,
          enum: [...VALID_ASSET_CATEGORIES],
        },
        alt_text: { type: 'string', description: 'Alt text for accessibility', required: true },
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
        title: {
          type: 'string',
          description: 'Optional published deliverable title',
          required: false,
        },
        initiative_id: {
          type: 'string',
          description: 'Initiative UUID the asset supports',
          required: false,
        },
        directive_id: {
          type: 'string',
          description: 'Founder directive UUID the asset supports',
          required: false,
        },
        assignment_id: {
          type: 'string',
          description: 'Work assignment UUID this asset fulfills',
          required: false,
        },
        metadata: {
          type: 'object',
          description: 'Optional JSON metadata for the deliverable record',
          required: false,
        },
        sharepoint_folder: {
          type: 'string',
          description: 'Optional SharePoint folder under the knowledge root for the asset file',
          required: false,
        },
        sharepoint_file_name: {
          type: 'string',
          description: 'Optional SharePoint filename override',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => {
        const generationResult = await generateImageInternal({
          prompt: params.prompt as string,
          style: params.style as string | undefined,
          dimensions: params.dimensions as string | undefined,
          brand_constrained: params.brand_constrained as boolean | undefined,
        });

        if (!generationResult.success) return generationResult;

        const generated = generationResult.data as {
          url?: string;
          revised_prompt?: string;
          dimensions: string;
          style: string;
          brand_constrained: boolean;
        };

        if (!generated.url) {
          return {
            success: false,
            error: 'generate_image did not return image data for publication.',
            data: generationResult.data,
          };
        }

        const publishResult = await publishAssetDeliverableInternal(
          {
            image_url: generated.url,
            filename: params.filename as string,
            category: params.category as AssetCategory,
            alt_text: params.alt_text as string,
            title: params.title as string | undefined,
            initiative_id: params.initiative_id as string | undefined,
            directive_id: params.directive_id as string | undefined,
            assignment_id: params.assignment_id as string | undefined,
            sharepoint_folder: params.sharepoint_folder as string | undefined,
            sharepoint_file_name: params.sharepoint_file_name as string | undefined,
            metadata: {
              ...normalizeMetadata(params.metadata),
              generation_prompt: params.prompt,
              revised_prompt: generated.revised_prompt,
              generated_dimensions: generated.dimensions,
              generated_style: generated.style,
              brand_constrained: generated.brand_constrained,
            },
          },
          ctx,
          glyphorEventBus,
        );

        if (!publishResult.success) {
          return {
            ...publishResult,
            data: {
              ...(publishResult.data as Record<string, unknown> | undefined),
              generated_image_url: generated.url,
              revised_prompt: generated.revised_prompt,
            },
          };
        }

        return {
          success: true,
          data: {
            ...(publishResult.data as Record<string, unknown>),
            generated_image_url: generated.url,
            revised_prompt: generated.revised_prompt,
            generated_dimensions: generated.dimensions,
            generated_style: generated.style,
          },
        };
      },
    },

    // ── publish_asset_deliverable ─────────────────────────────────────
    {
      name: 'publish_asset_deliverable',
      description:
        'Upload an existing image to asset storage, sync it to SharePoint, and publish it as a durable design_asset deliverable.',
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
          enum: [...VALID_ASSET_CATEGORIES],
        },
        alt_text: { type: 'string', description: 'Alt text for accessibility', required: true },
        title: {
          type: 'string',
          description: 'Optional published deliverable title',
          required: false,
        },
        initiative_id: {
          type: 'string',
          description: 'Initiative UUID the asset supports',
          required: false,
        },
        directive_id: {
          type: 'string',
          description: 'Founder directive UUID the asset supports',
          required: false,
        },
        assignment_id: {
          type: 'string',
          description: 'Work assignment UUID this asset fulfills',
          required: false,
        },
        metadata: {
          type: 'object',
          description: 'Optional JSON metadata for the deliverable record',
          required: false,
        },
        sharepoint_folder: {
          type: 'string',
          description: 'Optional SharePoint folder under the knowledge root for the asset file',
          required: false,
        },
        sharepoint_file_name: {
          type: 'string',
          description: 'Optional SharePoint filename override',
          required: false,
        },
        content: {
          type: 'string',
          description: 'Optional human-readable deliverable summary',
          required: false,
        },
      },
      execute: async (params, ctx): Promise<ToolResult> => publishAssetDeliverableInternal(
        {
          image_url: params.image_url as string,
          filename: params.filename as string,
          category: params.category as AssetCategory,
          alt_text: params.alt_text as string,
          title: params.title as string | undefined,
          initiative_id: params.initiative_id as string | undefined,
          directive_id: params.directive_id as string | undefined,
          assignment_id: params.assignment_id as string | undefined,
          metadata: params.metadata,
          sharepoint_folder: params.sharepoint_folder as string | undefined,
          sharepoint_file_name: params.sharepoint_file_name as string | undefined,
          content: params.content as string | undefined,
        },
        ctx,
        glyphorEventBus,
      ),
    },

    // ── upload_asset ───────────────────────────────────────────────────
    {
      name: 'upload_asset',
      description:
        'Upload an image to GitHub (ASSET_GITHUB_REPO + ASSET_GITHUB_OWNER) or legacy ASSET_SERVICE_URL.',
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
          enum: [...VALID_ASSET_CATEGORIES],
        },
        alt_text: { type: 'string', description: 'Alt text for accessibility', required: true },
      },
      execute: async (params): Promise<ToolResult> => uploadAssetInternal({
        image_url: params.image_url as string,
        filename: params.filename as string,
        category: params.category as AssetCategory,
        alt_text: params.alt_text as string,
      }),
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
          enum: [...VALID_ASSET_CATEGORIES],
        },
        search: { type: 'string', description: 'Search assets by name', required: false },
      },
      execute: async (params): Promise<ToolResult> => {
        try {
          const ghConfig = resolveGithubAssetConfig();
          if (ghConfig) {
            const gh = getGitHubClient();
            const category = params.category as string | undefined;
            const dirPath = category
              ? `${ghConfig.pathPrefix}/${category}`.replace(/\/{2,}/g, '/')
              : ghConfig.pathPrefix;
            const { data } = await gh.repos.getContent({
              owner: ghConfig.owner,
              repo: ghConfig.repo,
              path: dirPath,
              ref: ghConfig.branch,
            });

            if (!Array.isArray(data)) {
              return { success: true, data: { assets: [], total: 0 } };
            }

            const search = ((params.search as string) ?? '').toLowerCase().trim();
            const assets = data
              .filter((item) => item.type === 'file')
              .filter((item) => !search || item.name.toLowerCase().includes(search))
              .map((item) => ({
                filename: item.name,
                url:
                  item.download_url ??
                  `https://raw.githubusercontent.com/${ghConfig.owner}/${ghConfig.repo}/${ghConfig.branch}/${item.path}`,
                category: category ?? 'mixed',
                dimensions: 'unknown',
                upload_date: '',
              }));

            return { success: true, data: { assets, total: assets.length } };
          }

          const serviceUrl = getLegacyAssetServiceUrl();
          if (!serviceUrl) {
            return { success: false, error: assetStorageNotConfiguredMessage() };
          }

          const query = new URLSearchParams();
          if (params.category) query.set('category', params.category as string);
          if (params.search) query.set('search', params.search as string);

          const res = await fetch(`${serviceUrl.replace(/\/+$/, '')}/list?${query.toString()}`, {
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
        } catch (err: unknown) {
          if ((err as { status?: number }).status === 404) {
            return { success: true, data: { assets: [], total: 0 } };
          }
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
          const screenshotUrl = getPlaywrightServiceUrl();
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
          const screenshotUrl = getPlaywrightServiceUrl();

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
