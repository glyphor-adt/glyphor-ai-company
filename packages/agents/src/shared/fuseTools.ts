import type { ToolContext, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';

type FuseBuildTier = 'prototype' | 'full_build' | 'iterate';
type FuseProjectType = 'react_spa' | 'nextjs_fullstack' | 'fastapi_backend' | 'legacy_refactor' | 'dbt_pipeline' | 'terraform_infra';
type FuseVisualStyle = 'minimal' | 'bold' | 'editorial' | 'playful' | 'dark_glass';
type FuseAnimationPreference = 'none' | 'subtle' | 'rich';

interface FuseBrandContext {
  brand_name: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  heading_font: string;
  body_font: string;
  visual_style: FuseVisualStyle;
  animation_preference: FuseAnimationPreference;
}

interface FuseBuildParams {
  brief: string;
  tier: FuseBuildTier;
  project_type?: FuseProjectType;
  project_id?: string;
  brand_context?: Partial<FuseBrandContext>;
}

interface FuseBuildResult {
  project_id?: string;
  preview_url?: string;
  deploy_url?: string;
  github_pr_url?: string;
  build_report?: unknown;
  agent_trace?: unknown;
  tier_used: FuseBuildTier;
  raw?: unknown;
}

interface FuseToolPolicy {
  allowBuild?: boolean;
  allowIterate?: boolean;
  allowUpgrade?: boolean;
  allowedBuildTiers?: FuseBuildTier[];
}

const DEFAULT_BRAND_CONTEXT: FuseBrandContext = {
  brand_name: 'Glyphor',
  primary_color: '#00E0FF',
  secondary_color: '#00A3FF',
  accent_color: '#6E77DF',
  heading_font: 'Clash Display',
  body_font: 'Satoshi',
  visual_style: 'dark_glass',
  animation_preference: 'rich',
};

const ALL_BUILD_TIERS: FuseBuildTier[] = ['prototype', 'full_build', 'iterate'];

interface FuseConfig {
  apiUrl: string;
  token: string;
  serviceAccountId: string;
}

interface FuseUpgradeParams {
  project_id: string;
  additional_context?: string;
}

function getFuseConfig(): FuseConfig {
  const apiUrl = process.env.FUSE_API_URL;
  const token = process.env.FUSE_SERVICE_TOKEN;
  const serviceAccountId = process.env.GLYPHOR_SERVICE_ACCOUNT_ID ?? 'glyphor-service-account';

  if (!apiUrl || !token) {
    throw new Error('Fuse is not configured. Set FUSE_API_URL and FUSE_SERVICE_TOKEN in the agent runtime environment.');
  }

  return {
    apiUrl: apiUrl.replace(/\/$/, ''),
    token,
    serviceAccountId,
  };
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

function normalizeBrandContext(value: unknown): FuseBrandContext {
  const input = asRecord(value);

  const visualStyle = pickString(input, 'visual_style');
  const animationPreference = pickString(input, 'animation_preference');

  const allowedVisualStyles: FuseVisualStyle[] = ['minimal', 'bold', 'editorial', 'playful', 'dark_glass'];
  const allowedAnimationPrefs: FuseAnimationPreference[] = ['none', 'subtle', 'rich'];

  return {
    brand_name: pickString(input, 'brand_name') ?? DEFAULT_BRAND_CONTEXT.brand_name,
    primary_color: pickString(input, 'primary_color') ?? DEFAULT_BRAND_CONTEXT.primary_color,
    secondary_color: pickString(input, 'secondary_color') ?? DEFAULT_BRAND_CONTEXT.secondary_color,
    accent_color: pickString(input, 'accent_color') ?? DEFAULT_BRAND_CONTEXT.accent_color,
    heading_font: pickString(input, 'heading_font') ?? DEFAULT_BRAND_CONTEXT.heading_font,
    body_font: pickString(input, 'body_font') ?? DEFAULT_BRAND_CONTEXT.body_font,
    visual_style: (visualStyle && allowedVisualStyles.includes(visualStyle as FuseVisualStyle)
      ? visualStyle
      : DEFAULT_BRAND_CONTEXT.visual_style) as FuseVisualStyle,
    animation_preference: (animationPreference && allowedAnimationPrefs.includes(animationPreference as FuseAnimationPreference)
      ? animationPreference
      : DEFAULT_BRAND_CONTEXT.animation_preference) as FuseAnimationPreference,
  };
}

function normalizeBuildTiers(input?: FuseBuildTier[]): FuseBuildTier[] {
  if (!Array.isArray(input) || input.length === 0) return [...ALL_BUILD_TIERS];
  const unique = new Set<FuseBuildTier>();
  for (const tier of input) {
    if (ALL_BUILD_TIERS.includes(tier)) unique.add(tier);
  }
  if (unique.size === 0) return [...ALL_BUILD_TIERS];
  return [...unique];
}

function buildAccountProfileOverride(brand: FuseBrandContext): Record<string, unknown> {
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

function buildFusePayload(params: FuseBuildParams, serviceAccountId: string, brand: FuseBrandContext): Record<string, unknown> {
  return {
    prompt: params.brief,
    userId: serviceAccountId,
    projectTypeHint: params.project_type,
    projectId: params.project_id,
    brandContext: brand,
    accountProfileOverride: buildAccountProfileOverride(brand),
  };
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

function normalizeFuseResult(payload: unknown, tier: FuseBuildTier): FuseBuildResult {
  const record = asRecord(payload);
  const data = asRecord(record.data);
  const result = asRecord(record.result);

  const merged = { ...record, ...data, ...result };

  return {
    project_id: pickString(merged, 'project_id', 'projectId', 'id'),
    preview_url: pickString(merged, 'preview_url', 'previewUrl', 'preview'),
    deploy_url: pickString(merged, 'deploy_url', 'deployUrl', 'deployment_url', 'deploymentUrl'),
    github_pr_url: pickString(merged, 'github_pr_url', 'githubPrUrl', 'pull_request_url', 'pullRequestUrl'),
    build_report: merged.build_report ?? merged.buildReport ?? merged.qa_report ?? merged.qa,
    agent_trace: merged.agent_trace ?? merged.agentTrace ?? merged.trace,
    tier_used: tier,
    raw: payload,
  };
}

function mergeFuseResults(current: FuseBuildResult | null, incoming: FuseBuildResult): FuseBuildResult {
  if (!current) return incoming;
  return {
    project_id: incoming.project_id ?? current.project_id,
    preview_url: incoming.preview_url ?? current.preview_url,
    deploy_url: incoming.deploy_url ?? current.deploy_url,
    github_pr_url: incoming.github_pr_url ?? current.github_pr_url,
    build_report: incoming.build_report ?? current.build_report,
    agent_trace: incoming.agent_trace ?? current.agent_trace,
    tier_used: incoming.tier_used,
    raw: incoming.raw ?? current.raw,
  };
}

function parseSseBlock(block: string): { eventName?: string; data?: string } {
  const lines = block.split(/\r?\n/);
  let eventName: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }

  return {
    eventName,
    data: dataLines.length > 0 ? dataLines.join('\n') : undefined,
  };
}

async function parseFuseSseResponse(response: Response, tier: FuseBuildTier): Promise<FuseBuildResult> {
  if (!response.body) {
    return { tier_used: tier };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let aggregated: FuseBuildResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      const { eventName, data } = parseSseBlock(block);
      if (!data) continue;
      if (data === '[DONE]') {
        return aggregated ?? { tier_used: tier };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(data) as unknown;
      } catch {
        continue;
      }

      const eventError = extractErrorMessage(parsed);
      if (eventName === 'error' || eventName === 'failed' || eventError) {
        throw new Error(eventError ?? 'Fuse stream emitted an error event.');
      }

      aggregated = mergeFuseResults(aggregated, normalizeFuseResult(parsed, tier));
    }
  }

  if (buffer.trim()) {
    const { data } = parseSseBlock(buffer);
    if (data && data !== '[DONE]') {
      try {
        aggregated = mergeFuseResults(aggregated, normalizeFuseResult(JSON.parse(data) as unknown, tier));
      } catch {
        // Ignore trailing non-JSON fragments.
      }
    }
  }

  return aggregated ?? { tier_used: tier };
}

async function parseFuseResponse(response: Response, tier: FuseBuildTier): Promise<FuseBuildResult> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (contentType.includes('text/event-stream')) {
    return parseFuseSseResponse(response, tier);
  }

  const rawText = await response.text();
  if (!rawText.trim()) {
    return { tier_used: tier };
  }

  try {
    const json = JSON.parse(rawText) as unknown;
    return normalizeFuseResult(json, tier);
  } catch {
    return {
      tier_used: tier,
      build_report: rawText,
    };
  }
}

async function executeFuseRequest(
  path: string,
  body: Record<string, unknown>,
  tier: FuseBuildTier,
  ctx: ToolContext,
): Promise<FuseBuildResult> {
  const config = getFuseConfig();

  const response = await fetch(`${config.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify(body),
    signal: ctx.abortSignal,
  });

  if (!response.ok) {
    const rawText = await response.text().catch(() => '');
    let parsedError: string | null = null;
    try {
      parsedError = extractErrorMessage(JSON.parse(rawText) as unknown);
    } catch {
      parsedError = rawText.trim() ? rawText.trim() : null;
    }
    throw new Error(`Fuse API ${path} returned ${response.status}${parsedError ? `: ${parsedError}` : ''}`);
  }

  return parseFuseResponse(response, tier);
}

async function executeFuseBuild(params: FuseBuildParams, ctx: ToolContext): Promise<FuseBuildResult> {
  const config = getFuseConfig();
  const brand = normalizeBrandContext(params.brand_context);
  const endpoint = params.tier === 'prototype'
    ? '/prototype'
    : params.tier === 'iterate'
      ? '/iterate'
      : '/create-and-build';

  const payload = buildFusePayload(params, config.serviceAccountId, brand);
  const result = await executeFuseRequest(endpoint, payload, params.tier, ctx);
  return {
    ...result,
    tier_used: params.tier,
  };
}

async function executeFuseUpgrade(params: FuseUpgradeParams, ctx: ToolContext): Promise<FuseBuildResult> {
  const config = getFuseConfig();
  const payload: Record<string, unknown> = {
    projectId: params.project_id,
    additionalContext: params.additional_context,
    userId: config.serviceAccountId,
    brandContext: DEFAULT_BRAND_CONTEXT,
    accountProfileOverride: buildAccountProfileOverride(DEFAULT_BRAND_CONTEXT),
  };

  try {
    return await executeFuseRequest('/upgrade-prototype', payload, 'full_build', ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('404')) throw error;
    return executeFuseRequest('/upgrade', payload, 'full_build', ctx);
  }
}

function truncateSummary(input: string): string {
  const clean = input.trim().replace(/\s+/g, ' ');
  return clean.length > 90 ? `${clean.slice(0, 87)}...` : clean;
}

export function createFuseTools(memory: CompanyMemoryStore, policy: FuseToolPolicy = {}): ToolDefinition[] {
  const allowBuild = policy.allowBuild !== false;
  const allowIterate = policy.allowIterate !== false;
  const allowUpgrade = policy.allowUpgrade !== false;
  const allowedBuildTiers = normalizeBuildTiers(policy.allowedBuildTiers);

  const tools: ToolDefinition[] = [];

  if (allowBuild) {
    tools.push({
      name: 'invoke_fuse_build',
      description: 'Build a complete web application or page using Fuse. Provide a detailed brief and tier; Fuse handles architecture, design, implementation, QA, and deployment.',
      parameters: {
        brief: {
          type: 'string',
          description: 'Detailed description of what to build: purpose, audience, functionality, visual direction, content requirements, and technical constraints.',
          required: true,
        },
        tier: {
          type: 'string',
          enum: allowedBuildTiers,
          description: 'prototype: fast preview, full_build: full QA/deploy pipeline, iterate: targeted modifications to an existing Fuse project.',
          required: true,
        },
        project_type: {
          type: 'string',
          enum: ['react_spa', 'nextjs_fullstack', 'fastapi_backend', 'legacy_refactor', 'dbt_pipeline', 'terraform_infra'],
          description: 'Optional project type hint for Fuse auto-routing.',
        },
        project_id: {
          type: 'string',
          description: 'Required when tier is iterate. Existing Fuse project ID to modify.',
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

        const tier = String(params.tier ?? '').trim() as FuseBuildTier;
        if (!allowedBuildTiers.includes(tier)) {
          return { success: false, error: `Tier "${tier}" is not permitted for this agent. Allowed: ${allowedBuildTiers.join(', ')}` };
        }

        if (tier === 'iterate' && !String(params.project_id ?? '').trim()) {
          return { success: false, error: 'Parameter "project_id" is required when tier is "iterate".' };
        }

        try {
          const result = await executeFuseBuild({
            brief,
            tier,
            project_type: params.project_type as FuseProjectType | undefined,
            project_id: params.project_id as string | undefined,
            brand_context: params.brand_context as Partial<FuseBrandContext> | undefined,
          }, ctx);

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'fuse',
            summary: `Fuse ${tier}: ${truncateSummary(brief)}`,
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
      name: 'invoke_fuse_iterate',
      description: 'Modify an existing Fuse project using targeted change instructions. Fuse applies changes, verifies the build, and redeploys.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'Fuse project ID from a previous build.',
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
          const result = await executeFuseBuild({
            brief: changes,
            tier: 'iterate',
            project_id: projectId,
          }, ctx);

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'fuse',
            summary: `Fuse iterate ${projectId}: ${truncateSummary(changes)}`,
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
      name: 'invoke_fuse_upgrade',
      description: 'Upgrade a Fuse prototype to a full production build with QA, GitHub commit/PR metadata, and deployment artifacts.',
      parameters: {
        project_id: {
          type: 'string',
          description: 'Prototype Fuse project ID to upgrade.',
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
          const result = await executeFuseUpgrade({
            project_id: projectId,
            additional_context: additionalContext || undefined,
          }, ctx);

          await memory.appendActivity({
            agentRole: ctx.agentRole,
            action: 'deploy',
            product: 'fuse',
            summary: `Fuse upgrade ${projectId}${additionalContext ? `: ${truncateSummary(additionalContext)}` : ''}`,
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