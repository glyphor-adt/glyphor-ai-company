import path from 'node:path';
import { ModelClient, type ConversationTurn, type ToolContext, type ToolDeclaration, type ToolDefinition, type ToolResult } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import { createCloudflarePreviewTools, createGithubFromTemplateTools, createGithubPullRequestTools, createGithubPushFilesTools, createVercelProjectTools } from '@glyphor/integrations';
import { createDesignBriefTools } from './designBriefTools.js';
import { runSandboxBuild } from './sandboxBuildValidator.js';
import { getPlaywrightServiceUrl } from './playwrightServiceUrl.js';

type WebBuildTier = 'prototype' | 'full_build' | 'iterate';

/** Marketing sites use full landing-page contract; utility matches small apps (weather, tools, dashboards). */
type FoundationBuildMode = 'marketing' | 'utility';

function foundationModeFromNormalizedBrief(normalizedBrief: Record<string, unknown>): FoundationBuildMode {
  const pt = String(normalizedBrief?.product_type ?? '').toLowerCase().trim();
  if (pt === 'web_application' || pt === 'fullstack_application') return 'utility';
  return 'marketing';
}
type WebProjectType = 'react_spa' | 'nextjs_fullstack' | 'fastapi_backend' | 'legacy_refactor' | 'dbt_pipeline' | 'terraform_infra';
type WebVisualStyle = 'minimal' | 'bold' | 'editorial' | 'playful' | 'dark_glass';
type WebAnimationPreference = 'none' | 'subtle' | 'rich';

interface WebBrandContext {
  brand_name: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  heading_font: string;
  body_font: string;
  visual_style: WebVisualStyle;
  animation_preference: WebAnimationPreference;
}

interface WebBuildParams {
  brief: string;
  tier: WebBuildTier;
  project_type?: WebProjectType;
  project_id?: string;
  brand_context?: Partial<WebBrandContext>;
}

interface WebBuildResult {
  project_id?: string;
  preview_url?: string;
  deploy_url?: string;
  github_pr_url?: string;
  /** Branch that received the generated commit (not necessarily default/main). */
  source_branch?: string;
  /** Tell the user where to look on GitHub — avoids "no code" confusion when only `main` was opened. */
  repository_hint?: string;
  /** Direct link to the branch tree on GitHub (always use this + PR URL in chat). */
  github_branch_url?: string;
  /** Short numbered steps — agents should paste this first after a successful build. */
  user_next_steps?: string;
  build_report?: unknown;
  agent_trace?: unknown;
  tier_used: WebBuildTier;
  raw?: unknown;
}

interface WebBuildToolPolicy {
  allowBuild?: boolean;
  allowIterate?: boolean;
  allowUpgrade?: boolean;
  allowAutonomousLoop?: boolean;
  allowedBuildTiers?: WebBuildTier[];
}

type WebsitePipelineToolName =
  | 'normalize_design_brief'
  | 'build_website_foundation'
  | 'github_create_from_template'
  | 'github_push_files'
  | 'github_create_pull_request'
  | 'github_wait_for_pull_request_checks'
  | 'github_merge_pull_request'
  | 'vercel_create_project'
  | 'vercel_get_preview_url'
  | 'vercel_get_production_url'
  | 'cloudflare_register_preview'
  | 'cloudflare_update_preview';

const DEFAULT_BRAND_CONTEXT: WebBrandContext = {
  brand_name: '',
  primary_color: '',
  secondary_color: '',
  accent_color: '',
  heading_font: '',
  body_font: '',
  visual_style: 'minimal',
  animation_preference: 'subtle',
};

const ALL_BUILD_TIERS: WebBuildTier[] = ['prototype', 'full_build', 'iterate'];

const DEFAULT_INITIAL_BRANCH = 'feature/initial-build';
const DEFAULT_PROTOTYPE_BRANCH = 'feature/prototype-build';
const ITERATION_BRANCH_PREFIX = 'feature/web-iterate';
const UPGRADE_BRANCH_PREFIX = 'feature/web-upgrade';
const PREVIEW_POLL_ATTEMPTS = 30;
const PREVIEW_POLL_INTERVAL_MS = 10_000;
const PRODUCTION_POLL_ATTEMPTS = 30;
const PRODUCTION_POLL_INTERVAL_MS = 10_000;

/** Paths that must exist in generated output before Git push (same set as UX foundation validation). */
const REQUIRED_FOUNDATION_FILES = new Set([
  'index.html',
  'src/App.tsx',
  'src/styles/theme.css',
  'src/styles/fonts.css',
  'src/styles/index.css',
  'src/styles/tailwind.css',
]);

function assertValidWebsiteFileMap(files: Record<string, unknown>): void {
  const map = files as Record<string, string>;
  const nonEmptyKeys = Object.keys(map).filter(
    (k) => typeof map[k] === 'string' && map[k].trim().length > 0,
  );
  if (nonEmptyKeys.length === 0) {
    throw new Error(
      'build_website_foundation returned an empty `files` map — no generated code to push. '
        + 'Check GOOGLE_AI_API_KEY / GEMINI_API_KEY, UX_ENGINEER_MODEL, timeouts, and runtime logs.',
    );
  }
  for (const req of REQUIRED_FOUNDATION_FILES) {
    const c = map[req];
    if (typeof c !== 'string' || c.trim().length < 30) {
      throw new Error(
        `build_website_foundation is missing usable content for required path "${req}". Refusing to push template-only repo.`,
      );
    }
  }
  const app = map['src/App.tsx'];
  if (typeof app !== 'string' || app.trim().length < 80) {
    throw new Error('build_website_foundation produced src/App.tsx that is too small — aborting push.');
  }
}

// ─── IMAGE GENERATION FROM MANIFEST ─────────────────────────────────────────

const MAX_IMAGE_GEN_ITEMS = 7;
const IMAGE_GEN_TIMEOUT_MS = 30_000;

interface ImageManifestItem {
  fileName: string;
  prompt: string;
  aspect_ratio?: string;
  altText?: string;
}

/**
 * Generate images from the build manifest using Imagen 4 (primary) with
 * OpenAI DALL-E 3 fallback. Returns a map of filePath → base64 content
 * ready for github_push_files.
 */
async function generateImagesFromManifest(
  manifest: ImageManifestItem[],
  ctx: ToolContext,
): Promise<Record<string, string>> {
  const { ModelClient: MC } = await import('@glyphor/agent-runtime');
  const modelClient = new MC({
    geminiApiKey: process.env.GOOGLE_AI_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  });

  const items = manifest.slice(0, MAX_IMAGE_GEN_ITEMS);
  const imageFiles: Record<string, string> = {};

  console.log(`[WebBuild:Images] Generating ${items.length} images from manifest`);

  for (const item of items) {
    if (!item.fileName || !item.prompt) continue;

    // Normalize path: /images/hero.jpg → public/images/hero.jpg (Vite serves from public/)
    const filePath = item.fileName.startsWith('/')
      ? `public${item.fileName}`
      : item.fileName.startsWith('public/')
        ? item.fileName
        : `public/images/${item.fileName}`;

    try {
      // Primary: Imagen 4 Ultra
      const result = await Promise.race([
        modelClient.generateImage(item.prompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Image gen timeout')), IMAGE_GEN_TIMEOUT_MS),
        ),
      ]);

      if (result.base64) {
        imageFiles[filePath] = result.base64;
        console.log(`[WebBuild:Images] ✅ ${item.fileName} (Imagen 4)`);
        continue;
      }
    } catch (err) {
      console.warn(`[WebBuild:Images] Imagen 4 failed for ${item.fileName}: ${(err as Error).message}`);
    }

    // Fallback: OpenAI DALL-E 3
    try {
      const result = await Promise.race([
        modelClient.generateImageOpenAI(item.prompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Image gen timeout')), IMAGE_GEN_TIMEOUT_MS),
        ),
      ]);

      if (result.base64) {
        imageFiles[filePath] = result.base64;
        console.log(`[WebBuild:Images] ✅ ${item.fileName} (DALL-E 3 fallback)`);
        continue;
      }
    } catch (err) {
      console.warn(`[WebBuild:Images] DALL-E 3 also failed for ${item.fileName}: ${(err as Error).message}`);
    }

    console.warn(`[WebBuild:Images] ❌ Skipped ${item.fileName} — both providers failed`);
  }

  console.log(`[WebBuild:Images] Generated ${Object.keys(imageFiles).length}/${items.length} images`);
  return imageFiles;
}

interface WebsitePipelineProjectRef {
  repoFullName: string;
  owner: string;
  repoName: string;
  projectSlug: string;
  projectName: string;
  branch: string;
  isExisting: boolean;
  vercelProjectId?: string;
}

interface WebsitePipelineExecutionOptions {
  repairContext?: string;
  branchOverride?: string;
  commitMessage?: string;
  prTitle?: string;
  prBody?: string;
}

let websitePipelineToolCache: Map<string, ToolDefinition> | null = null;

interface WebBuildUpgradeParams {
  project_id: string;
  additional_context?: string;
}

type LighthouseStrategy = 'mobile' | 'desktop';

interface AutonomousLoopParams {
  project_id: string;
  goal: string;
  max_iterations?: number;
  viewport?: 'desktop' | 'tablet' | 'mobile';
  lighthouse_strategy?: LighthouseStrategy;
  min_performance?: number;
  min_accessibility?: number;
  min_best_practices?: number;
  min_seo?: number;
  stop_on_no_improvement?: boolean;
  include_screenshot?: boolean;
}

