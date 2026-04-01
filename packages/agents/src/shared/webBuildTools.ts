import { ModelClient, type ConversationTurn, type ToolContext, type ToolDeclaration, type ToolDefinition, type ToolResult } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';
import { createCloudflarePreviewTools, createGithubFromTemplateTools, createGithubPullRequestTools, createGithubPushFilesTools, createVercelProjectTools } from '@glyphor/integrations';
import { createDesignBriefTools } from './designBriefTools.js';

type WebBuildTier = 'prototype' | 'full_build' | 'iterate';
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
  build_report?: unknown;
  agent_trace?: unknown;
  tier_used: WebBuildTier;
  raw?: unknown;
}

interface WebBuildToolPolicy {
  allowBuild?: boolean;
  allowIterate?: boolean;
  allowUpgrade?: boolean;
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
  brand_name: 'Glyphor',
  primary_color: '#00E0FF',
  secondary_color: '#00A3FF',
  accent_color: '#6E77DF',
  heading_font: 'Clash Display',
  body_font: 'Satoshi',
  visual_style: 'dark_glass',
  animation_preference: 'rich',
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

function buildAccountProfileOverride(brand: WebBrandContext): Record<string, unknown> {
  return {
    brand_colors: {
      primary: brand.primary_color,
      secondary: brand.secondary_color,
      accent: brand.accent_color,
      background: '#0A0A0B',
      foreground: '#FAFAFA',
    },
    typography: {
      headingFont: brand.heading_font,
      bodyFont: brand.body_font,
      scale: 'modular_1.25',
    },
    visual_style: brand.visual_style,
    animation_preference: brand.animation_preference,
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

  return {
    repoFullName: repoFullName ?? `${owner}/${repoName}`,
    owner,
    repoName,
    projectSlug,
    projectName,
    branch: tier === 'iterate' ? createBranchName(ITERATION_BRANCH_PREFIX) : createBranchName(UPGRADE_BRANCH_PREFIX),
    isExisting: true,
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

async function provisionWebsiteProject(
  params: WebBuildParams,
  brand: WebBrandContext,
  ctx: ToolContext,
): Promise<WebsitePipelineProjectRef> {
  if (params.project_id?.trim()) {
    return parseProjectReference(params.project_id, params.tier);
  }

  const projectBaseName = slugifyProjectName(extractProjectNameCandidate(params.brief, brand)) || `website-${buildUniqueSuffix()}`;
  const repoCandidates = [projectBaseName, `${projectBaseName}-${buildUniqueSuffix()}`];
  let lastError: Error | null = null;

  for (const candidate of repoCandidates) {
    try {
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
        projectSlug: repoName,
        projectName: pickString(vercel, 'project_name') ?? repoName,
        branch: params.tier === 'prototype' ? DEFAULT_PROTOTYPE_BRANCH : DEFAULT_INITIAL_BRANCH,
        isExisting: false,
        vercelProjectId: pickString(vercel, 'project_id'),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!/already exists/i.test(lastError.message)) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error('Failed to provision website project.');
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
  const project = await provisionWebsiteProject(params, brand, ctx);
  if (options.branchOverride) {
    project.branch = options.branchOverride;
  }

  const foundation = await executeWebsitePipelineTool<Record<string, unknown>>(
    'build_website_foundation',
    {
      normalized_brief: normalizedBrief,
      brand_spec: buildBrandSpec(params.brief, normalizedBrief, brand, project.projectSlug, params.project_type),
      intake_context: buildIntakeContext(params, brand, project),
      ...(options.repairContext ? { repair_context: options.repairContext } : {}),
    },
    ctx,
  );

  const files = asRecord(foundation.files) as Record<string, string>;
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

  let githubPrUrl: string | undefined;
  let deployUrl = preview.preview_url;
  let production: Record<string, unknown> | null = null;
  let pullRequest: Record<string, unknown> | null = null;
  let merge: Record<string, unknown> | null = null;
  let checks: Record<string, unknown> | null = null;

  if (params.tier === 'full_build') {
    pullRequest = await executeWebsitePipelineTool<Record<string, unknown>>(
      'github_create_pull_request',
      {
        repo: project.repoFullName,
        head_branch: project.branch,
        base_branch: 'main',
        title: options.prTitle ?? buildPullRequestTitle(project, params.tier),
        body: options.prBody ?? buildPullRequestBody(params, project),
      },
      ctx,
    );
    githubPrUrl = pickString(pullRequest, 'pr_url');

    checks = await executeWebsitePipelineTool<Record<string, unknown>>(
      'github_wait_for_pull_request_checks',
      {
        repo: project.repoFullName,
        pr_number: Number(pullRequest.pr_number ?? 0),
        timeout_seconds: 900,
        poll_interval_seconds: 15,
      },
      ctx,
    );

    merge = await executeWebsitePipelineTool<Record<string, unknown>>(
      'github_merge_pull_request',
      {
        repo: project.repoFullName,
        pr_number: Number(pullRequest.pr_number ?? 0),
        merge_method: 'squash',
      },
      ctx,
    );

    production = await waitForProductionUrl(project, ctx);
    deployUrl = pickString(production, 'production_url') ?? deployUrl;
  }

  return {
    project_id: project.repoFullName,
    preview_url: pickString(previewRegistration, 'preview_url') ?? preview.preview_url,
    deploy_url: deployUrl,
    github_pr_url: githubPrUrl,
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
        project.isExisting ? 'reuse_existing_project' : 'github_create_from_template',
        project.isExisting ? 'reuse_existing_vercel_project' : 'vercel_create_project',
        'build_website_foundation',
        'github_push_files',
        'vercel_get_preview_url',
        project.isExisting || params.tier === 'iterate' ? 'cloudflare_update_preview' : 'cloudflare_register_preview',
        ...(params.tier === 'full_build'
          ? ['github_create_pull_request', 'github_wait_for_pull_request_checks', 'github_merge_pull_request', 'vercel_get_production_url']
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

export function createWebBuildTools(memory: CompanyMemoryStore, policy: WebBuildToolPolicy = {}): ToolDefinition[] {
  const allowBuild = policy.allowBuild !== false;
  const allowIterate = policy.allowIterate !== false;
  const allowUpgrade = policy.allowUpgrade !== false;
  const allowedBuildTiers = normalizeBuildTiers(policy.allowedBuildTiers);
  const tools: ToolDefinition[] = [];

  if (allowBuild) {
    tools.push({
      name: 'invoke_web_build',
      description: 'Build a complete web application or page using the Glyphor website pipeline. Provide a detailed brief and tier; the system provisions the repo, generates the site, deploys preview infrastructure, and optionally ships production.',
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

const DEFAULT_WEBSITE_FOUNDATION_MODEL = process.env.UX_ENGINEER_MODEL?.trim() || 'gemini-3.1-flash-lite-preview';
const WEBSITE_FOUNDATION_REPAIR_MODEL = process.env.UX_ENGINEER_REPAIR_MODEL?.trim() || 'gpt-5.4-mini';
const WEBSITE_FOUNDATION_MAX_TOKENS = 100000;
const WEBSITE_FOUNDATION_MAX_TOOL_ROUNDS = 4;

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

SCROLLBAR POLISH (Always Apply):
In src/styles/tailwind.css @layer base:
  * { scrollbar-width: none; -ms-overflow-style: none; }
  *::-webkit-scrollbar { display: none; }

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
    return {
      note: `Tool ${toolName} lookup was requested but no child executor is available. Proceed with best-known API details.`,
    };
  } catch (err) {
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

async function runWebsiteFoundationLoop(
  userPrompt: string,
  model: string,
  ctx: ToolContext,
): Promise<{ output: WebsiteFoundationOutput; toolRounds: number }> {
  const modelClient = createWebsiteFoundationModelClient();
  const turns: ConversationTurn[] = [createConversationTurn({ role: 'user', content: userPrompt })];
  let toolRounds = 0;
  let output: WebsiteFoundationOutput | null = null;

  while (toolRounds <= WEBSITE_FOUNDATION_MAX_TOOL_ROUNDS) {
    const response = await modelClient.generate({
      model,
      systemInstruction: UX_ENGINEER_SYSTEM_PROMPT,
      contents: turns,
      tools: WEBSITE_FOUNDATION_TOOL_DECLARATIONS,
      maxTokens: WEBSITE_FOUNDATION_MAX_TOKENS,
      thinkingEnabled: true,
      reasoningLevel: 'deep',
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
        output = parsed;
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

  return { output, toolRounds };
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

        try {
          const { output, toolRounds } = await runWebsiteFoundationLoop(promptParts.join('\n\n'), selectedModel, ctx);
          return {
            success: true,
            data: {
              files: flattenWebsiteFoundationFiles(output),
              image_manifest: output.image_manifest,
              architectural_reasoning: output.architectural_reasoning,
              design_plan: output.design_plan,
              tool_rounds: toolRounds,
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