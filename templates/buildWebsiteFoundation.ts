/**
 * build_website_foundation
 *
 * The core website generation tool. Uses Gemini 3.1 Pro (128K output) with
 * the adapted uxEngineer instruction set.
 *
 * How it works:
 * 1. Accepts normalized brief, brand_spec, intake_context, and any pre-installed
 *    component metadata from MCP lookups the agent performed beforehand.
 * 2. Calls Gemini 3.1 Pro with the full design engineering system prompt.
 * 3. The model optionally calls shadcn/aceternity MCP lookup tools before
 *    committing to the build, then outputs a single structured JSON with all files.
 * 4. Returns a flat file map ready for github_push_files.
 *
 * Add to: packages/agents/src/shared/webBuildTools.ts
 * Register in: packages/agents/src/shared/createRunDeps.ts tool list
 *
 * Required env:
 *   GOOGLE_AI_API_KEY / GEMINI_API_KEY — Gemini API key
 *   UX_ENGINEER_MODEL — defaults to gemini-3.1-pro-preview (override for cost savings)
 */

import type { ToolContext, ToolDefinition, ToolResult } from '@glyphor/agent-runtime';

// ─── Model Config ─────────────────────────────────────────────────────────────

const DEFAULT_MODEL = 'gemini-3.1-pro-preview';
const REPAIR_MODEL = 'gemini-3.1-flash-lite-preview'; // faster/cheaper for iteration rounds
const MAX_TOKENS = 100000;
const MAX_TOOL_ROUNDS = 4; // max MCP lookup rounds before forcing build output
const MAX_IMAGES = 7;
const MAX_VIDEOS = 2;

// ─── System Prompt ────────────────────────────────────────────────────────────

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
2. ReactBits Pro (@reactbits-pro) — motion and ambient effects ONLY:
   - Text animations (split-text, blur-text, gradient-text, text-animate)
   - Background effects (particles, aurora, noise, grid)
   - Scroll reveals, counters, magnetic effects, shimmer
3. Aceternity (@aceternity) — cinematic structural anchors ONLY:
   - Spotlight, parallax, 3D card, beam backgrounds
   - MAX 2 Aceternity components per page. Never for decoration.
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
- One dominant accent family; secondary accent usage sparse and purposeful

LEGIBILITY:
- Text over imagery MUST have overlay for readability — overlays, gradients, blurs, or masks
- Never rely on luck or subtle contrast for critical text
- Headlines and body copy must stay high-contrast on all surfaces

SCROLLBAR POLISH (Always Apply):
In src/styles/tailwind.css @layer base:
  * { scrollbar-width: none; -ms-overflow-style: none; }
  *::-webkit-scrollbar { display: none; }