interface AutonomousLoopIteration {
  iteration: number;
  preview_url?: string;
  deploy_url?: string;
  github_pr_url?: string;
  lighthouse?: {
    strategy: LighthouseStrategy;
    scores: Record<string, number>;
    opportunities: Array<{ title: string; score: number; detail?: string }>;
  };
  screenshot?: {
    width?: number;
    height?: number;
    image?: string;
  };
  composite_score?: number;
  met_thresholds?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function pickString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function normalizeBrandContext(value: unknown): WebBrandContext {
  const input = asRecord(value);

  const visualStyle = pickString(input, 'visual_style');
  const animationPreference = pickString(input, 'animation_preference');

  const allowedVisualStyles: WebVisualStyle[] = ['minimal', 'bold', 'editorial', 'playful', 'dark_glass'];
  const allowedAnimationPrefs: WebAnimationPreference[] = ['none', 'subtle', 'rich'];

  return {
    brand_name: pickString(input, 'brand_name') ?? DEFAULT_BRAND_CONTEXT.brand_name,
    primary_color: pickString(input, 'primary_color') ?? DEFAULT_BRAND_CONTEXT.primary_color,
    secondary_color: pickString(input, 'secondary_color') ?? DEFAULT_BRAND_CONTEXT.secondary_color,
    accent_color: pickString(input, 'accent_color') ?? DEFAULT_BRAND_CONTEXT.accent_color,
    heading_font: pickString(input, 'heading_font') ?? DEFAULT_BRAND_CONTEXT.heading_font,
    body_font: pickString(input, 'body_font') ?? DEFAULT_BRAND_CONTEXT.body_font,
    visual_style: (visualStyle && allowedVisualStyles.includes(visualStyle as WebVisualStyle)
      ? visualStyle
      : DEFAULT_BRAND_CONTEXT.visual_style) as WebVisualStyle,
    animation_preference: (animationPreference && allowedAnimationPrefs.includes(animationPreference as WebAnimationPreference)
      ? animationPreference
      : DEFAULT_BRAND_CONTEXT.animation_preference) as WebAnimationPreference,
  };
}

function normalizeBuildTiers(input?: WebBuildTier[]): WebBuildTier[] {
  if (!Array.isArray(input) || input.length === 0) return [...ALL_BUILD_TIERS];
  const unique = new Set<WebBuildTier>();
  for (const tier of input) {
    if (ALL_BUILD_TIERS.includes(tier)) unique.add(tier);
  }
  if (unique.size === 0) return [...ALL_BUILD_TIERS];
  return [...unique];
}

function extractErrorMessage(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;

  const record = asRecord(value);
  const direct = pickString(record, 'error', 'message', 'detail', 'reason');
  if (direct) return direct;

  const nestedError = asRecord(record.error);
  const nested = pickString(nestedError, 'message', 'detail', 'reason');
  if (nested) return nested;

  return null;
}

function getWebsitePipelineOrgFromEnv(): string {
  return process.env.GITHUB_CLIENT_REPOS_ORG?.trim()
    || process.env.FUSE_GITHUB_CLIENT_REPOS_ORG?.trim()
    || 'Glyphor-Fuse';
}

/** Default: public glyphor site repo (feature branches + PRs). Override or clear via env. */
const DEFAULT_WEBSITE_FEATURE_BRANCH_REPOS = 'glyphor-adt/glyphor-site';

/**
 * POC / client template repos commit straight to `main` with no PR.
 * `WEBSITE_PIPELINE_FEATURE_BRANCH_REPOS`: comma-separated `owner/repo` list for feature-branch + PR flow.
 * If unset, defaults to {@link DEFAULT_WEBSITE_FEATURE_BRANCH_REPOS}. Set to empty string to disable.
 */
function shouldUseFeatureBranchWorkflow(repoFullName: string): boolean {
  const raw = process.env.WEBSITE_PIPELINE_FEATURE_BRANCH_REPOS;
  const listSource =
    raw === undefined || raw === null ? DEFAULT_WEBSITE_FEATURE_BRANCH_REPOS : raw.trim();
  if (!listSource) return false;
  const key = repoFullName.trim().toLowerCase();
  return listSource.split(',').some((part) => {
    const entry = part.trim().toLowerCase();
    return entry.length > 0 && entry === key;
  });
}

function buildAccountProfileOverride(brand: WebBrandContext): Record<string, unknown> {
  // Only include brand fields that have actual values — empty means
  // "derive from the brief" so the UX engineer chooses appropriate
  // colors/fonts for the specific project.
  const colors: Record<string, string> = {};
  if (brand.primary_color) colors.primary = brand.primary_color;
  if (brand.secondary_color) colors.secondary = brand.secondary_color;
  if (brand.accent_color) colors.accent = brand.accent_color;
  colors.background = '#0A0A0B';
  colors.foreground = '#FAFAFA';

  const typography: Record<string, string> = { scale: 'modular_1.25' };
  if (brand.heading_font) typography.headingFont = brand.heading_font;
  if (brand.body_font) typography.bodyFont = brand.body_font;

  return {
    ...(Object.keys(colors).length > 2 ? { brand_colors: colors } : {}),
    ...(Object.keys(typography).length > 1 ? { typography } : {}),
    visual_style: brand.visual_style,
    animation_preference: brand.animation_preference,
    ...(brand.brand_name ? { brand_name: brand.brand_name } : {}),
  };
}

function slugifyProjectName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48);
}

function buildUniqueSuffix(): string {
  return Date.now().toString(36).slice(-6);
}

function createBranchName(prefix: string): string {
  return `${prefix}-${buildUniqueSuffix()}`;
}

function extractProjectNameCandidate(brief: string, brand: WebBrandContext): string {
  if (brand.brand_name && brand.brand_name !== DEFAULT_BRAND_CONTEXT.brand_name) {
    return brand.brand_name;
  }

  const labeled = extractAfterLabel(brief, ['brand', 'brand name', 'company', 'company name', 'client', 'client name', 'product', 'product name']);
  if (labeled) {
    return labeled;
  }

  const quoted = brief.match(/"([^"]{3,80})"/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  const words = brief
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3)
    .slice(0, 4)
    .join(' ');

  return words || `website-${buildUniqueSuffix()}`;
}

