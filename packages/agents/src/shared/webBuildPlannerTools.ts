/**
 * plan_website_build — Architecture Planner with Brief Normalization
 *
 * Before any code is generated, this tool:
 *   1. Normalizes the user brief (audience, CTA, palette, emotional target)
 *   2. Produces a structured build plan (components, theme, layout, files)
 *   3. Generates an image manifest with generation prompts (max 7 images)
 *   4. Returns everything for agent/user review before executing
 *
 * The agent then executes the plan file-by-file using write_frontend_file
 * or passes it to invoke_web_build for single-shot execution.
 *
 * Images are generated AFTER the build passes sandbox validation.
 * Videos are NEVER included unless the user explicitly requests them.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { ModelClient } from '@glyphor/agent-runtime';
import { getTierModel } from '@glyphor/shared';

// ─── Constants ────────────────────────────────────────────────────────────────

const PLANNER_MODEL = process.env.PLANNER_MODEL?.trim() || getTierModel('default');
const MAX_IMAGE_MANIFEST_ITEMS = 7;
const PLANNER_TIMEOUT_MS = 45_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ImageManifestEntry {
  fileName: string;
  prompt: string;
  aspect_ratio: string;
  altText: string;
}

interface ComponentSpec {
  filePath: string;
  name: string;
  purpose: string;
  props: string;
  keyElements: string;
  animations: string;
}

interface NormalizedBrief {
  audience: string;
  primaryCta: string;
  emotionalTarget: string;
  oneSentenceMemory: string;
  aestheticDirection: string;
  productType: 'marketing_page' | 'web_application';
}

interface BuildPlan {
  projectName: string;
  normalizedBrief: NormalizedBrief;
  visualDirection: string;
  colorPalette: {
    background: string;
    foreground: string;
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    accent: string;
    accentForeground: string;
    muted: string;
    mutedForeground: string;
    card: string;
    cardForeground: string;
    border: string;
    ring: string;
  };
  colorStrategy: {
    surfaceLadder: string;
    accentPolicy: string;
    sectionSurfaceMap: Record<string, string>;
    ctaColorMap: Record<string, string>;
  };
  fonts: {
    heading: string;
    body: string;
    googleFontsUrl: string;
  };
  sections: Array<{
    id: string;
    component: string;
    objective: string;
    interaction: string;
    surface: string;
  }>;
  components: ComponentSpec[];
  themeTokens: string;
  layoutStructure: string;
  imageManifest: ImageManifestEntry[];
}

// ─── Planner System Prompt ────────────────────────────────────────────────────

const PLANNER_SYSTEM = `You are a world-class website architect. Given a project brief, you produce a comprehensive build plan that a design engineer will execute.

OUTPUT: Respond ONLY with valid JSON matching the schema below. No markdown fences, no extra text.

STEP 1 — NORMALIZE THE BRIEF:
Before planning, extract these from the brief (infer sensible defaults if not stated):
- audience: Who is this for? Be specific (e.g. "homeowners in Haslet TX looking for landscaping services")
- primaryCta: What action should visitors take? (e.g. "Request a free quote", "Book a consultation")
- emotionalTarget: What should the visitor FEEL? (e.g. "trust and confidence in a local expert")
- oneSentenceMemory: One sentence that captures the core value proposition
- aestheticDirection: Visual direction derived from the business type and audience
- productType: "marketing_page" (landing pages, business sites) or "web_application" (tools, dashboards)

STEP 2 — DESIGN DECISIONS:
- Choose colors that match the BUSINESS and its AUDIENCE. Examples:
  - Landscaping → earthy greens (#4A7C59), warm browns, cream backgrounds
  - Bakery/restaurant → warm tones, inviting yellows/oranges, light backgrounds
  - Tech/SaaS → clean blues, whites, modern grays
  - Luxury brand → black, gold, deep tones
  - Children/family → bright, playful, light backgrounds
  - Medical/legal → trustworthy blues, clean whites, professional
  NEVER use generic dark mode (#0A0A0B) for every project. Match the business personality.
- Choose fonts that match the brand personality (professional service → clean serif/sans, creative → distinctive display font)
- Design the section structure FROM THE BRIEF — do NOT use the same sections every time:
  - What is the business selling? Design sections around THAT.
  - A circus site needs: acts lineup, showtime picker, ticket tiers, FAQ — NOT generic "services/testimonials/CTA"
  - A landscaping site needs: service areas, project gallery, estimate form — NOT a generic SaaS layout
  - A restaurant needs: menu, reservations, location, atmosphere photos — NOT feature cards
  - Think about what THIS business's customer journey looks like and build sections for THAT.
- Each section needs a distinct surface (use at least 3 different surfaces for visual rhythm)

STEP 3 — IMAGE MANIFEST:
- Plan up to ${MAX_IMAGE_MANIFEST_ITEMS} images maximum
- ALWAYS include at least 3 images for marketing pages — sites without images look broken and unprofessional
- Each image needs a generation prompt: [Subject] [Context] [Lighting] [Materials] [Mood] [Style]
- Images must be RELEVANT to the specific business (landscaping → manicured lawns, not abstract gradients)
- Use realistic photography style for business sites, illustration for creative projects
- Plan the budget BEFORE listing — reuse images across sections when possible
- NEVER include videos unless the brief explicitly mentions video, animation, or motion background

DESIGN RULES:
- Stunning, premium, scroll-stopping — never generic or template-like
- Bold typography: mix weights dramatically (font-thin with font-black), oversized headlines (text-5xl to text-8xl)
- Rich interactions: hover states, scroll reveals, transitions via Framer Motion
- 70/20/10 color composition: 70% neutral surfaces, 20% supporting contrast, 10% accent/CTA
- Token-safe colors ONLY (CSS variables, never hardcoded hex/rgb in classNames)
- Brand logo as TEXT WORDMARK only (never an image asset)

STACK (non-negotiable):
- React 18 + Vite + TypeScript
- Tailwind CSS v4 (CSS-first, @theme inline token bridge in tailwind.css)
- shadcn/ui new-york style (imports from @/components/ui/<name>)
- Framer Motion for animations
- lucide-react for icons (NEVER emoji as icons)
- Google Fonts loaded in index.html <head>

REQUIRED FILES (the template repo provides the build toolchain — you create these):
1. index.html — HTML shell with meta/OG tags, Google Fonts, <div id="root"></div>, Vite entry
2. src/App.tsx — Root composition importing ALL section components
3. src/styles/theme.css — :root CSS variables for the full shadcn token set
4. src/styles/fonts.css — Font variable definitions (no @import)
5. src/styles/index.css — Import hub: fonts.css → tailwind.css → theme.css
6. src/styles/tailwind.css — @import "tailwindcss"; @theme inline token bridge; base styles
7. src/components/*.tsx — All section components with COMPLETE implementations

DO NOT create/modify: vite.config.ts, src/main.tsx, tsconfig.json, vercel.json, eslint.config.js

JSON SCHEMA:
{
  "projectName": "string",
  "normalizedBrief": {
    "audience": "string",
    "primaryCta": "string",
    "emotionalTarget": "string",
    "oneSentenceMemory": "string",
    "aestheticDirection": "string",
    "productType": "marketing_page | web_application"
  },
  "visualDirection": "2-3 sentence creative direction",
  "colorPalette": {
    "background": "hex", "foreground": "hex",
    "primary": "hex", "primaryForeground": "hex",
    "secondary": "hex", "secondaryForeground": "hex",
    "accent": "hex", "accentForeground": "hex",
    "muted": "hex", "mutedForeground": "hex",
    "card": "hex", "cardForeground": "hex",
    "border": "hex", "ring": "hex"
  },
  "colorStrategy": {
    "surfaceLadder": "how background/card/muted are used across sections",
    "accentPolicy": "where primary/accent are allowed vs forbidden",
    "sectionSurfaceMap": { "hero": "bg-background", "features": "bg-card", ... },
    "ctaColorMap": { "primaryCta": "bg-primary text-primary-foreground", ... }
  },
  "fonts": {
    "heading": "font family name",
    "body": "font family name",
    "googleFontsUrl": "full Google Fonts CSS2 URL"
  },
  "sections": [
    { "id": "string", "component": "PascalCase", "objective": "string", "interaction": "string", "surface": "string" }
  ],
  "components": [
    { "filePath": "src/components/X.tsx", "name": "X", "purpose": "string", "props": "string", "keyElements": "string", "animations": "string" }
  ],
  "themeTokens": "complete :root block with ALL shadcn CSS variables",
  "layoutStructure": "how App.tsx composes sections (import order + JSX)",
  "imageManifest": [
    { "fileName": "/images/hero.jpg", "prompt": "[Subject] [Context] [Lighting] [Mood] [Style]", "aspect_ratio": "16:9", "altText": "string" }
  ]
}`;

// ─── Helper: detect if user explicitly requested video ────────────────────────

function briefRequestsVideo(brief: string): boolean {
  return /\b(video|animation|motion\s+background|hero\s+video|video\s+hero|cinematic\s+loop|background\s+video)\b/i.test(brief);
}

// ─── Tool Definition ──────────────────────────────────────────────────────────

export function createWebBuildPlannerTools(): ToolDefinition[] {
  return [
    {
      name: 'plan_website_build',
      description:
        'Plan a website build: normalizes the brief (audience, CTA, palette), generates a ' +
        'structured architecture spec (components, theme, layout, color strategy), and creates ' +
        'an image manifest with generation prompts. Call this BEFORE building.\n\n' +
        'Returns: normalized brief, component specs, theme tokens, image manifest, and ' +
        'step-by-step execution instructions. The agent then either:\n' +
        'A) Passes the plan to invoke_web_build for single-shot execution, or\n' +
        'B) Writes files one-by-one via write_frontend_file for iterative control.',
      parameters: {
        brief: {
          type: 'string',
          description: 'What to build: business type, location, purpose, audience, features, visual direction.',
          required: true,
        },
        brand_name: {
          type: 'string',
          description: 'Brand or business name.',
          required: false,
        },
        visual_style: {
          type: 'string',
          description: 'Visual style preference. If omitted, inferred from business type.',
          required: false,
          enum: ['minimal', 'bold', 'editorial', 'playful', 'dark_glass', 'warm', 'earthy', 'clean', 'luxury'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const brief = String(params.brief ?? '').trim();
        if (!brief) {
          return { success: false, error: 'Parameter "brief" is required.' };
        }

        const brandName = String(params.brand_name ?? '').trim();
        const visualStyle = String(params.visual_style ?? '').trim();
        const wantsVideo = briefRequestsVideo(brief);

        const userPrompt = [
          `PROJECT BRIEF: ${brief}`,
          brandName ? `BRAND NAME: ${brandName}` : '',
          visualStyle ? `VISUAL STYLE: ${visualStyle}` : '',
          `IMAGE BUDGET: Plan up to ${MAX_IMAGE_MANIFEST_ITEMS} images. Use realistic photography relevant to this specific business.`,
          wantsVideo
            ? 'VIDEO: User explicitly requested video. You may include up to 2 video_manifest entries.'
            : 'VIDEO: Do NOT include any video manifest. User did not request video.',
          '',
          'Produce the complete JSON build plan.',
        ].filter(Boolean).join('\n');

        try {
          const modelClient = new ModelClient({
            geminiApiKey: process.env.GOOGLE_AI_API_KEY,
            openaiApiKey: process.env.OPENAI_API_KEY,
          });

          const response = await modelClient.generate({
            model: PLANNER_MODEL,
            systemInstruction: PLANNER_SYSTEM,
            contents: [{ role: 'user', content: userPrompt, timestamp: Date.now() }],
            callTimeoutMs: PLANNER_TIMEOUT_MS,
          });

          const text = response.text ?? '';
          const cleaned = text
            .replace(/^```(?:json)?\s*/m, '')
            .replace(/\s*```\s*$/m, '')
            .trim();

          let plan: BuildPlan;
          try {
            plan = JSON.parse(cleaned) as BuildPlan;
          } catch {
            // Fallback: extract JSON object from response
            const jsonMatch = cleaned.match(/\{[\s\S]*"components"[\s\S]*\}/);
            if (!jsonMatch) {
              return { success: false, error: `Failed to parse build plan JSON. Raw: ${cleaned.slice(0, 500)}` };
            }
            plan = JSON.parse(jsonMatch[0]) as BuildPlan;
          }

          if (!plan.components?.length || !plan.sections?.length) {
            return { success: false, error: 'Build plan is missing components or sections.' };
          }

          // Enforce image budget
          if (plan.imageManifest && plan.imageManifest.length > MAX_IMAGE_MANIFEST_ITEMS) {
            plan.imageManifest = plan.imageManifest.slice(0, MAX_IMAGE_MANIFEST_ITEMS);
          }

          const componentNames = plan.components.map(c => c.name).join(', ');
          const imageCount = plan.imageManifest?.length ?? 0;

          return {
            success: true,
            data: {
              plan,
              normalizedBrief: plan.normalizedBrief,
              fileCount: plan.components.length + 6,
              imageCount,
              instructions: [
                `## Build Plan: ${plan.projectName}`,
                '',
                `**Audience:** ${plan.normalizedBrief?.audience ?? 'Not specified'}`,
                `**CTA:** ${plan.normalizedBrief?.primaryCta ?? 'Not specified'}`,
                `**Visual direction:** ${plan.visualDirection}`,
                `**Components:** ${componentNames}`,
                `**Images to generate:** ${imageCount}`,
                '',
                '### Execution order:',
                '1. `invoke_web_build` with tier `prototype` and the brief from this plan',
                '   OR write files manually:',
                '   a. `github_create_from_template` to create the repo',
                '   b. Write style files: theme.css, tailwind.css, fonts.css, index.css',
                `   c. Write components: ${componentNames}`,
                '   d. Write App.tsx and index.html',
                '   e. `github_push_files` to commit',
                '2. After deploy succeeds, images will be generated from the manifest',
                '3. Share the preview URL with the user',
              ].join('\n'),
            },
          };
        } catch (err) {
          return { success: false, error: `plan_website_build failed: ${(err as Error).message}` };
        }
      },
    },
  ];
}