IMAGERY RULES:
- 3–5 images unless brief explicitly requires more
- HARD CAP: never exceed ${MAX_IMAGES} unique /images/* paths total
- Reference images as /images/filename.ext (NEVER public/images/...)
- Every /images/* path in components MUST appear in image_manifest
- Reuse image paths across sections instead of inventing new ones
- Images must harmonize with primary accent — no new accent colors via imagery
- Text over images requires overlay

IMAGE BUDGET CONTRACT:
1. Decide the COMPLETE image budget before writing components
2. Define image_manifest first, then reuse ONLY those paths in components
3. Do not invent extra image paths after the manifest is set
4. If you need more visuals than budget allows, reuse existing paths intentionally

IMAGE MANIFEST PROMPTS:
Format each prompt as: [Subject] [Context] [Lighting] [Materials] [Mood] [Style]
Keep imagery cohesive — consistent lighting and mood across all images.

FILE CONTRACT (Write ALL of these with COMPLETE content):

1. index.html
   - HTML shell, meta/OG tags, Google Fonts in <head> (preconnect + stylesheet)
   - <div id="root"></div>
   - <script type="module" src="/src/main.tsx"></script>

2. src/App.tsx
   - QueryClient, Toaster, TooltipProvider at root
   - Import { Toaster } from "@/components/ui/sonner"
   - Import and render ALL section components in order

3. src/styles/theme.css
   - :root and .dark blocks with CSS variable values ONLY
   - REQUIRED vars: --background, --foreground, --card, --card-foreground,
     --popover, --popover-foreground, --primary, --primary-foreground,
     --secondary, --secondary-foreground, --muted, --muted-foreground,
     --accent, --accent-foreground, --destructive, --destructive-foreground,
     --border, --input, --ring, --radius, --input-background, --switch-background,
     --chart-1 through --chart-5, --sidebar, --sidebar-foreground,
     --sidebar-primary, --sidebar-primary-foreground, --sidebar-accent,
     --sidebar-accent-foreground, --sidebar-border, --sidebar-ring,
     --font-size, --font-weight-medium, --font-weight-normal
   - Use explicit color syntax: hex, rgb(), hsl(), oklch()
   - NO @theme inline, @layer base, or @import here

4. src/styles/fonts.css
   - Font variable definitions only (NO external @import)
   - Keep family names unquoted

5. src/styles/index.css
   - Import hub in this exact order:
     @import "./fonts.css";
     @import "./tailwind.css";
     @import "./theme.css";

6. src/styles/tailwind.css
   - MUST use: @import "tailwindcss";
   - Then: @source "../**/*.{js,ts,jsx,tsx}";
   - Then: @custom-variant dark (&:where(.dark, .dark *));
   - Then: @theme inline { } token bridge mapping --color-* to var(--*)
   - Then: @layer base { typography + body styles + scrollbar polish }
   - Then: @layer utilities { font helpers }
   - DO NOT use @import 'tailwindcss' source(none)

7. src/components/<SectionName>.tsx
   - One file per section: Nav.tsx, Hero.tsx, [brief-specific], CTA.tsx, Footer.tsx
   - Each component is complete and self-contained