function extractAfterLabel(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const regex = new RegExp(`${label}\\s*[:\\-]\\s*([^\\n]+)`, 'i');
    const match = text.match(regex);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function mapWebProjectType(projectType?: WebProjectType): 'marketing_page' | 'web_application' | 'fullstack_application' | undefined {
  switch (projectType) {
    case 'nextjs_fullstack':
    case 'fastapi_backend':
    case 'dbt_pipeline':
    case 'terraform_infra':
      return 'fullstack_application';
    case 'react_spa':
    case 'legacy_refactor':
      return 'web_application';
    default:
      return undefined;
  }
}

function parseProjectReference(projectId: string, tier: WebBuildTier): WebsitePipelineProjectRef {
  const trimmed = projectId.trim();
  let record = asRecord({});

  if (trimmed.startsWith('{')) {
    try {
      record = asRecord(JSON.parse(trimmed) as unknown);
    } catch {
      record = asRecord({});
    }
  }

  const repoFullName = pickString(record, 'repo', 'repo_full_name', 'project_id') ?? (trimmed.includes('/') ? trimmed : undefined);
  const owner = pickString(record, 'owner') ?? (repoFullName?.split('/')[0] || getWebsitePipelineOrgFromEnv());
  const repoName = pickString(record, 'repo_name', 'project_slug', 'project_name')
    ?? (repoFullName?.split('/')[1] || slugifyProjectName(trimmed));
  const projectSlug = pickString(record, 'project_slug', 'repo_name', 'project_name') ?? repoName;
  const projectName = pickString(record, 'project_name', 'repo_name') ?? repoName;
  const resolvedFullName = repoFullName ?? `${owner}/${repoName}`;
  const useFeatureBranch = shouldUseFeatureBranchWorkflow(resolvedFullName);

  return {
    repoFullName: resolvedFullName,
    owner,
    repoName,
    projectSlug,
    projectName,
    branch: useFeatureBranch
      ? (tier === 'iterate' ? createBranchName(ITERATION_BRANCH_PREFIX) : createBranchName(UPGRADE_BRANCH_PREFIX))
      : 'main',
    isExisting: true,
  };
}

function buildSyntheticProjectRef(
  candidateRepoName: string,
  params: WebBuildParams,
): WebsitePipelineProjectRef {
  const org = getWebsitePipelineOrgFromEnv();
  const repoFullName = `${org}/${candidateRepoName}`;
  const useFeatureBranch = shouldUseFeatureBranchWorkflow(repoFullName);
  return {
    repoFullName,
    owner: org,
    repoName: candidateRepoName,
    projectSlug: candidateRepoName,
    projectName: candidateRepoName,
    branch: useFeatureBranch
      ? (params.tier === 'prototype' ? DEFAULT_PROTOTYPE_BRANCH : DEFAULT_INITIAL_BRANCH)
      : 'main',
    isExisting: false,
  };
}

function shouldFallbackToDirectPipelineTool(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|not available|no such tool|unknown tool|implemented in application code|dynamic http executor|tool bundle includes/i.test(message);
}

function getWebsitePipelineTool(name: WebsitePipelineToolName): ToolDefinition {
  if (!websitePipelineToolCache) {
    websitePipelineToolCache = new Map<string, ToolDefinition>([
      ...createDesignBriefTools(),
      ...createBuildWebsiteFoundationTools(),
      ...createGithubFromTemplateTools(),
      ...createGithubPushFilesTools(),
      ...createGithubPullRequestTools(),
      ...createVercelProjectTools(),
      ...createCloudflarePreviewTools(),
    ].map((tool) => [tool.name, tool]));
  }

  const tool = websitePipelineToolCache.get(name);
  if (!tool) {
    throw new Error(`Website pipeline tool ${name} is not registered.`);
  }
  return tool;
}

async function executeWebsitePipelineTool<T>(
  toolName: WebsitePipelineToolName,
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<T> {
  if (ctx.executeChildTool) {
    try {
      return await ctx.executeChildTool(toolName, params) as T;
    } catch (error) {
      if (!shouldFallbackToDirectPipelineTool(error)) {
        throw error;
      }
    }
  }

  const tool = getWebsitePipelineTool(toolName);
  const result = await tool.execute(params, ctx);
  if (!result.success) {
    throw new Error(result.error ?? `Website pipeline tool ${toolName} failed.`);
  }
  return (result.data ?? null) as T;
}

async function provisionGithubAndVercel(
  candidate: string,
  ctx: ToolContext,
): Promise<{
  repoFullName: string;
  owner: string;
  repoName: string;
  projectName: string;
  vercelProjectId?: string;
}> {
  const repo = await executeWebsitePipelineTool<Record<string, unknown>>(
    'github_create_from_template',
    { repo_name: candidate },
    ctx,
  );
  const repoFullName = pickString(repo, 'full_name') ?? `${getWebsitePipelineOrgFromEnv()}/${candidate}`;
  const [owner, repoName] = repoFullName.split('/');
  const vercel = await executeWebsitePipelineTool<Record<string, unknown>>(
    'vercel_create_project',
    {
      repo_name: repoName,
      project_name: repoName,
      github_org: owner,
    },
    ctx,
  );
  return {
    repoFullName,
    owner,
    repoName,
    projectName: pickString(vercel, 'project_name') ?? repoName,
    vercelProjectId: pickString(vercel, 'project_id'),
  };
}

function buildBrandSpec(
  brief: string,
  normalizedBrief: Record<string, unknown>,
  brand: WebBrandContext,
  projectSlug: string,
  projectType?: WebProjectType,
): Record<string, unknown> {
  return {
    brandName: brand.brand_name,
    projectSlug,
    projectType: projectType ?? normalizedBrief.product_type ?? 'marketing_page',
    visualManifesto: normalizedBrief.aesthetic_direction ?? brief,
    signatureFeature: normalizedBrief.one_sentence_memory ?? brief,
    brandContext: brand,
    accountProfileOverride: buildAccountProfileOverride(brand),
  };
}

function buildIntakeContext(
  params: WebBuildParams,
  brand: WebBrandContext,
  project: WebsitePipelineProjectRef,
): Record<string, unknown> {
  return {
    raw_brief: params.brief,
    requested_tier: params.tier,
    requested_project_type: params.project_type ?? null,
    existing_project_id: params.project_id ?? null,
    repo: project.repoFullName,
    branch: project.branch,
    brand_context: brand,
  };
}

function buildPullRequestTitle(project: WebsitePipelineProjectRef, tier: WebBuildTier): string {
  return tier === 'full_build'
    ? `feat: ship ${project.projectName}`
    : `feat: update ${project.projectName}`;
}

function buildPullRequestBody(params: WebBuildParams, project: WebsitePipelineProjectRef): string {
  return [
    `Automated website pipeline build for ${project.projectName}.`,
    '',
    `Tier: ${params.tier}`,
    `Repo: ${project.repoFullName}`,
    '',
    'Brief:',
    params.brief,
  ].join('\n');
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timeout);
      reject(new Error('Agent aborted'));
    }

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForPreviewUrl(project: WebsitePipelineProjectRef, ctx: ToolContext): Promise<{ preview_url: string; state: string }> {
  for (let attempt = 0; attempt < PREVIEW_POLL_ATTEMPTS; attempt += 1) {
    const preview = await executeWebsitePipelineTool<Record<string, unknown>>(
      'vercel_get_preview_url',
      {
        project_id: project.vercelProjectId,
        project_name: project.projectName,
        branch: project.branch,
      },
      ctx,
    );

    const previewUrl = pickString(preview, 'preview_url', 'deployment_url');
    const state = pickString(preview, 'state') ?? 'UNKNOWN';
    if (previewUrl && state === 'READY') {
      return { preview_url: previewUrl, state };
    }

    if (attempt < PREVIEW_POLL_ATTEMPTS - 1) {
      await delay(PREVIEW_POLL_INTERVAL_MS, ctx.abortSignal);
    }
  }

  throw new Error(`Timed out waiting for Vercel preview deployment for ${project.projectName}.`);
}

async function waitForProductionUrl(project: WebsitePipelineProjectRef, ctx: ToolContext): Promise<{ production_url: string; state: string }> {
  for (let attempt = 0; attempt < PRODUCTION_POLL_ATTEMPTS; attempt += 1) {
    const production = await executeWebsitePipelineTool<Record<string, unknown>>(
      'vercel_get_production_url',
      {
        project_id: project.vercelProjectId,
        project_name: project.projectName,
      },
      ctx,
    );

    const productionUrl = pickString(production, 'production_url');
    const state = pickString(production, 'state') ?? 'UNKNOWN';
    if (productionUrl && state === 'READY') {
      return { production_url: productionUrl, state };
    }

    if (attempt < PRODUCTION_POLL_ATTEMPTS - 1) {
      await delay(PRODUCTION_POLL_INTERVAL_MS, ctx.abortSignal);
    }
  }

  throw new Error(`Timed out waiting for Vercel production deployment for ${project.projectName}.`);
}

async function executeWebBuild(
  params: WebBuildParams,
  ctx: ToolContext,
  options: WebsitePipelineExecutionOptions = {},
): Promise<WebBuildResult> {
  const brand = normalizeBrandContext(params.brand_context);
  const normalizedBrief = await executeWebsitePipelineTool<Record<string, unknown>>(
    'normalize_design_brief',
    {
      directive_text: params.brief,
      ...(mapWebProjectType(params.project_type) ? { product_type: mapWebProjectType(params.project_type) } : {}),
    },
    ctx,
  );

  let project!: WebsitePipelineProjectRef;
  let foundation!: Record<string, unknown>;

  if (params.project_id?.trim()) {
    project = parseProjectReference(params.project_id.trim(), params.tier);
    const useFeatureBranch = shouldUseFeatureBranchWorkflow(project.repoFullName);
    if (useFeatureBranch && options.branchOverride?.trim()) {
      project = { ...project, branch: options.branchOverride.trim() };
    }
    if (!useFeatureBranch) {
      project = { ...project, branch: 'main' };
    }
    foundation = await executeWebsitePipelineTool<Record<string, unknown>>(
      'build_website_foundation',
      {
        normalized_brief: normalizedBrief,
        brand_spec: buildBrandSpec(params.brief, normalizedBrief, brand, project.projectSlug, params.project_type),
        intake_context: buildIntakeContext(params, brand, project),
        ...(options.repairContext ? { repair_context: options.repairContext } : {}),
      },
      ctx,
    );
  } else {
    const projectBaseName = slugifyProjectName(extractProjectNameCandidate(params.brief, brand)) || `website-${buildUniqueSuffix()}`;
    const repoCandidates = [projectBaseName, `${projectBaseName}-${buildUniqueSuffix()}`];
    let lastError: Error | null = null;
    let provisioned = false;

    for (const candidate of repoCandidates) {
      try {
        let workProject = buildSyntheticProjectRef(candidate, params);
        const useFeatureBranch = shouldUseFeatureBranchWorkflow(workProject.repoFullName);
        if (useFeatureBranch && options.branchOverride?.trim()) {
          workProject = { ...workProject, branch: options.branchOverride.trim() };
        }
        if (!useFeatureBranch) {
          workProject = { ...workProject, branch: 'main' };
        }

        foundation = await executeWebsitePipelineTool<Record<string, unknown>>(
          'build_website_foundation',
          {
            normalized_brief: normalizedBrief,
            brand_spec: buildBrandSpec(params.brief, normalizedBrief, brand, workProject.projectSlug, params.project_type),
            intake_context: buildIntakeContext(params, brand, workProject),
            ...(options.repairContext ? { repair_context: options.repairContext } : {}),
          },
          ctx,
        );

        const prePushFiles = asRecord(foundation.files);
        assertValidWebsiteFileMap(prePushFiles);

        const pv = await provisionGithubAndVercel(candidate, ctx);
        project = {
          repoFullName: pv.repoFullName,
          owner: pv.owner,
          repoName: pv.repoName,
          projectSlug: pv.repoName,
          projectName: pv.projectName,
          branch: workProject.branch,
          isExisting: false,
          vercelProjectId: pv.vercelProjectId,
        };
        provisioned = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!/already exists/i.test(lastError.message)) {
          throw lastError;
        }
      }
    }

    if (!provisioned) {
      throw lastError ?? new Error('Failed to provision website project.');
    }

    // Wait for GitHub to initialize the template repo's default branch.
    // Template repos can take 3-10s before the main branch is available.
    await new Promise(resolve => setTimeout(resolve, 8_000));
  }

  const useFeatureBranch = shouldUseFeatureBranchWorkflow(project.repoFullName);

  const files = asRecord(foundation.files) as Record<string, string>;
  assertValidWebsiteFileMap(files);
  const push = await executeWebsitePipelineTool<Record<string, unknown>>(
    'github_push_files',
    {
      repo: project.repoFullName,
      branch: project.branch,
      files,
      commit_message: options.commitMessage
        ?? (params.tier === 'iterate' ? 'feat: apply website iteration' : 'feat: website pipeline build'),
    },
    ctx,
  );

  const preview = await waitForPreviewUrl(project, ctx);
  const previewRegistration = await executeWebsitePipelineTool<Record<string, unknown>>(
    project.isExisting || params.tier === 'iterate' ? 'cloudflare_update_preview' : 'cloudflare_register_preview',
    {
      project_slug: project.projectSlug,
      vercel_deployment_url: preview.preview_url,
      github_repo_url: `https://github.com/${project.repoFullName}`,
      project_name: project.projectName,
    },
    ctx,
  );

  // ─── IMAGE GENERATION FROM MANIFEST ─────────────────────────
  // After sandbox passes and preview is live, generate images from
  // the manifest and push them to the repo. This is fire-and-forget
  // safe — if image gen fails, the site still works with broken image refs.
  if (foundation.image_manifest && foundation.image_manifest.length > 0) {
    try {
      const imageFiles = await generateImagesFromManifest(
        foundation.image_manifest,
        ctx,
      );
      if (Object.keys(imageFiles).length > 0) {
        await executeWebsitePipelineTool(
          'github_push_files',
          {
            repo: project.repoFullName,
            branch: project.branch,
            files: imageFiles,
            commit_message: `feat: add ${Object.keys(imageFiles).length} generated images`,
          },
          ctx,
        );
        console.log(`[WebBuild] Pushed ${Object.keys(imageFiles).length} generated images to ${project.branch}`);
      }
    } catch (imgErr) {
      console.warn(`[WebBuild] Image generation failed (non-blocking): ${(imgErr as Error).message}`);
    }
  }

  let githubPrUrl: string | undefined;
  let deployUrl = preview.preview_url;
  let production: Record<string, unknown> | null = null;
  let pullRequest: Record<string, unknown> | null = null;
  let merge: Record<string, unknown> | null = null;
  let checks: Record<string, unknown> | null = null;

  if (useFeatureBranch) {
    pullRequest = await executeWebsitePipelineTool<Record<string, unknown>>(
      'github_create_pull_request',
      {
        repo: project.repoFullName,
        head_branch: project.branch,
        base_branch: 'main',
        title: options.prTitle ?? buildPullRequestTitle(project, params.tier),
        body: options.prBody ?? buildPullRequestBody(params, project),
        draft: params.tier !== 'full_build',
      },
      ctx,
    );
    githubPrUrl = pickString(pullRequest, 'pr_url');
  }

  if (params.tier === 'full_build') {
    const prNumber = Number(pullRequest?.pr_number ?? 0);
    if (useFeatureBranch && prNumber > 0) {
      checks = await executeWebsitePipelineTool<Record<string, unknown>>(
        'github_wait_for_pull_request_checks',
        {
          repo: project.repoFullName,
          pr_number: prNumber,
          timeout_seconds: 900,
          poll_interval_seconds: 15,
        },
        ctx,
      );

      merge = await executeWebsitePipelineTool<Record<string, unknown>>(
        'github_merge_pull_request',
        {
          repo: project.repoFullName,
          pr_number: prNumber,
          merge_method: 'squash',
        },
        ctx,
      );
    }

    production = await waitForProductionUrl(project, ctx);
    deployUrl = pickString(production, 'production_url') ?? deployUrl;
  }

  const repositoryHint = useFeatureBranch
    ? [
        `Generated website code was pushed to branch "${project.branch}" in ${project.repoFullName}.`,
        githubPrUrl
          ? `Open this pull request to review and merge into main: ${githubPrUrl}`
          : 'A pull request was created toward main — open it from the GitHub repo if you do not see new files on the default branch.',
        'If you only viewed the default branch (usually main), you may still see the original template until the PR is merged.',
      ].join(' ')
    : [
        `Generated website code was committed on "${project.branch}" in ${project.repoFullName}.`,
        'No feature branch or pull request was opened (standard POC flow). Open the repo default branch to see the generated app.',
      ].join(' ');

  const githubBranchUrl = `https://github.com/${project.repoFullName}/tree/${encodeURIComponent(project.branch)}`;
  const userNextSteps = useFeatureBranch
    ? [
        'Where to see the new code (feature-branch repo):',
        githubPrUrl ? `1) Open the PR: ${githubPrUrl}` : `1) Open GitHub and create/find the PR from branch "${project.branch}" → main.`,
        `2) Or browse the branch: ${githubBranchUrl}`,
        '3) `main` may still show the template until you merge — that is expected.',
      ].join('\n')
    : [
        'Where to see the new code:',
        `1) Browse branch "${project.branch}": ${githubBranchUrl}`,
        `2) Preview: ${pickString(previewRegistration, 'preview_url') ?? preview.preview_url ?? '(see preview_url in result)'}`,
      ].join('\n');

  return {
    project_id: project.repoFullName,
    preview_url: pickString(previewRegistration, 'preview_url') ?? preview.preview_url,
    deploy_url: deployUrl,
    github_pr_url: githubPrUrl,
    source_branch: project.branch,
    repository_hint: repositoryHint,
    github_branch_url: githubBranchUrl,
    user_next_steps: userNextSteps,
    build_report: {
      normalized_brief: normalizedBrief,
      architectural_reasoning: foundation.architectural_reasoning ?? null,
      design_plan: foundation.design_plan ?? null,
      image_manifest: foundation.image_manifest ?? [],
      github: {
        repo: project.repoFullName,
        branch: project.branch,
        commit_sha: pickString(push, 'commit_sha'),
        branch_url: pickString(push, 'branch_url'),
        pull_request: pullRequest,
        checks,
        merge,
      },
      vercel: {
        project_id: project.vercelProjectId ?? null,
        project_name: project.projectName,
        preview,
        production,
      },
      cloudflare: previewRegistration,
    },
    agent_trace: {
      pipeline: [
        'normalize_design_brief',
        'build_website_foundation',
        ...(project.isExisting ? [] : ['github_create_from_template', 'vercel_create_project']),
        'github_push_files',
        'vercel_get_preview_url',
        project.isExisting || params.tier === 'iterate' ? 'cloudflare_update_preview' : 'cloudflare_register_preview',
        ...(useFeatureBranch ? ['github_create_pull_request'] : []),
        ...(params.tier === 'full_build' && useFeatureBranch
          ? ['github_wait_for_pull_request_checks', 'github_merge_pull_request', 'vercel_get_production_url']
          : params.tier === 'full_build'
            ? ['vercel_get_production_url']
            : []),
      ],
    },
    tier_used: params.tier,
    raw: {
      project,
      foundation,
      push,
      preview,
      previewRegistration,
      pullRequest,
      checks,
      merge,
      production,
    },
  };
}

