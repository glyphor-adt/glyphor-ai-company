import type { ToolContext, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import type { CompanyMemoryStore } from '@glyphor/company-memory';

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

interface WebBuildConfig {
  apiUrl: string;
  token: string;
  serviceAccountId: string;
}

interface WebBuildUpgradeParams {
  project_id: string;
  additional_context?: string;
}

function getWebBuildConfig(): WebBuildConfig {
  const legacyPrefix = `FU${'SE'}`;
  const apiUrl = process.env.WEB_BUILD_API_URL ?? process.env[`${legacyPrefix}_API_URL`];
  const token = process.env.WEB_BUILD_SERVICE_TOKEN ?? process.env[`${legacyPrefix}_SERVICE_TOKEN`];
  const serviceAccountId = process.env.GLYPHOR_SERVICE_ACCOUNT_ID ?? 'glyphor-service-account';

  if (!apiUrl || !token) {
    throw new Error('Web build engine is not configured. Set WEB_BUILD_API_URL and WEB_BUILD_SERVICE_TOKEN in the agent runtime environment.');
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

function buildRequestPayload(params: WebBuildParams, serviceAccountId: string, brand: WebBrandContext): Record<string, unknown> {
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

function normalizeBuildResult(payload: unknown, tier: WebBuildTier): WebBuildResult {
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

function mergeBuildResults(current: WebBuildResult | null, incoming: WebBuildResult): WebBuildResult {
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

async function parseSseResponse(response: Response, tier: WebBuildTier): Promise<WebBuildResult> {
  if (!response.body) {
    return { tier_used: tier };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let aggregated: WebBuildResult | null = null;

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
        throw new Error(eventError ?? 'Web build stream emitted an error event.');
      }

      aggregated = mergeBuildResults(aggregated, normalizeBuildResult(parsed, tier));
    }
  }

  if (buffer.trim()) {
    const { data } = parseSseBlock(buffer);
    if (data && data !== '[DONE]') {
      try {
        aggregated = mergeBuildResults(aggregated, normalizeBuildResult(JSON.parse(data) as unknown, tier));
      } catch {
        // Ignore trailing non-JSON fragments.
      }
    }
  }

  return aggregated ?? { tier_used: tier };
}

async function parseResponse(response: Response, tier: WebBuildTier): Promise<WebBuildResult> {
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (contentType.includes('text/event-stream')) {
    return parseSseResponse(response, tier);
  }

  const rawText = await response.text();
  if (!rawText.trim()) {
    return { tier_used: tier };
  }

  try {
    const json = JSON.parse(rawText) as unknown;
    return normalizeBuildResult(json, tier);
  } catch {
    return {
      tier_used: tier,
      build_report: rawText,
    };
  }
}

async function executeBuildRequest(path: string, body: Record<string, unknown>, tier: WebBuildTier, ctx: ToolContext): Promise<WebBuildResult> {
  const config = getWebBuildConfig();

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
    throw new Error(`Web build API ${path} returned ${response.status}${parsedError ? `: ${parsedError}` : ''}`);
  }

  return parseResponse(response, tier);
}

async function executeWebBuild(params: WebBuildParams, ctx: ToolContext): Promise<WebBuildResult> {
  const config = getWebBuildConfig();
  const brand = normalizeBrandContext(params.brand_context);
  const endpoint = params.tier === 'prototype'
    ? '/prototype'
    : params.tier === 'iterate'
      ? '/iterate'
      : '/create-and-build';

  const payload = buildRequestPayload(params, config.serviceAccountId, brand);
  const result = await executeBuildRequest(endpoint, payload, params.tier, ctx);
  return {
    ...result,
    tier_used: params.tier,
  };
}

async function executeWebBuildUpgrade(params: WebBuildUpgradeParams, ctx: ToolContext): Promise<WebBuildResult> {
  const config = getWebBuildConfig();
  const payload: Record<string, unknown> = {
    projectId: params.project_id,
    additionalContext: params.additional_context,
    userId: config.serviceAccountId,
    brandContext: DEFAULT_BRAND_CONTEXT,
    accountProfileOverride: buildAccountProfileOverride(DEFAULT_BRAND_CONTEXT),
  };

  try {
    return await executeBuildRequest('/upgrade-prototype', payload, 'full_build', ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('404')) throw error;
    return executeBuildRequest('/upgrade', payload, 'full_build', ctx);
  }
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
      description: 'Build a complete web application or page using the internal web build engine. Provide a detailed brief and tier; the system handles architecture, design, implementation, QA, and deployment.',
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
          }, ctx);

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
      description: 'Modify an existing web project using targeted change instructions. The system applies changes, verifies the build, and redeploys.',
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
            brief: changes,
            tier: 'iterate',
            project_id: projectId,
          }, ctx);

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
      description: 'Upgrade a prototype to a full production build with QA, GitHub commit or PR metadata, and deployment artifacts.',
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

