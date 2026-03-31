# Glyphor Web Template — Agent Manifest

Read this file completely before writing any code.
This is the contract between the template and the agent.

## Stack

- React 18 + Vite + TypeScript
- Tailwind CSS v4 (CSS-first config via @theme in styles/)
- shadcn/ui (new-york style, components in src/components/ui/)
- ReactBits Pro (via @reactbits-pro registry in components.json)
- Aceternity UI (via @aceternity registry in components.json)
- Framer Motion
- react-router-dom
- Vercel deploy (vercel.json already configured)
- npm

## What Already Exists — Do Not Recreate or Modify

These files are pre-configured. Leave them exactly as they are:

- vite.config.ts
- tsconfig.json
- tsconfig.app.json
- tsconfig.node.json
- vercel.json
- eslint.config.js
- components.json
- package.json (you MAY add missing dependencies only — never delete or rewrite)
- public/ (leave all existing public assets)

## What You Write — Complete File List

Write ALL of these with complete content. No stubs. No TODOs.

### Root
- index.html — HTML shell with meta/OG tags, Google Fonts in <head>, <div id="root">, <script type="module" src="/src/main.tsx">

### src/ (do not modify main.tsx)
- src/App.tsx — root composition, imports and renders ALL section components
- src/styles/theme.css — CSS variables only (:root and .dark blocks)
- src/styles/fonts.css — font-face or @import definitions only
- src/styles/index.css — import hub: fonts → tailwind → theme
- src/styles/tailwind.css — Tailwind v4 config (@import "tailwindcss", @source, @custom-variant dark, @theme inline token bridge, @layer base)
- src/components/<SectionName>.tsx — one file per page section
- src/lib/utils.ts — cn() utility (already exists, you may extend)
- src/hooks/ — custom hooks if needed
- src/data/ — static data/content files if needed

### Required Sections (minimum)
Every build must include components for: nav, hero, [brief-specific sections], cta, footer

## Component Registry — Lookup Order

Before writing any component, look up the real API:

1. shadcn/ui — for ALL functional UI primitives
   (buttons, inputs, dialogs, cards, tabs, navigation menus, etc.)
   Use: search_components, get_component_info, install_item_from_registry

2. ReactBits Pro (@reactbits-pro) — for motion and ambient effects
   (text animations, background effects, scroll triggers, counters, magnetic effects)
   Use: install_item_from_registry with @reactbits-pro/ prefix

3. Aceternity (@aceternity) — for cinematic structural anchors ONLY
   (spotlight, parallax, 3D card, beam backgrounds)
   MAX 2 Aceternity components per page. Never for decoration.
   Use: search_components, get_component_info (aceternityui-mcp)

4. Framer Motion — for transitions, hover states, scroll-driven animations
   that don't need a pre-built component

NEVER stack two animation libraries on the same section.
NEVER use Aceternity for functional UI primitives.
NEVER use ReactBits for layout or structural elements.

## Color System — Token-First (Non-Negotiable)

All colors MUST go through CSS variables defined in theme.css.
Map them to Tailwind via @theme inline in tailwind.css.

### Required CSS variables (define ALL in theme.css :root)
--background, --foreground
--card, --card-foreground
--popover, --popover-foreground
--primary, --primary-foreground
--secondary, --secondary-foreground
--muted, --muted-foreground
--accent, --accent-foreground
--destructive, --destructive-foreground
--border, --input, --ring, --radius

### Hard Bans
- NEVER hardcode hex/rgb/hsl/oklch values in className strings
- NEVER use text-white, text-black, bg-white, bg-black directly
- NEVER use arbitrary Tailwind values like bg-[#1a1d2e]
- If you need opacity, use token opacity variants: text-foreground/80, bg-card/70

### Color Composition (70/20/10)
- 70% neutral surfaces (bg-background, bg-card, bg-muted)
- 20% supporting contrast (secondary, border emphasis, text hierarchy)
- 10% accent/CTA (primary, accent — CTAs, active states, key highlights ONLY)
- Never use primary or accent as full-section backgrounds
- Minimum 60% of sections must use neutral surface tokens

## Typography Rules

- Headlines: text-5xl to text-8xl, font-black or font-bold, commanding
- Mix weights dramatically — combine font-thin with font-black for visual tension
- Letter-spacing and line-height matter — tune them explicitly
- Body: readable, high-contrast, never sacrificed for mood
- Brand wordmark: text only — NEVER reference /images/logo* or generate a logo image

## Layout Principles

- Avoid standard SaaS grid layouts and interchangeable card sections
- Use asymmetry, strong negative space, confident vertical rhythm
- Each section is a visual moment, not a reusable block
- Text over images/video MUST have overlay for readability — never rely on luck

## Image Budget

- 3–5 images maximum unless brief explicitly requires more
- HARD CAP: never exceed 7 unique /images/* paths
- Reference images as /images/filename.ext (never public/images/...)
- Every image referenced in components MUST appear in image_manifest
- Reuse image paths across sections instead of inventing new ones
- Images must harmonize with primary accent — no new accent colors introduced via imagery

## Scrollbar Polish (Always Apply)

Add to src/styles/tailwind.css @layer base:
  * { scrollbar-width: none; -ms-overflow-style: none; }
  *::-webkit-scrollbar { display: none; }

## Design Plan Commitment

Before writing any component code, commit to a design_plan that includes:
- sections[] with id, objective, surface token, interaction intent
- color_strategy with surface_ladder, accent_policy, section_surface_map, cta_color_map
- interaction_budget: motion signals min 3, hover/focus min 10, primary CTA interactions min 2
- brief_alignment: at least 3 explicit brief-to-implementation commitments

The color_strategy declared in the plan MUST match the className values in the actual components.
No divergence between plan and code.

## Quality Gates (All Must Pass Before Shipping)

1. No hardcoded color values anywhere in className strings
2. All section components imported and rendered in App.tsx
3. theme.css has all required CSS variables
4. All /images/* paths exist in image_manifest
5. Brand wordmark is text-only (no image asset)
6. Text over media has overlay and is readable
7. Responsive at 1440, 1024, 768, 375
8. No console.log in committed code
9. No inline styles — Tailwind classes only
10. Scrollbar hidden across all browsers