async function executeWebBuildUpgrade(params: WebBuildUpgradeParams, ctx: ToolContext): Promise<WebBuildResult> {
  const upgradeBrief = [
    `Upgrade the existing website project ${params.project_id} into a production-ready build.`,
    'Preserve the established product purpose and brand unless the new requirements explicitly change them.',
    params.additional_context?.trim() || 'Harden the implementation, complete QA expectations, and ship the result to production.',
  ].join(' ');

  return executeWebBuild({
    brief: upgradeBrief,
    tier: 'full_build',
    project_id: params.project_id,
  }, ctx, {
    branchOverride: createBranchName(UPGRADE_BRANCH_PREFIX),
    commitMessage: 'feat: upgrade website build',
    prTitle: `feat: upgrade ${params.project_id}`,
    prBody: params.additional_context?.trim()
      ? `Upgrade request:\n\n${params.additional_context.trim()}`
      : `Upgrade ${params.project_id} to a production-ready website build.`,
  });
}

function truncateSummary(input: string): string {
  const clean = input.trim().replace(/\s+/g, ' ');
  return clean.length > 90 ? `${clean.slice(0, 87)}...` : clean;
}

function clampIterations(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.min(6, Math.max(1, Math.floor(parsed)));
}

function clampThreshold(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, Math.floor(parsed)));
}

async function capturePreviewScreenshot(
  url: string,
  viewport: 'desktop' | 'tablet' | 'mobile',
  includeImage: boolean,
): Promise<{ width?: number; height?: number; image?: string }> {
  const viewportMap: Record<'desktop' | 'tablet' | 'mobile', { width: number; height: number }> = {
    desktop: { width: 1440, height: 900 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 375, height: 812 },
  };
  const res = await fetch(`${getPlaywrightServiceUrl()}/screenshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      viewport: viewportMap[viewport],
      full_page: true,
      wait_for: 'networkidle',
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    throw new Error(`Screenshot service returned ${res.status}: ${await res.text()}`);
  }
  const data = await res.json() as Record<string, unknown>;
  return {
    width: typeof data.width === 'number' ? data.width : undefined,
    height: typeof data.height === 'number' ? data.height : undefined,
    image: includeImage && typeof data.image === 'string' ? data.image : undefined,
  };
}

async function runLighthouseAudit(url: string, strategy: LighthouseStrategy): Promise<{
  strategy: LighthouseStrategy;
  scores: Record<string, number>;
  opportunities: Array<{ title: string; score: number; detail?: string }>;
}> {
  const encodedUrl = encodeURIComponent(url);
  const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodedUrl}&strategy=${strategy}&category=performance&category=accessibility&category=best-practices&category=seo`;
  const res = await fetch(apiUrl, { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) {
    throw new Error(`PageSpeed API returned ${res.status}`);
  }
  const json = await res.json() as Record<string, unknown>;
  const cats = (json.lighthouseResult as Record<string, unknown>)?.categories as Record<string, { score: number; title: string }> | undefined;
  const audits = (json.lighthouseResult as Record<string, unknown>)?.audits as Record<string, { score: number | null; title: string; displayValue?: string }> | undefined;
  if (!cats) {
    throw new Error('Unexpected PageSpeed response format');
  }
  const scores = Object.fromEntries(
    Object.entries(cats).map(([key, value]) => [key, Math.round((value.score ?? 0) * 100)]),
  );
  const opportunities = audits
    ? Object.values(audits)
      .filter((a) => a.score !== null && a.score < 0.9 && a.displayValue)
      .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
      .slice(0, 8)
      .map((a) => ({ title: a.title, score: Math.round((a.score ?? 0) * 100), detail: a.displayValue }))
    : [];
  return { strategy, scores, opportunities };
}

function normalizeLighthouseScores(scores: Record<string, number>): Record<string, number> {
  return {
    performance: Number(scores.performance ?? 0),
    accessibility: Number(scores.accessibility ?? 0),
    best_practices: Number(scores['best-practices'] ?? scores.best_practices ?? 0),
    seo: Number(scores.seo ?? 0),
  };
}

function computeCompositeScore(scores: Record<string, number>): number {
  const normalized = normalizeLighthouseScores(scores);
  return Math.round((normalized.performance + normalized.accessibility + normalized.best_practices + normalized.seo) / 4);
}

function meetsLighthouseThresholds(
  scores: Record<string, number>,
  thresholds: { performance: number; accessibility: number; best_practices: number; seo: number },
): boolean {
  const normalized = normalizeLighthouseScores(scores);
  return normalized.performance >= thresholds.performance
    && normalized.accessibility >= thresholds.accessibility
    && normalized.best_practices >= thresholds.best_practices
    && normalized.seo >= thresholds.seo;
}

export function createWebBuildTools(memory: CompanyMemoryStore, policy: WebBuildToolPolicy = {}): ToolDefinition[] {
  const allowBuild = policy.allowBuild !== false;
  const allowIterate = policy.allowIterate !== false;
  const allowUpgrade = policy.allowUpgrade !== false;
  const allowAutonomousLoop = policy.allowAutonomousLoop !== false;
  const allowedBuildTiers = normalizeBuildTiers(policy.allowedBuildTiers);
  const tools: ToolDefinition[] = [];

  if (allowBuild) {
    tools.push({
      name: 'invoke_web_build',
      description:
        'Full website pipeline with GitHub repo + Vercel deployment. **Use only for multi-file client projects that need a hosted preview URL.** '
        + 'For simple dashboards, demos, tools, or data visualizations, use `quick_demo_web_app` instead (faster, no repo needed). '
        + 'This tool normalizes the brief, generates all source files via UX-engineer pass, creates the GitHub repo + Vercel project, pushes code, and returns a preview URL. '
        + 'Can take 5-15 minutes. Only appropriate for real project deliverables, not quick chat requests.',
      parameters: {
        brief: {
          type: 'string',
          description: 'Detailed description of what to build: purpose, audience, functionality, visual direction, content requirements, and technical constraints.',
          required: true,
        },
        tier: {
          type: 'string',
          enum: allowedBuildTiers,
          description: 'prototype: fast preview, full_build: full QA/deploy pipeline, iterate: targeted modifications to an existing web project.',
          required: true,
        },
        project_type: {
          type: 'string',
          enum: ['react_spa', 'nextjs_fullstack', 'fastapi_backend', 'legacy_refactor', 'dbt_pipeline', 'terraform_infra'],
          description: 'Optional project type hint for auto-routing.',
        },
        project_id: {
          type: 'string',
          description: 'Required when tier is iterate. Existing project ID to modify.',
        },
        brand_context: {
          type: 'object',
          description: 'Optional brand identity override. If omitted, Glyphor defaults are injected.',
          properties: {
            brand_name: { type: 'string', description: 'Brand name' },
            primary_color: { type: 'string', description: 'Primary brand color (hex)' },
            secondary_color: { type: 'string', description: 'Secondary brand color (hex)' },
            accent_color: { type: 'string', description: 'Accent color (hex)' },
            heading_font: { type: 'string', description: 'Heading font family' },
            body_font: { type: 'string', description: 'Body font family' },
            visual_style: { type: 'string', enum: ['minimal', 'bold', 'editorial', 'playful', 'dark_glass'], description: 'Visual style profile' },
            animation_preference: { type: 'string', enum: ['none', 'subtle', 'rich'], description: 'Animation intensity' },
          },
        },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const brief = String(params.brief ?? '').trim();
        if (!brief) {
          return { success: false, error: 'Parameter "brief" is required.' };
        }

        const tier = String(params.tier ?? '').trim() as WebBuildTier;
        if (!allowedBuildTiers.includes(tier)) {
          return { success: false, error: `Tier "${tier}" is not permitted for this agent. Allowed: ${allowedBuildTiers.join(', ')}` };
        }

        if (tier === 'iterate' && !String(params.project_id ?? '').trim()) {
          return { success: false, error: 'Parameter "project_id" is required when tier is "iterate".' };
        }

        try {
          const result = await executeWebBuild({
            brief,
            tier,
            project_type: params.project_type as WebProjectType | undefined,
            project_id: params.project_id as string | undefined,
            brand_context: params.brand_context as Partial<WebBrandContext> | undefined,
          }, ctx, tier === 'iterate'
            ? {
                repairContext: brief,
                branchOverride: createBranchName(ITERATION_BRANCH_PREFIX),
                commitMessage: 'feat: apply website iteration',
              }
            : (params.project_id && tier === 'full_build')
                ? {
                    branchOverride: createBranchName(UPGRADE_BRANCH_PREFIX),
                    commitMessage: 'feat: refresh website build',
                  }
                : undefined);

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `Web build ${tier}: ${truncateSummary(brief)}`,
            createdAt: new Date().toISOString(),
          });

          return { success: true, data: result };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    });
  }

  if (allowIterate) {
    tools.push({
      name: 'invoke_web_iterate',
      description: 'Modify an existing website project using the Glyphor website pipeline. The system regenerates the build on a fresh branch, redeploys preview, and returns the updated preview URL.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'Project ID from a previous build.',
          required: true,
        },
        changes: {
          type: 'string',
          description: 'Detailed change request describing sections, components, and behavior to modify.',
          required: true,
        },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const projectId = String(params.project_id ?? '').trim();
        const changes = String(params.changes ?? '').trim();
        if (!projectId) return { success: false, error: 'Parameter "project_id" is required.' };
        if (!changes) return { success: false, error: 'Parameter "changes" is required.' };

        try {
          const result = await executeWebBuild({
            brief: `Update the existing website project ${projectId}. Preserve the current product purpose and brand unless the requested changes explicitly replace them. Requested changes: ${changes}`,
            tier: 'iterate',
            project_id: projectId,
          }, ctx, {
            repairContext: changes,
            branchOverride: createBranchName(ITERATION_BRANCH_PREFIX),
            commitMessage: 'feat: apply website iteration',
          });

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `Web iterate ${projectId}: ${truncateSummary(changes)}`,
            createdAt: new Date().toISOString(),
          });

          return { success: true, data: result };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    });
  }

  if (allowIterate && allowAutonomousLoop) {
    tools.push({
      name: 'invoke_web_coding_loop',
      description: 'Run a Claude-style autonomous coding loop for an existing web project: iterate code, wait for preview, screenshot, run Lighthouse, and continue until thresholds are met or the iteration budget is exhausted.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'Existing project ID to iterate on.',
          required: true,
        },
        goal: {
          type: 'string',
          description: 'The concrete coding objective to accomplish over multiple iterations.',
          required: true,
        },
        max_iterations: {
          type: 'number',
          description: 'Maximum iteration rounds (1-6). Defaults to 3.',
        },
        viewport: {
          type: 'string',
          enum: ['desktop', 'tablet', 'mobile'],
          description: 'Viewport used for screenshot capture. Defaults to desktop.',
        },
        lighthouse_strategy: {
          type: 'string',
          enum: ['desktop', 'mobile'],
          description: 'Lighthouse strategy. Defaults to desktop.',
        },
        min_performance: { type: 'number', description: 'Minimum Lighthouse performance score (0-100). Default 75.' },
        min_accessibility: { type: 'number', description: 'Minimum Lighthouse accessibility score (0-100). Default 85.' },
        min_best_practices: { type: 'number', description: 'Minimum Lighthouse best-practices score (0-100). Default 85.' },
        min_seo: { type: 'number', description: 'Minimum Lighthouse SEO score (0-100). Default 85.' },
        stop_on_no_improvement: {
          type: 'boolean',
          description: 'Stop early if composite Lighthouse score is flat or lower on a later round. Defaults to true.',
        },
        include_screenshot: {
          type: 'boolean',
          description: 'Include base64 screenshot image in each iteration result. Defaults to false to reduce payload size.',
        },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const input: AutonomousLoopParams = {
          project_id: String(params.project_id ?? '').trim(),
          goal: String(params.goal ?? '').trim(),
          max_iterations: params.max_iterations as number | undefined,
          viewport: (params.viewport as 'desktop' | 'tablet' | 'mobile' | undefined) ?? 'desktop',
          lighthouse_strategy: (params.lighthouse_strategy as LighthouseStrategy | undefined) ?? 'desktop',
          min_performance: params.min_performance as number | undefined,
          min_accessibility: params.min_accessibility as number | undefined,
          min_best_practices: params.min_best_practices as number | undefined,
          min_seo: params.min_seo as number | undefined,
          stop_on_no_improvement: params.stop_on_no_improvement as boolean | undefined,
          include_screenshot: params.include_screenshot as boolean | undefined,
        };

        if (!input.project_id) return { success: false, error: 'Parameter "project_id" is required.' };
        if (!input.goal) return { success: false, error: 'Parameter "goal" is required.' };
        const viewport = input.viewport ?? 'desktop';
        const lighthouseStrategy = input.lighthouse_strategy ?? 'desktop';
        if (!['desktop', 'tablet', 'mobile'].includes(viewport)) return { success: false, error: 'Parameter "viewport" must be desktop, tablet, or mobile.' };
        if (!['desktop', 'mobile'].includes(lighthouseStrategy)) return { success: false, error: 'Parameter "lighthouse_strategy" must be desktop or mobile.' };

        const maxIterations = clampIterations(input.max_iterations);
        const stopOnNoImprovement = input.stop_on_no_improvement !== false;
        const includeScreenshot = input.include_screenshot === true;
        const thresholds = {
          performance: clampThreshold(input.min_performance, 75),
          accessibility: clampThreshold(input.min_accessibility, 85),
          best_practices: clampThreshold(input.min_best_practices, 85),
          seo: clampThreshold(input.min_seo, 85),
        };

        const iterations: AutonomousLoopIteration[] = [];
        let converged = false;
        let stopReason = 'iteration_budget_reached';
        let previousComposite: number | null = null;
        let lastResult: WebBuildResult | null = null;

        try {
          for (let index = 0; index < maxIterations; index += 1) {
            const iterationNumber = index + 1;
            const iterationPrompt = [
              `Iteration ${iterationNumber}/${maxIterations} for project ${input.project_id}.`,
              `Primary coding goal: ${input.goal}`,
              'Return a materially improved implementation that remains brand-consistent and production-safe.',
            ].join(' ');
            const webResult = await executeWebBuild({
              brief: `Update the existing website project ${input.project_id}. ${iterationPrompt}`,
              tier: 'iterate',
              project_id: input.project_id,
            }, ctx, {
              repairContext: `${input.goal}\nRound ${iterationNumber} of ${maxIterations}.`,
              branchOverride: createBranchName(ITERATION_BRANCH_PREFIX),
              commitMessage: `feat: autonomous web coding loop round ${iterationNumber}`,
            });
            lastResult = webResult;

            const previewUrl = webResult.preview_url ?? webResult.deploy_url;
            if (!previewUrl) {
              throw new Error('Website pipeline returned no preview URL for iteration loop.');
            }

            const [screenshot, lighthouse] = await Promise.all([
              capturePreviewScreenshot(previewUrl, viewport, includeScreenshot),
              runLighthouseAudit(previewUrl, lighthouseStrategy),
            ]);
            const compositeScore = computeCompositeScore(lighthouse.scores);
            const metThresholds = meetsLighthouseThresholds(lighthouse.scores, thresholds);

            iterations.push({
              iteration: iterationNumber,
              preview_url: webResult.preview_url,
              deploy_url: webResult.deploy_url,
              github_pr_url: webResult.github_pr_url,
              screenshot,
              lighthouse,
              composite_score: compositeScore,
              met_thresholds: metThresholds,
            });

            if (metThresholds) {
              converged = true;
              stopReason = 'thresholds_met';
              break;
            }

            if (stopOnNoImprovement && previousComposite !== null && compositeScore <= previousComposite) {
              stopReason = 'no_improvement';
              break;
            }
            previousComposite = compositeScore;
          }

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `Web coding loop ${input.project_id}: ${converged ? 'converged' : stopReason}`,
            createdAt: new Date().toISOString(),
          });

          return {
            success: true,
            data: {
              project_id: input.project_id,
              goal: input.goal,
              converged,
              stop_reason: stopReason,
              thresholds,
              iterations,
              latest_preview_url: lastResult?.preview_url,
              latest_deploy_url: lastResult?.deploy_url,
              latest_github_pr_url: lastResult?.github_pr_url,
            },
          };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    });
  }

  if (allowUpgrade) {
    tools.push({
      name: 'invoke_web_upgrade',
      description: 'Upgrade an existing website project to a full production build using the Glyphor website pipeline, including PR promotion and production deployment verification.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'Prototype project ID to upgrade.',
          required: true,
        },
        additional_context: {
          type: 'string',
          description: 'Optional production requirements: SEO, real copy/assets, performance targets, or deployment constraints.',
        },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const projectId = String(params.project_id ?? '').trim();
        const additionalContext = String(params.additional_context ?? '').trim();
        if (!projectId) return { success: false, error: 'Parameter "project_id" is required.' };

        try {
          const result = await executeWebBuildUpgrade({
            project_id: projectId,
            additional_context: additionalContext || undefined,
          }, ctx);

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'company',
            summary: `Web upgrade ${projectId}${additionalContext ? `: ${truncateSummary(additionalContext)}` : ''}`,
            createdAt: new Date().toISOString(),
          });

          return { success: true, data: result };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    });
  }

  return tools;
}