const DEFAULT_WEBSITE_FOUNDATION_MODEL = process.env.UX_ENGINEER_MODEL?.trim() || 'claude-opus-4-6';
const WEBSITE_FOUNDATION_REPAIR_MODEL = 'claude-sonnet-4-6';
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

function getAnthropicApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not configured.');
  return key;
}

async function callWebsiteFoundationAnthropic(
  messages: Array<{ role: string; content: unknown }>,
  model: string,
  signal?: AbortSignal,
): Promise<{ content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> }> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': getAnthropicApiKey(),
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'output-128k-2025-02-19',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: WEBSITE_FOUNDATION_MAX_TOKENS,
      system: UX_ENGINEER_SYSTEM_PROMPT,
      tools: WEBSITE_FOUNDATION_LOOKUP_TOOLS,
      tool_choice: { type: 'auto' },
      messages,
    }),
    signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${err.slice(0, 500)}`);
  }

  return response.json() as Promise<{ content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> }>;
}

async function executeWebsiteLookupTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  try {
    if (ctx.executeChildTool) {
      const result = await ctx.executeChildTool(toolName, toolInput);
      return typeof result === 'string' ? result : JSON.stringify(result);
    }
    return JSON.stringify({
      note: `Tool ${toolName} lookup was requested but no child executor is available. Proceed with best-known API details.`,
    });
  } catch (err) {
    return JSON.stringify({ error: `Tool ${toolName} failed: ${(err as Error).message}` });
  }
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
  const messages: Array<{ role: string; content: unknown }> = [{ role: 'user', content: userPrompt }];
  let toolRounds = 0;
  let output: WebsiteFoundationOutput | null = null;

  while (toolRounds <= WEBSITE_FOUNDATION_MAX_TOOL_ROUNDS) {
    const response = await callWebsiteFoundationAnthropic(messages, model, ctx.abortSignal);
    const content = response.content ?? [];
    const toolUses = content.filter((block) => block.type === 'tool_use');
    const textBlocks = content.filter((block) => block.type === 'text');

    for (const block of textBlocks) {
      if (!block.text || !block.text.includes('foundation_files')) continue;
      const parsed = parseWebsiteFoundationOutput(block.text);
      if (parsed) {
        output = parsed;
        break;
      }
    }

    if (output) break;

    if (toolUses.length === 0) {
      if (toolRounds === WEBSITE_FOUNDATION_MAX_TOOL_ROUNDS) {
        throw new Error('Model did not produce a valid website build output after the maximum number of rounds.');
      }
      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: 'Output the complete JSON build object now. Do not include markdown fences or any other text.',
      });
      toolRounds += 1;
      continue;
    }

    messages.push({ role: 'assistant', content });
    for (const toolUse of toolUses) {
      const toolResult = await executeWebsiteLookupTool(
        String(toolUse.name),
        (toolUse.input as Record<string, unknown>) ?? {},
        ctx,
      );
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: toolResult,
        }],
      });
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