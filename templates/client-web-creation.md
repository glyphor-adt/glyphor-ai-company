---
name: client-web-creation
slug: client-web-creation
category: design
description: Execute Glyphor's end-to-end client website pipeline — from normalized brief to quality-gated deployed site. Use when asked to build any client website, landing page, or marketing site. This skill governs design quality, component selection, build execution, and iteration discipline. It is a mandatory operating pipeline, not optional guidance.
holders: frontend-engineer, vp-design, ui-ux-designer, cto, cmo
tools_granted: normalize_design_brief, github_create_from_template, vercel_create_project, vercel_get_preview_url, cloudflare_register_preview, cloudflare_update_preview, search_components, get_component_info, get_installation_info, install_item_from_registry, build_website_foundation, github_push_files, github_create_pull_request, github_merge_pull_request, deploy_preview, screenshot_page, check_ai_smell, run_accessibility_audit, run_lighthouse_audit, save_memory, send_agent_message
version: 1
---

# Client Web Creation

This skill governs every client website build. Follow the pipeline exactly.
Do not skip phases. Do not reorder steps.

## The Model

You are running on Claude Opus 4.6 with 128K output tokens.
Use this capacity. Output complete files. No stubs. No placeholders.
One structured build call. Everything in one pass.

## The Stack (Non-Negotiable)

- React 18 + Vite + TypeScript
- Tailwind CSS v4 (token-first, @theme inline)
- shadcn/ui (new-york style)
- ReactBits Pro (via @reactbits-pro registry)
- Aceternity (structural anchors only, max 2 per page)
- Framer Motion (transitions and choreography)
- Vercel deploy

## Mandatory Pipeline

### Phase 1 — Brief Normalization
Run `normalize_design_brief` on the raw directive.
Output must include: brandName, projectSlug, projectType, visualManifesto, signatureFeature.
If any field is missing or generic, the brief is not ready. Refine before proceeding.

### Phase 2 — Infrastructure Provisioning
These two calls happen before any code is written:

1. `github_create_from_template` — creates new client repo from the Glyphor Fuse template.
   Use projectSlug as repo_name. This sets up the complete file scaffold automatically.

2. `vercel_create_project` — links the new repo to a Vercel project.
   Preview deployments activate automatically on every push.

### Phase 3 — Component Research
Before writing a single component, look up what's available:

1. For each planned section, call `search_components` or `get_component_info`
2. Identify which library owns each component (see hierarchy below)
3. Call `install_item_from_registry` for any ReactBits Pro or Aceternity components
4. Note exact import paths — never guess at component APIs

**Component Hierarchy (lookup order):**
1. shadcn/ui → ALL functional UI primitives (buttons, inputs, nav, cards, tabs, dialogs)
2. ReactBits Pro (@reactbits-pro) → motion and ambient effects
   - Text animations, background effects, scroll triggers, counters, particle systems
   - magnetic effects, split text, animated gradients
3. Aceternity (@aceternity) → cinematic structural anchors ONLY
   - Spotlight, parallax, 3D card, beam backgrounds, spotlight card
   - MAX 2 per page. Never for functional UI. Never for decoration.
4. Framer Motion → transitions, hover states, scroll-driven animations

**Hard Rule:** Never stack two animation libraries on the same section.

### Phase 4 — Design Plan Commitment
Before writing code, produce and commit to a design_plan:

```
design_plan: {
  sections: [
    { id: "nav", objective, surface: "bg-background/90", interaction }
    { id: "hero", objective, surface: "bg-background", interaction }
    { id: "...", objective, surface, interaction }
    { id: "cta", objective, surface: "bg-muted", interaction }
    { id: "footer", objective, surface: "bg-background", interaction }
  ],
  color_strategy: {
    surface_ladder: "background → card → muted; secondary for support only",
    accent_policy: "primary/accent only on CTAs, active states, key highlights",
    section_surface_map: { nav, hero, ..., cta, footer },
    cta_color_map: { primary_cta, secondary_cta }
  },
  interaction_budget: {
    motion_signals_min: 3,
    hover_focus_signals_min: 10,
    primary_cta_interactions_min: 2
  },
  brief_alignment: ["...", "...", "..."]  // min 3 explicit commitments
}
```

The color_strategy declared here MUST match the actual className values in code.
No divergence permitted.

### Phase 5 — Build
Call `codex` with the complete normalized brief, brand_spec, intake_context,
and design_plan as the prompt.