8. src/lib/utils.ts (if cn() not already present from template)
9. src/hooks/*.ts and src/data/*.ts as needed

PACKAGE.JSON SAFETY CONTRACT:
- MAY add missing dependencies only — never delete or rewrite existing keys
- Never convert package manager or lockfile strategy

PRE-OUTPUT VERIFICATION CHECKLIST:
Before producing the JSON output, verify ALL of the following:
[ ] All files have COMPLETE content — no stubs, no TODO comments
[ ] No hardcoded hex/rgb/hsl values in any className string
[ ] No text-white, text-black, bg-white, bg-black in classNames
[ ] App.tsx imports and renders every section component
[ ] theme.css has all required CSS variables
[ ] All /images/* paths in components appear in image_manifest
[ ] Brand logo is text wordmark — no /images/logo* anywhere
[ ] Text over media has overlay
[ ] design_plan.color_strategy matches actual className values in code
[ ] Scrollbar polish applied in tailwind.css @layer base

OUTPUT JSON SCHEMA:
{
  "architectural_reasoning": "string — your design and technical reasoning",
  "design_plan": {
    "summary": "string",
    "sections": [
      {
        "id": "string (e.g. nav, hero, features, cta, footer)",
        "objective": "string",
        "interaction": "string",
        "surface": "string (e.g. bg-background)"
      }
    ],
    "interaction_budget": {
      "motion_signals_min": 3,
      "hover_focus_signals_min": 10,
      "primary_cta_interactions_min": 2
    },
    "brief_alignment": ["string", "string", "string"],
    "color_strategy": {
      "surface_ladder": "string",
      "accent_policy": "string",
      "section_surface_map": {
        "nav": "bg-background/90",
        "hero": "bg-background",
        "cta": "bg-muted",
        "footer": "bg-background"
      },
      "cta_color_map": {
        "primary_cta": "bg-primary text-primary-foreground",
        "secondary_cta": "bg-accent text-accent-foreground"
      }
    }
  },
  "foundation_files": [
    { "filePath": "index.html", "content": "string — COMPLETE file content" },
    { "filePath": "src/App.tsx", "content": "string — COMPLETE file content" },
    { "filePath": "src/styles/theme.css", "content": "string — COMPLETE file content" },
    { "filePath": "src/styles/fonts.css", "content": "string — COMPLETE file content" },
    { "filePath": "src/styles/index.css", "content": "string — COMPLETE file content" },
    { "filePath": "src/styles/tailwind.css", "content": "string — COMPLETE file content" }
  ],
  "components": [
    { "filePath": "src/components/Nav.tsx", "content": "string — COMPLETE component" },
    { "filePath": "src/components/Hero.tsx", "content": "string — COMPLETE component" }
  ],
  "utility_files": [
    { "filePath": "src/lib/utils.ts", "content": "string — only if needed" }
  ],
  "image_manifest": [
    {
      "fileName": "/images/hero.png",
      "prompt": "string — Subject Context Lighting Materials Mood Style",
      "aspect_ratio": "16:9",
      "altText": "string"
    }
  ]
}
`.trim();

// ─── MCP Lookup Tool Definitions (passed to Claude for component research) ───

const MCP_LOOKUP_TOOLS = [
  {
    name: 'search_components',
    description:
      'Search the shadcn/ui and Aceternity component registries by name, description, or tags. ' +
      'Use this to discover available components before writing code.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query, e.g. "animated button" or "hero spotlight"',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_component_info',
    description:
      'Get detailed API information for a specific component: props, usage examples, import path. ' +
      'Always call this before using an Aceternity or ReactBits component to verify the exact API.',
    input_schema: {
      type: 'object' as const,
      properties: {
        component_name: {
          type: 'string',
          description: 'Component name, e.g. "spotlight" or "3d-card"',
        },
      },
      required: ['component_name'],
    },
  },
  {
    name: 'get_installation_info',
    description:
      'Get installation command and setup instructions for a component. ' +
      'Use for ReactBits Pro and Aceternity components.',
    input_schema: {
      type: 'object' as const,
      properties: {
        component_name: {
          type: 'string',
          description: 'Component name to get installation info for',
        },
        registry: {
          type: 'string',
          description: 'Registry prefix: "@reactbits-pro", "@aceternity", or omit for shadcn',
          enum: ['@reactbits-pro', '@aceternity', '@reactbits-starter'],
        },
      },
      required: ['component_name'],
    },
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileEntry {
  filePath: string;
  content: string;
}

interface ImageManifestEntry {
  fileName: string;
  prompt: string;
  aspect_ratio: string;
  altText: string;
}

interface BuildOutput {
  architectural_reasoning: string;
  design_plan: Record<string, unknown>;
  foundation_files: FileEntry[];
  components: FileEntry[];
  utility_files?: FileEntry[];
  image_manifest: ImageManifestEntry[];
}

// ─── Gemini API Helpers ───────────────────────────────────────────────────────

function getGeminiApiKey(): string {
  const key = (process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || '').trim();
  if (!key) throw new Error('GOOGLE_AI_API_KEY / GEMINI_API_KEY is not configured.');
  return key;
}

// Gemini function declarations (converted from MCP_LOOKUP_TOOLS Anthropic format)
const MCP_LOOKUP_TOOLS_GEMINI = {
  functionDeclarations: MCP_LOOKUP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: 'OBJECT' as const,
      properties: Object.fromEntries(
        Object.entries(t.input_schema.properties).map(([k, v]) => [k, { type: 'STRING', description: (v as { description: string }).description }]),
      ),
      required: t.input_schema.required,
    },
  })),
};

type NormalizedContent = { type: string; text?: string; id?: string; name?: string; input?: unknown };

async function callGemini(
  messages: Array<{ role: string; content: unknown }>,
  model: string,
  signal?: AbortSignal,
): Promise<{ content: NormalizedContent[] }> {
  const apiKey = getGeminiApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Convert Anthropic-style messages to Gemini parts format
  const geminiContents: Array<{ role: string; parts: unknown[] }> = [];
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      geminiContents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
    } else if (Array.isArray(msg.content)) {
      // Anthropic tool_result messages → Gemini functionResponse
      const parts: unknown[] = [];
      for (const block of msg.content as Array<Record<string, unknown>>) {
        if (block.type === 'tool_result') {
          parts.push({ functionResponse: { name: String(block.tool_use_id ?? ''), response: { result: block.content } } });
        } else if (block.type === 'text') {
          parts.push({ text: block.text });
        } else if (block.type === 'tool_use') {
          parts.push({ functionCall: { name: block.name, args: block.input } });
        }
      }
      if (parts.length > 0) {
        geminiContents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
      }
    }
  }

  const body = {
    systemInstruction: { parts: [{ text: UX_ENGINEER_SYSTEM_PROMPT }] },
    tools: [MCP_LOOKUP_TOOLS_GEMINI],
    generationConfig: { maxOutputTokens: 65536, temperature: 0.7 },
    contents: geminiContents,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${err.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const normalized: NormalizedContent[] = [];
  let toolIdx = 0;
  for (const part of parts) {
    if (typeof part.text === 'string') {
      normalized.push({ type: 'text', text: part.text });
    } else if (part.functionCall) {
      const fc = part.functionCall as { name: string; args?: unknown };
      normalized.push({ type: 'tool_use', id: `${fc.name}_${toolIdx++}`, name: fc.name, input: fc.args ?? {} });
    }
  }
  return { content: normalized };
}

// ─── Anthropic API Helpers (kept as fallback for non-Gemini models) ───────────

function getAnthropicApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not configured.');
  return key;
}

async function callAnthropic(
  messages: Array<{ role: string; content: unknown }>,
  model: string,
  signal?: AbortSignal,
): Promise<{ content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> }> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': getAnthropicApiKey(),
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'output-128k-2025-02-19',  // 128K output token beta
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: UX_ENGINEER_SYSTEM_PROMPT,
      tools: MCP_LOOKUP_TOOLS,
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

// Minimal MCP tool executor — calls the real shadcn/aceternity MCP tools
// These are available to the agent's runtime via glyphorMcpTools.
// For now we return a stub that tells the model the tool was called.
// Wire to real MCP calls by injecting the executor via ToolContext.
async function executeMcpLookupTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  try {
    // Delegate to the runtime tool executor if available
    if (ctx.executeChildTool) {
      const result = await ctx.executeChildTool(toolName, toolInput);
      return typeof result === 'string' ? result : JSON.stringify(result);
    }
    // Fallback: return a helpful message so the model can proceed
    return JSON.stringify({
      note: `Tool ${toolName} lookup was requested but MCP executor not available in this context. ` +
            `Proceed with your best knowledge of the ${toolInput.component_name || toolInput.query} component API.`,
    });
  } catch (err) {
    return JSON.stringify({ error: `Tool ${toolName} failed: ${(err as Error).message}` });
  }
}

// ─── Build Output Parser ──────────────────────────────────────────────────────

function parseBuildOutput(text: string): BuildOutput | null {
  // Strip any accidental markdown fences
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as BuildOutput;
    if (!parsed.foundation_files || !parsed.components) return null;
    return parsed;
  } catch {
    // Try to extract JSON from within the text
    const jsonMatch = cleaned.match(/\{[\s\S]*"foundation_files"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as BuildOutput;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function flattenFiles(output: BuildOutput): Record<string, string> {
  const files: Record<string, string> = {};
  for (const f of output.foundation_files ?? []) {
    if (f.filePath && f.content) files[f.filePath] = f.content;
  }
  for (const f of output.components ?? []) {
    if (f.filePath && f.content) files[f.filePath] = f.content;
  }
  for (const f of output.utility_files ?? []) {
    if (f.filePath && f.content) files[f.filePath] = f.content;
  }
  return files;
}

// ─── Main Tool Loop ───────────────────────────────────────────────────────────

async function runBuildLoop(
  userPrompt: string,
  model: string,
  ctx: ToolContext,
): Promise<{ output: BuildOutput; toolRounds: number }> {
  const messages: Array<{ role: string; content: unknown }> = [
    { role: 'user', content: userPrompt },
  ];

  let toolRounds = 0;
  let output: BuildOutput | null = null;

  while (toolRounds <= MAX_TOOL_ROUNDS) {
    const callFn = model.startsWith('gemini') ? callGemini : callAnthropic;
    const response = await callFn(messages, model, ctx.abortSignal);
    const content = response.content ?? [];

    // Collect tool uses and text
    const toolUses = content.filter((b) => b.type === 'tool_use');
    const textBlocks = content.filter((b) => b.type === 'text');

    // If there's a text block with JSON, try to parse it as the final output
    for (const block of textBlocks) {
      if (block.text && block.text.includes('foundation_files')) {
        const parsed = parseBuildOutput(block.text);
        if (parsed) {
          output = parsed;
          break;
        }
      }
    }

    if (output) break;

    // If no tool uses and no parseable output, something went wrong
    if (toolUses.length === 0) {
      // One more try with an explicit instruction
      if (toolRounds === MAX_TOOL_ROUNDS) {
        throw new Error(
          'Model did not produce build output after maximum rounds. ' +
          'Check the brief and try again.',
        );
      }
      messages.push({
        role: 'assistant',
        content,
      });
      messages.push({
        role: 'user',
        content: 'Please now output the complete JSON build object as described in the schema. ' +
                 'Do not include any other text — only the JSON object.',
      });
      toolRounds++;
      continue;
    }

    // Execute tool uses and continue
    messages.push({ role: 'assistant', content });

    const toolResults = await Promise.all(
      toolUses.map(async (tu) => ({
        type: 'tool_result' as const,
        tool_use_id: tu.id!,
        content: await executeMcpLookupTool(
          tu.name!,
          (tu.input ?? {}) as Record<string, unknown>,
          ctx,
        ),
      })),
    );

    messages.push({ role: 'user', content: toolResults });
    toolRounds++;
  }

  if (!output) {
    throw new Error('Failed to produce valid build output after tool loop.');
  }

  return { output, toolRounds };
}

// ─── Tool Definition ──────────────────────────────────────────────────────────

export function createWebBuildTools(): ToolDefinition[] {
  return [
    {
      name: 'build_website_foundation',
      description:
        'Generates a complete, production-ready client website from a normalized brief. ' +
        'Uses Gemini 3.1 Pro to produce all files in one structured pass: ' +
        'HTML, CSS, TypeScript components, theme tokens, and an image manifest. ' +
        'Always use this tool for new website builds. ' +
        'After this tool returns, call github_push_files to commit the output to the feature branch. ' +
        'Produces the design_plan and all file content in a single call — no iteration needed here.',
      parameters: {
        brand_spec: {
          type: 'string',
          description:
            'JSON string from normalize_design_brief. Contains brandName, projectSlug, ' +
            'projectType, visualManifesto, signatureFeature.',
          required: true,
        },
        intake_context: {
          type: 'string',
          description:
            'User intake answers (Q1-Q5): conversion goal, business model, visual tone, ' +
            'required sections, palette selection. Pass empty string if not collected.',
          required: false,
        },
        installed_components: {
          type: 'string',
          description:
            'JSON string listing any components already installed via install_item_from_registry ' +
            'before calling this tool. Include component names and their import paths.',
          required: false,
        },
        is_repair: {
          type: 'boolean',
          description:
            'Set to true for iteration rounds (design-critic feedback). ' +
            'Routes to claude-sonnet-4-6 for faster, cheaper repairs.',
          required: false,
        },
        repair_context: {
          type: 'string',
          description:
            'For repair rounds only: the design-critic feedback and previous build errors. ' +
            'Include the score breakdown and specific fix instructions.',
          required: false,
        },
        previous_files: {
          type: 'string',
          description:
            'For repair rounds only: JSON string of existing file map from previous build. ' +
            'The model will patch specific files rather than rebuilding everything.',
          required: false,
        },
      },
      async execute(
        params: Record<string, unknown>,
        ctx: ToolContext,
      ): Promise<ToolResult> {
        const brandSpecRaw = String(params.brand_spec ?? '').trim();
        if (!brandSpecRaw) {
          return { success: false, error: 'brand_spec is required.' };
        }

        const isRepair = Boolean(params.is_repair);
        const model = isRepair ? REPAIR_MODEL : (process.env.UX_ENGINEER_MODEL || DEFAULT_MODEL);
        const intakeContext = String(params.intake_context ?? '').trim();
        const installedComponents = String(params.installed_components ?? '').trim();
        const repairContext = String(params.repair_context ?? '').trim();
        const previousFiles = String(params.previous_files ?? '').trim();

        // Parse brand_spec
        let brandSpec: Record<string, unknown> = {};
        try {
          brandSpec = JSON.parse(brandSpecRaw) as Record<string, unknown>;
        } catch {
          return {
            success: false,
            error: 'brand_spec must be valid JSON from normalize_design_brief.',
          };
        }

        console.log(
          `[WebBuild] Starting ${isRepair ? 'repair' : 'initial build'} for "${brandSpec.brandName}" ` +
          `using ${model}`,
        );

        // Build the user prompt
        const promptSections: string[] = [];

        promptSections.push(`<normalized_design_brief>
Brand: ${brandSpec.brandName || 'Untitled'}
Project slug: ${brandSpec.projectSlug || 'project'}
Type: ${brandSpec.projectType || 'Landing Page'}
Visual manifesto: ${brandSpec.visualManifesto || 'Not specified'}
Signature feature: ${brandSpec.signatureFeature || 'Not specified'}
</normalized_design_brief>`);

        if (intakeContext) {
          promptSections.push(`<intake_context>
${intakeContext}
</intake_context>`);
        }

        if (installedComponents) {
          promptSections.push(`<installed_components>
The following components have already been installed via the registry.
Use these exact import paths — do not reinstall:
${installedComponents}
</installed_components>`);
        }

        if (isRepair && repairContext) {
          promptSections.push(`<repair_instructions>
This is a REPAIR ROUND. Fix only the issues listed below.
Keep all architecture and working components from the previous build.
Minimize changes to only what is required to resolve the feedback.

Design critic feedback:
${repairContext}
</repair_instructions>`);

          if (previousFiles) {
            promptSections.push(`<previous_build_files>
Existing file map (patch these, do not rewrite everything):
${previousFiles.slice(0, 20000)}
${previousFiles.length > 20000 ? '... (truncated — focus on files relevant to the feedback)' : ''}
</previous_build_files>`);
          }
        }

        promptSections.push(
          isRepair
            ? 'Produce the corrected JSON build output. Include ALL files — both corrected and unchanged ones.'
            : 'You may call search_components, get_component_info, or get_installation_info to verify ' +
              'component APIs before building. Then produce the complete JSON build output.',
        );

        const userPrompt = promptSections.join('\n\n');

        try {
          const { output, toolRounds } = await runBuildLoop(userPrompt, model, ctx);
          const files = flattenFiles(output);
          const fileCount = Object.keys(files).length;

          console.log(
            `[WebBuild] ✅ Build complete. Files: ${fileCount}, ` +
            `MCP lookup rounds: ${toolRounds}, ` +
            `Images: ${output.image_manifest?.length ?? 0}`,
          );

          return {
            success: true,
            data: {
              files,                          // Record<string, string> for github_push_files
              design_plan: output.design_plan,
              image_manifest: output.image_manifest ?? [],
              architectural_reasoning: output.architectural_reasoning,
              file_count: fileCount,
              mcp_lookup_rounds: toolRounds,
              model_used: model,
              message:
                `Build complete. ${fileCount} files generated. ` +
                `Next: call github_push_files with the files object to commit to the feature branch.`,
            },
          };
        } catch (err) {
          console.error(`[WebBuild] ❌ Build failed:`, err);
          return {
            success: false,
            error: `Website build failed: ${(err as Error).message}`,
          };
        }
      },
    },
  ];
}