const DEFAULT_WEBSITE_FOUNDATION_MODEL = process.env.UX_ENGINEER_MODEL?.trim() || 'gpt-5.4';
const WEBSITE_FOUNDATION_REPAIR_MODEL = process.env.UX_ENGINEER_REPAIR_MODEL?.trim() || 'gpt-5.4-mini';
const WEBSITE_FOUNDATION_MAX_TOKENS = 100000;
const WEBSITE_FOUNDATION_MAX_TOOL_ROUNDS = 4;
const SANDBOX_MAX_REPAIR_ROUNDS = 3;

/** After full-JSON sandbox repairs exhaust, try Claude Code–style targeted file patches (0 = off). */
function incrementalPatchMaxRounds(): number {
  const raw = process.env.WEB_BUILD_INCREMENTAL_PATCH_ROUNDS?.trim();
  if (raw === '0' || raw === 'false') return 0;
  const n = raw ? Number(raw) : 3;
  if (!Number.isFinite(n) || n < 0) return 3;
  return Math.min(8, Math.floor(n));
}

const UX_ENGINEER_SYSTEM_PROMPT = `
ROLE: You are a world-class design engineer. You receive a creative brief and build a complete,
production-ready website. You output COMPLETE, PRODUCTION-READY code. No stubs. No placeholders.
No TODOs. Every file you write must contain its full, working implementation.

OUTPUT RULE:
Respond ONLY with a valid JSON object matching the schema at the end of this prompt.
Do not wrap in markdown code fences. Do not include any text before or after the JSON.
You MAY call the provided MCP lookup tools (search_components, get_component_info,
get_installation_info) before producing your final JSON output — use them to verify
component APIs before writing code. After your lookups, produce the JSON output.

TEMPLATE STACK (Non-Negotiable):
- React 18 + Vite + TypeScript
- Tailwind CSS v4 (CSS-first, @theme inline token bridge in tailwind.css)
- shadcn/ui new-york style (imports from @/components/ui/<name>)
- ReactBits Pro via @reactbits-pro registry (if used: install_item_from_registry first)
- Aceternity via @aceternity registry (structural anchors only, max 2 per page)
- Framer Motion (transitions, hover states, scroll animations)
- lucide-react for icons (NEVER emoji as icons)
- Google Fonts (load in index.html <head>)

DO NOT create or modify: vite.config.ts, src/main.tsx, tsconfig.json, tsconfig.app.json,
tsconfig.node.json, vercel.json, eslint.config.js.
DO NOT create src/pages/ — everything composes in src/App.tsx.

DESIGN PRIORITY (MANDATORY):
- Create STUNNING, scroll-stopping designs that feel premium and intentional
- Bold typography: mix weights dramatically (font-thin with font-black), oversized headlines
- Subtle choreography: fade-ins, parallax hints, magnetic hover, scroll-driven reveals
- Glass morphism, gradients, and layered depth where appropriate
- Never generic, never boring, never template-like
- Icon discipline: lucide-react with explicit size classes, token-safe colors
- Colors must match the BUSINESS (landscaping → earthy greens, bakery → warm tones, tech → clean blues). Do NOT default to dark mode for every project.

LAYOUT AND COMPOSITION:
- Avoid standard SaaS layouts, predictable grids, interchangeable card sections
- Use asymmetry, strong negative space, confident vertical rhythm
- Treat each section as a visual moment, not a reusable block
- Let the layout breathe and guide the eye naturally

TYPOGRAPHY MASTERY:
- Headlines: text-5xl to text-8xl, font-black or font-bold, commanding
- Mix weights dramatically — combine extremes for visual tension
- Letter-spacing and line-height tuned explicitly (tracking-tight, leading-none etc)
- Create clear hierarchy through size, weight, and color contrast

BRAND LOGO (TEXT-ONLY WORDMARK):
- Create a typographic wordmark using real text (the brand name), NOT an image
- Use font/tracking/weight utility classes only
- NEVER reference /images/logo* in components or image_manifest
- Place in navbar and footer minimum

COMPONENT SELECTION HIERARCHY:
1. shadcn/ui — ALL functional UI primitives (buttons, inputs, nav, cards, tabs, dialogs)
2. ReactBits Pro (@reactbits-pro) — motion and ambient effects ONLY
3. Aceternity (@aceternity) — cinematic structural anchors ONLY
4. Framer Motion — transitions, hover states, scroll-driven animations

NEVER stack two animation libraries on the same section.
NEVER use ReactBits/Aceternity for functional UI primitives.

TOKEN-FIRST COLORS (HARD RULES):
- ALL colors MUST go through CSS variables via Tailwind token classes
- Use: bg-background, bg-card, bg-muted, bg-primary, bg-accent, bg-secondary
       text-foreground, text-muted-foreground, text-primary-foreground, text-accent-foreground
       border-border, ring-ring
- HARD BAN: no hardcoded hex/rgb/hsl/oklch in className strings or inline styles
- HARD BAN: no text-white, text-black, bg-white, bg-black, from-slate, to-zinc
- For opacity: use token opacity variants — text-foreground/80, bg-card/70, border-border/60

COLOR COMPOSITION (70/20/10 — MANDATORY):
- 70% neutral surfaces: bg-background, bg-card, bg-muted
- 20% supporting contrast: secondary, border emphasis, text hierarchy
- 10% accent/CTA: primary, accent — CTAs, active states, key highlights ONLY
- Never use primary or accent as full-section backgrounds
- At least 60% of sections must use neutral surface tokens
- Use at least 3 distinct section surfaces for visual rhythm
- Do not repeat the same dominant surface on 3+ adjacent sections

IMAGE/VISUAL ASSETS (CRITICAL):
- Reference images as /images/... (never public/images/...)
- Every referenced /images/* path MUST have a matching entry in image_manifest
- Maximum 7 unique /images/* paths across ALL files in a single build
- Image prompts format: [Subject] [Context] [Lighting] [Materials] [Mood] [Style]
- Images must be RELEVANT to the specific business — no generic stock
- Reuse images across sections instead of creating new ones for every card/testimonial
- Product/brand logo must remain text-based wordmark (no image asset)
- Text over images requires overlay/gradient for readability
- Plan the image budget BEFORE writing components: decide all paths first, then reuse

IMAGE BUDGET CONTRACT (HARD):
1. Decide the COMPLETE image budget before writing components
2. Create image_manifest first, then reuse ONLY those fileName paths in components
3. Do not invent extra image paths later in sections/cards
4. Reuse assets across sections (gallery/testimonials) instead of adding new files
5. If you need more visuals than budget allows, repeat existing paths intentionally

VIDEO RULES:
- NEVER include video_manifest unless the brief EXPLICITLY mentions video, animation, or motion background
- If video is requested: max 2 videos, always add overlay for text readability
- Reference videos as /videos/... (never public/videos/...)

SCROLLBAR POLISH (Always Apply):
In src/styles/tailwind.css @layer base:
  * { scrollbar-width: none; -ms-overflow-style: none; }
  *::-webkit-scrollbar { display: none; }

FILE CONTRACT (MECHANICAL — FOLLOW EXACTLY):
Create these files from scratch with COMPLETE content:
1. index.html — HTML shell with meta/OG tags, <div id="root"></div>, <script type="module" src="/src/main.tsx"></script>
   Load Google Fonts in <head> with preconnect + stylesheet link
2. src/App.tsx — Root composition: QueryClient, Toaster, TooltipProvider. Import and render ALL section components.
   Import: import { Toaster } from "@/components/ui/sonner";
   DO NOT create src/pages/. Everything composes in App.tsx.
3. src/styles/theme.css — :root and .dark blocks with CSS variable values ONLY.
   REQUIRED vars: --background, --foreground, --card, --card-foreground, --popover, --popover-foreground,
   --primary, --primary-foreground, --secondary, --secondary-foreground, --muted, --muted-foreground,
   --accent, --accent-foreground, --destructive, --destructive-foreground, --border, --input, --ring, --radius.
   Use explicit color syntax (hex, rgb(), hsl(), oklch()). No raw HSL tuples.
   NO @theme inline, @layer base, or @import here.
4. src/styles/fonts.css — Define font variables only (NO external @import). Keep family names unquoted.
5. src/styles/index.css — Import hub: @import "./fonts.css"; @import "./tailwind.css"; @import "./theme.css";
6. src/styles/tailwind.css — @import "tailwindcss"; then @source "../**/*.{js,ts,jsx,tsx}"; then @custom-variant dark; then @theme inline token bridge; then @layer base typography + body styles; then @layer utilities font helpers.
7. src/components/*.tsx — All section components with COMPLETE implementations

BEFORE PRODUCING OUTPUT, VERIFY:
- All files have COMPLETE content (no stubs, no TODOs)
- App.tsx imports and renders every section component
- theme.css has all required CSS vars and reflects the brief's palette intent
- Token classes used everywhere (no hardcoded hex/rgb in classNames)
- No missing /images/* references outside image_manifest
- Brand logo is text wordmark (no /images/logo*)
- Text over media has overlay and is readable
- Image manifest has <= 7 entries
- No video manifest unless brief explicitly requested video

OUTPUT JSON SCHEMA:
{
  "architectural_reasoning": "string",
  "design_plan": {
    "summary": "string",
    "sections": [{ "id": "string", "objective": "string", "interaction": "string", "surface": "string" }],
    "interaction_budget": {
      "motion_signals_min": 3,
      "hover_focus_signals_min": 10,
      "primary_cta_interactions_min": 2
    },
    "brief_alignment": ["string", "string", "string"],
    "color_strategy": {
      "surface_ladder": "string",
      "accent_policy": "string",
      "section_surface_map": {},
      "cta_color_map": {}
    }
  },
  "foundation_files": [{ "filePath": "string", "content": "string" }],
  "components": [{ "filePath": "string", "content": "string" }],
  "utility_files": [{ "filePath": "string", "content": "string" }],
  "image_manifest": [{ "fileName": "string", "prompt": "string", "aspect_ratio": "string", "altText": "string" }]
}
`.trim();

