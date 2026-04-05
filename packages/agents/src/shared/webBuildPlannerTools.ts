/**
 * plan_website_build — Multi-Turn Website Build Planner
 *
 * Instead of generating an entire website in one massive 100K-token API call,
 * this tool produces a structured build plan that the agent then executes
 * file-by-file using its normal turn loop. Each file becomes a separate tool
 * call (write_frontend_file / github_push_files), giving the agent:
 *
 *   - Fast per-file feedback (no 15-minute timeout)
 *   - Ability to self-correct after each file
 *   - Normal supervisor turn budgeting
 *   - Model routing through the standard subtask router
 *
 * Flow:
 *   1. Agent calls plan_website_build with brief
 *   2. Tool returns: file list, component specs, theme tokens, brand config
 *   3. Agent writes each file using write_frontend_file (or github_push_files batch)
 *   4. Agent calls deploy_preview when done
 *
 * This replaces the monolithic build_website_foundation for on-demand chat.
 * The original single-shot tool remains available for scheduled/background builds.
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';
import { getTierModel } from '@glyphor/shared';

const PLANNER_MODEL = getTierModel('default');

// ─── Types ────────────────────────────────────────────────────────────────────

interface ComponentSpec {
  filePath: string;
  name: string;
  purpose: string;
  props: string;
  keyElements: string;
  animations: string;
}

interface BuildPlan {
  projectName: string;
  visualDirection: string;
  colorPalette: {
    background: string;
    foreground: string;
    primary: string;
    secondary: string;
    accent: string;
    muted: string;
    card: string;
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
    surface: string;
  }>;
  components: ComponentSpec[];
  themeTokens: string;
  layoutStructure: string;
  imageNeeds: Array<{
    path: string;
    description: string;
    aspectRatio: string;
  }>;
}

// ─── System Prompt for the Planner ────────────────────────────────────────────

const PLANNER_SYSTEM = `You are a website architecture planner. Given a project brief, you produce a structured build plan that a frontend engineer will execute file-by-file.

OUTPUT: Respond ONLY with valid JSON matching the schema below. No markdown fences, no extra text.

DESIGN PRIORITIES:
- Stunning, premium, scroll-stopping designs — never generic
- Bold typography: mix weights dramatically, oversized headlines
- Rich interactions: hover states, scroll reveals, transitions via Framer Motion
- Token-safe colors only (CSS variables, not hardcoded hex in classNames)

STACK (non-negotiable):
- React 18 + Vite + TypeScript
- Tailwind CSS v4 (CSS-first, @theme inline token bridge)
- shadcn/ui new-york style (imports from @/components/ui/<name>)
- Framer Motion for animations
- lucide-react for icons (never emoji)
- Google Fonts in index.html <head>

JSON SCHEMA:
{
  "projectName": "string",
  "visualDirection": "string — 2-3 sentence creative direction",
  "colorPalette": {
    "background": "hsl value",
    "foreground": "hsl value",
    "primary": "hsl value",
    "secondary": "hsl value",
    "accent": "hsl value",
    "muted": "hsl value",
    "card": "hsl value"
  },
  "fonts": {
    "heading": "font family name",
    "body": "font family name",
    "googleFontsUrl": "full Google Fonts <link> href URL"
  },
  "sections": [
    {
      "id": "nav|hero|features|pricing|cta|footer|etc",
      "component": "ComponentName",
      "objective": "what this section achieves",
      "surface": "bg-background|bg-muted|bg-card|etc"
    }
  ],
  "components": [
    {
      "filePath": "src/components/Hero.tsx",
      "name": "Hero",
      "purpose": "what it does and why",
      "props": "interface definition sketch",
      "keyElements": "key visual elements and layout approach",
      "animations": "framer motion interactions"
    }
  ],
  "themeTokens": "complete CSS variable block for :root in theme.css",
  "layoutStructure": "how App.tsx should compose the sections",
  "imageNeeds": [
    {
      "path": "/images/hero.png",
      "description": "what the image should show",
      "aspectRatio": "16:9"
    }
  ]
}`;

// ─── Tool Definition ──────────────────────────────────────────────────────────

export function createWebBuildPlannerTools(): ToolDefinition[] {
  return [
    {
      name: 'plan_website_build',
      description:
        'Plan a website build by producing a structured architecture spec: components, theme, ' +
        'layout, and file list. After calling this, write each file using write_frontend_file ' +
        'or github_push_files. This is faster and more reliable than invoke_web_build for ' +
        'on-demand chat because each file is a separate turn with immediate feedback.\n\n' +
        'WORKFLOW:\n' +
        '1. Call plan_website_build with the brief\n' +
        '2. Create the GitHub repo with github_create_from_template\n' +
        '3. Write theme.css with the themeTokens from the plan\n' +
        '4. Write tailwind.css, fonts.css, index.css\n' +
        '5. Write each component from the components list\n' +
        '6. Write App.tsx composing all components per layoutStructure\n' +
        '7. Write index.html with Google Fonts\n' +
        '8. Push all files with github_push_files\n' +
        '9. Call deploy_preview or vercel_get_preview_url',
      parameters: {
        brief: {
          type: 'string',
          description: 'What to build: purpose, audience, features, visual direction, content requirements.',
          required: true,
        },
        brand_name: {
          type: 'string',
          description: 'Brand/project name. Defaults to inferred from brief.',
          required: false,
        },
        visual_style: {
          type: 'string',
          description: 'Visual style preference.',
          required: false,
          enum: ['minimal', 'bold', 'editorial', 'playful', 'dark_glass'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const brief = String(params.brief ?? '').trim();
        if (!brief) {
          return { success: false, error: 'Parameter "brief" is required.' };
        }

        const brandName = String(params.brand_name ?? '').trim();
        const visualStyle = String(params.visual_style ?? '').trim();

        const userPrompt = [
          `PROJECT BRIEF: ${brief}`,
          brandName ? `BRAND NAME: ${brandName}` : '',
          visualStyle ? `VISUAL STYLE: ${visualStyle}` : '',
          '',
          'Produce the complete JSON build plan.',
        ].filter(Boolean).join('\n');

        try {
          // Use the default tier model — this is a planning call, not code generation.
          // The plan is small (2-5K tokens), fast (<10s), and cheap.
          const model = PLANNER_MODEL;

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': process.env.ANTHROPIC_API_KEY?.trim() || '',
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-6',
              max_tokens: 8000,
              system: PLANNER_SYSTEM,
              messages: [{ role: 'user', content: userPrompt }],
            }),
            signal: AbortSignal.timeout(30_000),
          });

          if (!response.ok) {
            const err = await response.text();
            return { success: false, error: `Planner API error (${response.status}): ${err.slice(0, 300)}` };
          }

          const result = await response.json() as {
            content: Array<{ type: string; text?: string }>;
          };

          const text = result.content?.find(b => b.type === 'text')?.text ?? '';
          const cleaned = text
            .replace(/^```(?:json)?\s*/m, '')
            .replace(/\s*```\s*$/m, '')
            .trim();

          let plan: BuildPlan;
          try {
            plan = JSON.parse(cleaned) as BuildPlan;
          } catch {
            return { success: false, error: `Failed to parse build plan JSON. Raw output: ${cleaned.slice(0, 500)}` };
          }

          if (!plan.components?.length || !plan.sections?.length) {
            return { success: false, error: 'Build plan is missing components or sections.' };
          }

          // Return the plan as structured data — the agent writes each file in subsequent turns
          return {
            success: true,
            data: {
              plan,
              fileCount: plan.components.length + 6, // components + theme + tailwind + fonts + index.css + App.tsx + index.html
              instructions: [
                `Build plan ready: ${plan.components.length} components, ${plan.sections.length} sections.`,
                '',
                'Execute the plan by writing files in this order:',
                '1. github_create_from_template to create the repo',
                '2. src/styles/theme.css — use themeTokens from plan',
                '3. src/styles/tailwind.css — standard Tailwind v4 setup',
                '4. src/styles/fonts.css — @font-face rules for plan.fonts',
                '5. src/styles/index.css — global resets and base styles',
                `6. Each component: ${plan.components.map(c => c.name).join(', ')}`,
                '7. src/App.tsx — compose all components per layoutStructure',
                '8. index.html — with Google Fonts link and Vite entry',
                '9. github_push_files to commit everything',
                '10. deploy_preview or vercel_get_preview_url for the live link',
                '',
                'Write each component as COMPLETE, PRODUCTION-READY code. No stubs. No TODOs.',
                'Use the component specs in plan.components for props, purpose, and animations.',
                'Use token-safe colors only (CSS variables via theme.css, never hardcoded hex).',
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