```typescript
codex({
  prompt: [normalizedBrief, brandSpec, intakeContext, designPlan].join('\n\n'),
  repo: `Glyphor-Fuse/${projectSlug}`,
  branch: 'feature/initial-build',
  skill: 'ux-engineer',
  approval_policy: 'never',
  sandbox: 'workspace-write'
})
```

**What codex produces (all in one call):**
- index.html (with Google Fonts, OG tags)
- src/App.tsx (imports and renders ALL sections)
- src/styles/theme.css (all CSS variables)
- src/styles/fonts.css
- src/styles/index.css
- src/styles/tailwind.css (v4 with @theme inline token bridge)
- src/components/<Section>.tsx (one per section)
- image_manifest (prompts for any generated images)

### Phase 6 — Preview, Register, and Capture
After build_website_foundation pushes files to GitHub, Vercel auto-deploys.

1. `vercel_get_preview_url` — poll until READY (returns Vercel deployment URL)
2. `cloudflare_register_preview` — writes metadata to R2, returns clean URL:
   https://{projectSlug}.preview.glyphor.ai
3. `screenshot_page` at 1440, 1024, 768, 375 — using the clean preview URL

Always use the preview.glyphor.ai URL for screenshots and client sharing.
Never share raw Vercel deployment URLs externally.

On iteration rounds use `cloudflare_update_preview` with the new deployment URL.

### Phase 7 — Automated Gates (All Must Pass)
Run in order. Any failure blocks scoring and requires fix first.

1. `check_ai_smell` — any flag = automatic revision required
2. `run_accessibility_audit` — any WCAG AA failure = automatic block
3. `run_lighthouse_audit` — performance < 80 = revision required
4. Breakpoint check — any layout break = automatic revision

### Phase 8 — Design Review
Submit preview URL + screenshots to design-critic for elite-design-review scoring.

Score thresholds:
- 90–100: Ship immediately
- 75–89: Targeted revisions, max 2 rounds
- 60–74: Significant work needed
- Below 60: Restart with new brief direction

### Phase 9 — Iteration
Apply design-critic feedback via `build_website_foundation` with patched files,
then `github_push_files` to commit. Vercel auto-deploys the new revision.

After each deploy:
1. `vercel_get_preview_url` — wait for READY
2. `cloudflare_update_preview` — update R2 with new deployment URL
3. `screenshot_page` — capture updated preview
4. Re-run automated gates
5. Re-submit to design-critic for updated score

Maximum 3 iteration rounds. Escalate if score not clearing after 3.

### Phase 10 — Ship
When score >= 90 and all gates pass:
- `github_create_pull_request` from the working branch to `main`
- devops-engineer verifies checks and uses `github_merge_pull_request`
- Vercel auto-deploys to production
- Save final brief, score breakdown, and winning patterns to memory

## Design Quality Rules

### Typography
- Headlines: text-5xl to text-8xl, font-black or font-bold
- Mix weights dramatically — combine extremes for visual tension
- Never flat typography hierarchy — size range must be wide
- Letter-spacing and line-height tuned explicitly per heading level

### Color (70/20/10)
- 70% neutral surfaces (bg-background, bg-card, bg-muted)
- 20% supporting contrast (secondary, border, text hierarchy)
- 10% accent/CTA (primary, accent — sparingly and purposefully)
- NEVER hardcode hex/rgb/hsl in className strings
- NEVER use text-white, text-black, bg-white, bg-black directly
- Token opacity variants only: text-foreground/80, bg-card/70

### Layout
- Avoid predictable SaaS grids and interchangeable card sections
- Asymmetry, negative space, confident vertical rhythm
- Each section is a visual moment with a distinct composition
- Text over imagery MUST have overlay — never rely on contrast luck

### Brand Logo
- Text wordmark only — the brand name in styled text
- NEVER reference /images/logo* or generate a logo image asset
- Place in navbar and footer minimum

### Scrollbar
Always add to tailwind.css @layer base:
```css
* { scrollbar-width: none; -ms-overflow-style: none; }
*::-webkit-scrollbar { display: none; }
```

## Post-Ship Learning
After every shipped build scoring 90+:
1. Save memory with: brief, score breakdown, strengths, what improved score
2. Save winning component combinations by section type
3. Save palette/typography pairings that worked
4. Note any ReactBits/Aceternity components that performed well

This compounds quality over time. Every build makes the next one better.

## Escalation Rules
- Missing tools: send_agent_message to devops-engineer
- Score stuck below 75 after 2 rounds: escalate to vp-design for creative direction
- Build errors in codex: inspect error, fix brief, retry once, then escalate to cto
- Vercel deployment failing: escalate to devops-engineer with build logs