/**
 * Same stack + JSON contract as the marketing prompt, but **no** mandatory hero/CTA/footer landing shape.
 * Use when `product_type` is web_application / fullstack_application so "build a weather app" becomes an app, not a waitlist page.
 */
const UX_ENGINEER_UTILITY_PROMPT = `
ROLE: You are a senior product engineer. You ship a **small, working web application** from the brief
(utility, dashboard, weather, calculator, etc.). The repo already has a standard Vite/React toolchain from a scaffold; your files must **compile and run** with that stack — do not rely on users editing config you were told not to touch.

OUTPUT RULE:
Respond ONLY with a valid JSON object matching the schema at the end of this prompt.
Do not wrap in markdown code fences. Do not include any text before or after the JSON.
You MAY call the provided MCP lookup tools before producing JSON.

TEMPLATE STACK (Non-Negotiable):
- React 18 + Vite + TypeScript, Tailwind CSS v4, shadcn/ui, lucide-react
- Same constraints as production: token-first Tailwind colors (bg-background, text-foreground, etc.), no hardcoded palette in className
- Implement the **functional behavior** the brief describes (API fetch, local state, forms, lists). No lorem-only shells.

APPLICATION SHAPE (NOT a marketing landing page):
- Primary experience lives in \`src/App.tsx\`. Add extra components under \`src/components/\` only when it improves clarity.
- **Do not** fabricate nav/hero/CTA/footer sections unless the brief is explicitly a public marketing page.
- \`design_plan.sections\`: 1–4 sections whose \`id\` values describe the app (e.g. \`main\`, \`search\`, \`results\`, \`settings\`) — not mandatory marketing ids.
- Keep motion subtle; no scroll-jacking or cinematic landing tropes unless the brief demands them.

DO NOT create or modify: vite.config.ts, src/main.tsx, tsconfig files, vercel.json, eslint.config.js.
DO NOT create src/pages/.

IMAGE RULES:
- Reference images as /images/... (never public/images/...)
- Maximum 3 images for utility apps (most need zero)
- Only include image_manifest if the app genuinely needs visual assets
- NEVER include video_manifest unless brief explicitly requests video

FILE CONTRACT:
1. index.html — HTML shell with meta tags, <div id="root"></div>, Vite entry
2. src/App.tsx — Root composition with functional implementation
3. src/styles/theme.css — :root CSS variables
4. src/styles/fonts.css — Font variable definitions
5. src/styles/index.css — Import hub
6. src/styles/tailwind.css — Tailwind v4 setup with token bridge
7. src/components/*.tsx — App components with complete implementations

OUTPUT JSON SCHEMA:
{
  "architectural_reasoning": "string",
  "design_plan": {
    "summary": "string",
    "sections": [{ "id": "string", "objective": "string", "interaction": "string", "surface": "string" }],
    "interaction_budget": {
      "motion_signals_min": 1,
      "hover_focus_signals_min": 4,
      "primary_cta_interactions_min": 0
    },
    "brief_alignment": ["string", "string"],
    "color_strategy": {
      "surface_ladder": "string",
      "accent_policy": "string",
      "section_surface_map": {},
      "cta_color_map": {}
    }
  },
  "foundation_files": [{ "filePath": "string", "content": "string" }],
  "components": [{ "filePath": "string", "content": "string" }],
  "utility_files": [{ "filePath": "string", "content": "string" }],
  "image_manifest": [{ "fileName": "string", "prompt": "string", "aspect_ratio": "string", "altText": "string" }]
}
`.trim();

const WEBSITE_FOUNDATION_LOOKUP_TOOLS = [
  {
    name: 'search_components',
    description: 'Search the shadcn/ui and Aceternity component registries by name, description, or tags.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_component_info',
    description: 'Get detailed API information for a specific component.',
    input_schema: {
      type: 'object' as const,
      properties: {
        component_name: { type: 'string', description: 'Component name.' },
      },
      required: ['component_name'],
    },
  },
  {
    name: 'get_installation_info',
    description: 'Get installation command and setup instructions for a component.',
    input_schema: {
      type: 'object' as const,
      properties: {
        component_name: { type: 'string', description: 'Component name.' },
        registry: {
          type: 'string',
          description: 'Registry prefix.',
          enum: ['@reactbits-pro', '@aceternity', '@reactbits-starter'],
        },
      },
      required: ['component_name'],
    },
  },
  {
    name: 'install_item_from_registry',
    description: 'Return the exact install command and import guidance for a registry component.',
    input_schema: {
      type: 'object' as const,
      properties: {
        item_name: { type: 'string', description: 'Registry item name.' },
        registry: {
          type: 'string',
          description: 'Registry prefix.',
          enum: ['@reactbits-pro', '@aceternity', '@reactbits-starter'],
        },
      },
      required: ['item_name'],
    },
  },
];

const WEBSITE_FOUNDATION_TOOL_DECLARATIONS: ToolDeclaration[] = WEBSITE_FOUNDATION_LOOKUP_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: {
    type: String(tool.input_schema.type ?? 'object'),
    properties: tool.input_schema.properties as Record<string, unknown>,
    required: tool.input_schema.required,
  },
}));

interface LocalComponentCatalogItem {
  name: string;
  registry: 'shadcn' | '@reactbits-pro' | '@aceternity' | '@reactbits-starter';
  tags: string[];
  description: string;
  importPath?: string;
}

const LOCAL_COMPONENT_CATALOG: LocalComponentCatalogItem[] = [
  { name: 'button', registry: 'shadcn', tags: ['cta', 'form', 'primitive'], description: 'Accessible button primitive.', importPath: '@/components/ui/button' },
  { name: 'card', registry: 'shadcn', tags: ['layout', 'content'], description: 'Content container with header/body/footer slots.', importPath: '@/components/ui/card' },
  { name: 'tabs', registry: 'shadcn', tags: ['navigation', 'interactive'], description: 'Accessible tabs with keyboard support.', importPath: '@/components/ui/tabs' },
  { name: 'dialog', registry: 'shadcn', tags: ['modal', 'overlay'], description: 'Modal dialog primitives.', importPath: '@/components/ui/dialog' },
  { name: 'split-text', registry: '@reactbits-pro', tags: ['motion', 'text', 'hero'], description: 'Animated headline text sequencing.' },
  { name: 'gradient-text', registry: '@reactbits-pro', tags: ['text', 'hero', 'brand'], description: 'Gradient-driven headline treatment.' },
  { name: 'particles', registry: '@reactbits-pro', tags: ['background', 'ambient', 'motion'], description: 'Particle background motion effect.' },
  { name: 'spotlight', registry: '@aceternity', tags: ['hero', 'anchor', 'cinematic'], description: 'Cinematic spotlight structural anchor.' },
  { name: 'parallax-scroll', registry: '@aceternity', tags: ['scroll', 'anchor', 'cinematic'], description: 'Parallax section anchor for storytelling.' },
  { name: 'background-beams', registry: '@aceternity', tags: ['background', 'anchor', 'cinematic'], description: 'Beam-based backdrop anchor.' },
];

function localSearchComponents(input: Record<string, unknown>): Record<string, unknown> {
  const query = String(input.query ?? '').trim().toLowerCase();
  if (!query) {
    return { items: LOCAL_COMPONENT_CATALOG.slice(0, 10) };
  }
  const items = LOCAL_COMPONENT_CATALOG.filter((item) => {
    return item.name.includes(query)
      || item.description.toLowerCase().includes(query)
      || item.tags.some((tag) => tag.includes(query))
      || item.registry.toLowerCase().includes(query);
  });
  return { items: items.slice(0, 20), query };
}

function localGetComponentInfo(input: Record<string, unknown>): Record<string, unknown> {
  const componentName = String(input.component_name ?? '').trim().toLowerCase();
  const match = LOCAL_COMPONENT_CATALOG.find((item) => item.name.toLowerCase() === componentName)
    ?? LOCAL_COMPONENT_CATALOG.find((item) => item.name.toLowerCase().includes(componentName));
  if (!match) {
    return { error: `No local component metadata found for ${componentName}.` };
  }
  return {
    component: match,
    usage_guidance: match.registry === 'shadcn'
      ? 'Use this for functional UI primitives.'
      : 'Use this as a visual/motion enhancement, not for core UI primitives.',
  };
}

function buildInstallCommand(itemName: string, registry: string): string {
  if (registry === 'shadcn') {
    return `npx shadcn@latest add ${itemName}`;
  }
  return `npx shadcn@latest add ${registry}/${itemName}`;
}

function localGetInstallationInfo(input: Record<string, unknown>): Record<string, unknown> {
  const componentName = String(input.component_name ?? input.item_name ?? '').trim();
  const registry = String(input.registry ?? '').trim() || '@reactbits-pro';
  if (!componentName) {
    return { error: 'component_name is required.' };
  }
  return {
    component_name: componentName,
    registry,
    install_command: buildInstallCommand(componentName, registry),
    notes: 'Install in the repo before importing. Keep functional primitives on shadcn/ui.',
  };
}

const LOCAL_WEBSITE_LOOKUP_HANDLERS: Record<string, (input: Record<string, unknown>) => Record<string, unknown>> = {
  search_components: localSearchComponents,
  get_component_info: localGetComponentInfo,
  get_installation_info: localGetInstallationInfo,
  install_item_from_registry: localGetInstallationInfo,
};

interface WebsiteFoundationFileEntry {
  filePath: string;
  content: string;
}

interface WebsiteFoundationImageManifestEntry {
  fileName: string;
  prompt: string;
  aspect_ratio: string;
  altText: string;
}

interface WebsiteFoundationOutput {
  architectural_reasoning: string;
  design_plan: Record<string, unknown>;
  foundation_files: WebsiteFoundationFileEntry[];
  components: WebsiteFoundationFileEntry[];
  utility_files?: WebsiteFoundationFileEntry[];
  image_manifest: WebsiteFoundationImageManifestEntry[];
}

function createWebsiteFoundationModelClient(): ModelClient {
  return new ModelClient({
    geminiApiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY,
    azureFoundryEndpoint: process.env.AZURE_FOUNDRY_ENDPOINT,
    azureFoundryApi: process.env.AZURE_FOUNDRY_API,
    azureFoundryApiVersion: process.env.AZURE_FOUNDRY_API_VERSION,
  });
}

function createConversationTurn(turn: Omit<ConversationTurn, 'timestamp'>): ConversationTurn {
  return {
    ...turn,
    timestamp: Date.now(),
  };
}

async function executeWebsiteLookupTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const localHandler = LOCAL_WEBSITE_LOOKUP_HANDLERS[toolName];
  try {
    if (ctx.executeChildTool) {
      const result = await ctx.executeChildTool(toolName, toolInput);
      if (typeof result === 'string') {
        return { text: result };
      }
      if (result && typeof result === 'object') {
        return result as Record<string, unknown>;
      }
      return { value: result ?? null };
    }
    if (localHandler) {
      return localHandler(toolInput);
    }
    return {
      note: `Tool ${toolName} lookup was requested but no child executor is available. Proceed with best-known API details.`,
    };
  } catch (err) {
    if (localHandler) {
      return {
        ...localHandler(toolInput),
        note: `Fell back to local ${toolName} metadata after child tool failure: ${(err as Error).message}`,
      };
    }
    return { error: `Tool ${toolName} failed: ${(err as Error).message}` };
  }
}

function appendModelText(turns: ConversationTurn[], text: string | null | undefined): void {
  if (!text?.trim()) return;
  turns.push(createConversationTurn({ role: 'assistant', content: text.trim() }));
}

function parseWebsiteFoundationOutput(text: string): WebsiteFoundationOutput | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as WebsiteFoundationOutput;
    if (!parsed.foundation_files || !parsed.components) return null;
    return parsed;
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*"foundation_files"[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      return JSON.parse(jsonMatch[0]) as WebsiteFoundationOutput;
    } catch {
      return null;
    }
  }
}

function flattenWebsiteFoundationFiles(output: WebsiteFoundationOutput): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of output.foundation_files ?? []) {
    if (entry.filePath && entry.content) files[entry.filePath] = entry.content;
  }
  for (const entry of output.components ?? []) {
    if (entry.filePath && entry.content) files[entry.filePath] = entry.content;
  }
  for (const entry of output.utility_files ?? []) {
    if (entry.filePath && entry.content) files[entry.filePath] = entry.content;
  }
  return files;
}

function validateWebsiteFoundationOutput(
  output: WebsiteFoundationOutput,
  mode: FoundationBuildMode,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  const foundationFiles = new Set((output.foundation_files ?? []).map((entry) => entry.filePath));
  for (const requiredFile of REQUIRED_FOUNDATION_FILES) {
    if (!foundationFiles.has(requiredFile)) {
      errors.push(`missing required foundation file: ${requiredFile}`);
    }
  }

  const sections = ((output.design_plan as { sections?: Array<{ id?: unknown }> } | undefined)?.sections ?? []);

  if (mode === 'utility') {
    if (sections.length < 1) {
      errors.push('design_plan must include at least 1 section for utility apps.');
    }
    if ((output.components ?? []).length < 1) {
      errors.push('components must include at least 1 component file (e.g. App.tsx or a split view).');
    }
  } else {
    const sectionIds = new Set(
      sections
        .map((section) => String(section?.id ?? '').trim().toLowerCase())
        .filter(Boolean),
    );

    if (sections.length < 5) {
      errors.push('design_plan must include at least 5 sections.');
    }

    for (const requiredSection of ['nav', 'hero', 'cta', 'footer']) {
      if (!sectionIds.has(requiredSection)) {
        errors.push(`design_plan is missing required section id: ${requiredSection}`);
      }
    }

    if ((output.components ?? []).length < 4) {
      errors.push('components must include at least 4 complete section component files.');
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Full-file replacements only; paths the model is allowed to change (template-owned files stay locked). */
function isIncrementalPatchPathAllowed(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/').trim();
  if (!p || p.includes('..')) return false;
  if (p === 'index.html') return true;
  if (!p.startsWith('src/')) return false;
  if (p === 'src/main.tsx') return false;
  const base = path.basename(p);
  if (/^vite\.config\./i.test(base) || /^tsconfig/i.test(base) || base === 'package.json') return false;
  return true;
}

function extractPathsFromSandboxErrors(errors: string[]): string[] {
  const out = new Set<string>();
  const re = /\bsrc\/[A-Za-z0-9_./-]+\.(tsx|ts|css)\b/g;
  for (const line of errors) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      out.add(m[0]);
    }
  }
  return [...out];
}

const INCREMENTAL_PATCH_PER_FILE_CAP = 48_000;
const INCREMENTAL_PATCH_TOTAL_CAP = 120_000;

function buildPatchRepairUserMessage(files: Record<string, string>, errors: string[]): string {
  const fromErrors = extractPathsFromSandboxErrors(errors);
  const keys = new Set<string>(['src/App.tsx']);
  for (const k of fromErrors) keys.add(k);
  for (const k of Object.keys(files)) {
    if (k.startsWith('src/components/')) keys.add(k);
  }
  const payload: { build_errors: string[]; files: Record<string, string> } = {
    build_errors: errors.slice(0, 50),
    files: {},
  };
  let total = 0;
  for (const filePath of keys) {
    const content = files[filePath];
    if (content === undefined) continue;
    let slice = content;
    if (slice.length > INCREMENTAL_PATCH_PER_FILE_CAP) {
      slice = `${slice.slice(0, INCREMENTAL_PATCH_PER_FILE_CAP)}\n/* … truncated … */\n`;
    }
    if (total + slice.length > INCREMENTAL_PATCH_TOTAL_CAP) break;
    payload.files[filePath] = slice;
    total += slice.length;
  }
  return [
    'Fix the Vite + TypeScript build using **surgical full-file replacements**.',
    'Return ONLY valid JSON (no markdown fences): {"patches":[{"filePath":"src/App.tsx","content":"..."}]}',
    'Each patch must be the **complete** new file contents. Only include files you changed.',
    'Do not patch src/main.tsx, vite.config.ts, tsconfig, or package.json.',
    '',
    'CONTEXT:',
    JSON.stringify(payload),
  ].join('\n');
}

function parseIncrementalPatchOutput(text: string): Array<{ filePath: string; content: string }> | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
  const tryParse = (raw: string): Array<{ filePath: string; content: string }> | null => {
    try {
      const p = JSON.parse(raw) as { patches?: unknown };
      if (!Array.isArray(p.patches)) return null;
      const out: Array<{ filePath: string; content: string }> = [];
      for (const x of p.patches) {
        if (!x || typeof x !== 'object') continue;
        const o = x as Record<string, unknown>;
        const fp = typeof o.filePath === 'string' ? o.filePath.trim() : '';
        const c = typeof o.content === 'string' ? o.content : '';
        if (fp && c) out.push({ filePath: fp, content: c });
      }
      return out.length > 0 ? out : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(cleaned);
  if (direct) return direct;
  const m = cleaned.match(/\{[\s\S]*"patches"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
  return m ? tryParse(m[0]) : null;
}

function mergeFlatFilesIntoWebsiteOutput(
  output: WebsiteFoundationOutput,
  flat: Record<string, string>,
): WebsiteFoundationOutput {
  const foundationFiles: WebsiteFoundationFileEntry[] = [...(output.foundation_files ?? [])];
  const components: WebsiteFoundationFileEntry[] = [...(output.components ?? [])];
  const utilityFiles: WebsiteFoundationFileEntry[] = [...(output.utility_files ?? [])];

  const updateList = (arr: WebsiteFoundationFileEntry[], filePath: string, content: string): boolean => {
    const i = arr.findIndex((e) => e.filePath === filePath);
    if (i < 0) return false;
    arr[i] = { filePath, content };
    return true;
  };

  for (const [filePath, content] of Object.entries(flat)) {
    if (!isIncrementalPatchPathAllowed(filePath)) continue;
    if (
      !updateList(foundationFiles, filePath, content)
      && !updateList(components, filePath, content)
      && !updateList(utilityFiles, filePath, content)
    ) {
      utilityFiles.push({ filePath, content });
    }
  }

  return {
    ...output,
    foundation_files: foundationFiles,
    components,
    utility_files: utilityFiles,
  };
}

const INCREMENTAL_PATCH_SYSTEM_PROMPT = `
You are a senior TypeScript/React engineer fixing a broken Vite build.
You receive build_errors and partial file contents. Output ONLY a JSON object:
{"patches":[{"filePath":"…","content":"…"}]}
Rules:
- Full file contents only (replace entire file).
- Preserve stack: React 18, TS, Tailwind token classes (bg-background, text-foreground, etc.).
- Fix imports, types, and syntax so \`tsc --noEmit && vite build\` succeeds.
- Do not include markdown, commentary, or keys other than "patches".
`.trim();

async function runIncrementalPatchRepair(
  initialFlat: Record<string, string>,
  initialErrors: string[],
  ctx: ToolContext,
  maxRounds: number,
): Promise<Record<string, string> | null> {
  if (maxRounds <= 0) return null;
  let files = { ...initialFlat };
  let errors = [...initialErrors];
  const modelClient = createWebsiteFoundationModelClient();

  for (let round = 0; round < maxRounds; round++) {
    // Last round: escalate to main model for harder fixes
    const patchModel = round >= maxRounds - 1
      ? DEFAULT_WEBSITE_FOUNDATION_MODEL
      : WEBSITE_FOUNDATION_REPAIR_MODEL;
    const response = await modelClient.generate({
      model: patchModel,
      systemInstruction: INCREMENTAL_PATCH_SYSTEM_PROMPT,
      contents: [createConversationTurn({ role: 'user', content: buildPatchRepairUserMessage(files, errors) })],
      maxTokens: 65536,
      thinkingEnabled: round >= maxRounds - 1, // enable thinking on final escalation
      reasoningLevel: round >= maxRounds - 1 ? 'deep' : 'standard',
      signal: ctx.abortSignal,
      callTimeoutMs: 180_000,
      metadata: { agentRole: ctx.agentRole },
    });

    const patches = parseIncrementalPatchOutput(response.text ?? '');
    if (!patches?.length) {
      console.warn(`[WebBuild] Incremental patch round ${round + 1}: no valid patches — continuing to next round.`);
      continue; // Don't give up, try next round (maybe with stronger model)
    }

    let applied = 0;
    for (const p of patches) {
      if (!isIncrementalPatchPathAllowed(p.filePath)) continue;
      files[p.filePath] = p.content;
      applied++;
    }
    if (applied === 0) {
      console.warn(`[WebBuild] Incremental patch round ${round + 1}: no allowed paths — continuing.`);
      continue; // Don't give up
    }

    const sb = await runSandboxBuild(files, ctx.abortSignal);
    if (sb.skipped || sb.ok) {
      return files;
    }
    errors = sb.errors;
  }

  return null;
}

function buildSandboxRepairPrompt(errors: string[]): string {
  return [
    '<sandbox_build_errors>',
    'Your generated code failed the real Vite + TypeScript sandbox build.',
    '',
    'Build errors (fix ALL of these):',
    errors.slice(0, 40).join('\n'),
    '</sandbox_build_errors>',
    '',
    'Regenerate the COMPLETE JSON build output with all files.',
    'Fix only the files referenced in the errors above.',
    'Do NOT change sections, layouts, or brand colors that were working.',
    'Common fixes: correct import paths, add missing type annotations, resolve TS2345/TS2304/TS2305 errors.',
  ].join('\n');
}

async function runWebsiteFoundationLoop(
  userPrompt: string,
  model: string,
  ctx: ToolContext,
  foundationMode: FoundationBuildMode = 'marketing',
): Promise<{ output: WebsiteFoundationOutput; toolRounds: number; lookupCalls: number; lookupFailures: number; sandboxRounds: number }> {
  const modelClient = createWebsiteFoundationModelClient();
  const systemInstruction = foundationMode === 'utility' ? UX_ENGINEER_UTILITY_PROMPT : UX_ENGINEER_SYSTEM_PROMPT;
  const turns: ConversationTurn[] = [createConversationTurn({ role: 'user', content: userPrompt })];
  let toolRounds = 0;
  let output: WebsiteFoundationOutput | null = null;
  let lookupCalls = 0;
  let lookupFailures = 0;
  let sandboxRounds = 0;
  // Switch to repair model for sandbox error rounds (cheaper + faster for targeted fixes)
  let effectiveModel = model;

  while (toolRounds <= WEBSITE_FOUNDATION_MAX_TOOL_ROUNDS) {
    // Claude Code pattern: same model retries with errors in context.
    // On 3rd sandbox repair attempt, enable deeper reasoning for harder fixes.
    const useDeepReasoning = sandboxRounds >= 2;
    const response = await modelClient.generate({
      model: effectiveModel,
      systemInstruction,
      contents: turns,
      tools: WEBSITE_FOUNDATION_TOOL_DECLARATIONS,
      maxTokens: WEBSITE_FOUNDATION_MAX_TOKENS,
      thinkingEnabled: true,
      reasoningLevel: useDeepReasoning ? 'deep' : 'standard',
      signal: ctx.abortSignal,
      callTimeoutMs: 300_000,
      metadata: {
        agentRole: ctx.agentRole,
      },
    });

    appendModelText(turns, response.thinkingText);
    appendModelText(turns, response.text);

    if (response.text?.includes('foundation_files')) {
      const parsed = parseWebsiteFoundationOutput(response.text);
      if (parsed) {
        const validation = validateWebsiteFoundationOutput(parsed, foundationMode);
        if (validation.ok) {
          // Schema contract passed — now run real sandbox build validation
          const flatFiles = flattenWebsiteFoundationFiles(parsed);
          const sandboxResult = await runSandboxBuild(flatFiles, ctx.abortSignal);

          if (sandboxResult.skipped || sandboxResult.ok) {
            if (!sandboxResult.skipped) {
              console.log(`[WebBuild] Sandbox build ✅ in ${sandboxResult.durationMs ?? 0}ms`);
            }
            output = parsed;
            break;
          }

          // Sandbox build failed
          console.warn(`[WebBuild] Sandbox build ❌ (round ${sandboxRounds + 1}/${SANDBOX_MAX_REPAIR_ROUNDS}): ${sandboxResult.errors.length} errors`);
          sandboxRounds += 1;

          if (sandboxRounds > SANDBOX_MAX_REPAIR_ROUNDS) {
            const incMax = incrementalPatchMaxRounds();
            let merged: WebsiteFoundationOutput = parsed;
            let repairSucceeded = false;
            if (incMax > 0) {
              console.warn('[WebBuild] Full-JSON sandbox repair limit reached; trying incremental file patches.');
              const repairedFlat = await runIncrementalPatchRepair(
                flatFiles,
                sandboxResult.errors,
                ctx,
                incMax,
              );
              if (repairedFlat) {
                merged = mergeFlatFilesIntoWebsiteOutput(parsed, repairedFlat);
                repairSucceeded = true;
                console.log('[WebBuild] Incremental patch repair fixed sandbox build.');
              } else {
                console.error('[WebBuild] ⚠️ ALL REPAIR ATTEMPTS EXHAUSTED. Shipping output with known build errors.');
                console.error(`[WebBuild] Unresolved errors: ${sandboxResult.errors.slice(0, 5).join('; ')}`);
              }
            } else {
              console.error('[WebBuild] ⚠️ Sandbox repair limit reached and incremental patches disabled. Shipping with errors.');
            }
            // Tag the output so downstream consumers know build quality
            (merged as Record<string, unknown>).__buildStatus = repairSucceeded ? 'repaired' : 'errors_unresolved';
            (merged as Record<string, unknown>).__unresolvedErrors = repairSucceeded ? [] : sandboxResult.errors.slice(0, 10);
            output = merged;
            break;
          }

          // Send real build errors back to model for self-repair (Claude pattern:
          // same model, errors in conversation context, model self-corrects)
          turns.push(createConversationTurn({
            role: 'user',
            content: buildSandboxRepairPrompt(sandboxResult.errors),
          }));

          // Keep the SAME model — do NOT downgrade to repair model.
          // Harder errors need the same (or better) capability, not less.
          // effectiveModel stays unchanged.
          toolRounds += 1;
          continue;
        } else {
          turns.push(createConversationTurn({
            role: 'user',
            content: `Your output did not satisfy the UX engineer contract. Fix and regenerate the full JSON. Violations:\n- ${validation.errors.join('\n- ')}`,
          }));
        }
      }
    }

    if (output) break;

    if ((response.toolCalls?.length ?? 0) === 0) {
      if (toolRounds === WEBSITE_FOUNDATION_MAX_TOOL_ROUNDS) {
        throw new Error('Model did not produce a valid website build output after the maximum number of rounds.');
      }
      turns.push(createConversationTurn({
        role: 'user',
        content: 'Output the complete JSON build object now. Do not include markdown fences or any other text.',
      }));
      toolRounds += 1;
      continue;
    }

    for (const toolUse of response.toolCalls) {
      lookupCalls += 1;
      turns.push(createConversationTurn({
        role: 'tool_call',
        toolName: String(toolUse.name),
        toolParams: toolUse.args ?? {},
        content: '',
        thoughtSignature: toolUse.thoughtSignature,
      }));
      const toolResult = await executeWebsiteLookupTool(
        String(toolUse.name),
        (toolUse.args as Record<string, unknown>) ?? {},
        ctx,
      );
      if (typeof toolResult.error === 'string' && toolResult.error.trim()) {
        lookupFailures += 1;
      }
      turns.push(createConversationTurn({
        role: 'tool_result',
        toolName: String(toolUse.name),
        content: JSON.stringify(toolResult),
      }));
    }
    toolRounds += 1;
  }

  if (!output) {
    throw new Error('Website foundation build completed without a valid output payload.');
  }

  return { output, toolRounds, lookupCalls, lookupFailures, sandboxRounds };
}

export function createBuildWebsiteFoundationTools(): ToolDefinition[] {
  return [
    {
      name: 'build_website_foundation',
      description: 'Generate a complete production-ready client website foundation as a file map using the Glyphor UX engineer build system.',
      parameters: {
        normalized_brief: {
          type: 'object',
          description: 'Normalized design brief from normalize_design_brief.',
          required: true,
        },
        brand_spec: {
          type: 'object',
          description: 'Brand details such as colors, fonts, and tone.',
          required: false,
        },
        intake_context: {
          type: 'object',
          description: 'Additional intake notes or project context.',
          required: false,
        },
        component_context: {
          type: 'object',
          description: 'Optional pre-fetched component research context.',
          required: false,
        },
        repair_context: {
          type: 'string',
          description: 'Optional revision notes from a prior review round.',
          required: false,
        },
        model: {
          type: 'string',
          description: `Optional model override. Defaults to ${DEFAULT_WEBSITE_FOUNDATION_MODEL}.`,
          required: false,
        },
      },
      async execute(params, ctx): Promise<ToolResult> {
        const normalizedBrief = params.normalized_brief;
        if (!normalizedBrief || typeof normalizedBrief !== 'object') {
          return { success: false, error: 'normalized_brief is required and must be an object.' };
        }

        const selectedModel = typeof params.model === 'string' && params.model.trim()
          ? params.model.trim()
          : (typeof params.repair_context === 'string' && params.repair_context.trim()
              ? WEBSITE_FOUNDATION_REPAIR_MODEL
              : DEFAULT_WEBSITE_FOUNDATION_MODEL);

        const promptParts = [
          `normalized_brief:\n${JSON.stringify(normalizedBrief, null, 2)}`,
          `brand_spec:\n${JSON.stringify(params.brand_spec ?? {}, null, 2)}`,
          `intake_context:\n${JSON.stringify(params.intake_context ?? {}, null, 2)}`,
          `component_context:\n${JSON.stringify(params.component_context ?? {}, null, 2)}`,
        ];
        if (typeof params.repair_context === 'string' && params.repair_context.trim()) {
          promptParts.push(`repair_context:\n${params.repair_context.trim()}`);
        }

        const foundationMode = foundationModeFromNormalizedBrief(normalizedBrief as Record<string, unknown>);

        try {
          const { output, toolRounds, lookupCalls, lookupFailures, sandboxRounds } = await runWebsiteFoundationLoop(
            promptParts.join('\n\n'),
            selectedModel,
            ctx,
            foundationMode,
          );
          return {
            success: true,
            data: {
              files: flattenWebsiteFoundationFiles(output),
              image_manifest: output.image_manifest,
              architectural_reasoning: output.architectural_reasoning,
              design_plan: output.design_plan,
              foundation_mode: foundationMode,
              tool_rounds: toolRounds,
              lookup_calls: lookupCalls,
              lookup_failures: lookupFailures,
              sandbox_rounds: sandboxRounds,
              sandbox_enabled: Boolean(process.env.E2B_API_KEY?.trim()) && process.env.SANDBOX_BUILD_SKIP !== 'true',
              model: selectedModel,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },
  ];
}