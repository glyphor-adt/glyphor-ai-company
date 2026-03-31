-- Sync client website pipeline skills, tool registry entries, and agent grants.
-- Source:
--   templates/client-web-creation.md
--   templates/react-bits-pro.md

BEGIN;

WITH tool_payload AS (
  SELECT *
  FROM (VALUES
    (
      'build_website_foundation',
      'Generate a complete production-ready client website foundation as a file map using the Glyphor UX engineer build system.',
      'design',
      '{"normalized_brief":{"type":"object","required":true},"brand_spec":{"type":"object"},"intake_context":{"type":"object"},"component_context":{"type":"object"},"repair_context":{"type":"string"},"model":{"type":"string"}}'::jsonb,
      ARRAY['website', 'design', 'foundation']::text[]
    ),
    (
      'github_create_from_template',
      'Create a new client GitHub repository from the Glyphor Fuse website template.',
      'integration',
      '{"repo_name":{"type":"string","required":true},"description":{"type":"string"},"owner":{"type":"string"},"private":{"type":"boolean"}}'::jsonb,
      ARRAY['github', 'website', 'provisioning']::text[]
    ),
    (
      'github_push_files',
      'Commit a file map to a GitHub branch in one batched operation.',
      'integration',
      '{"repo":{"type":"string","required":true},"branch":{"type":"string","required":true},"files":{"type":"object","required":true},"commit_message":{"type":"string"}}'::jsonb,
      ARRAY['github', 'website', 'delivery']::text[]
    ),
    (
      'vercel_create_project',
      'Create a Vercel project linked to a GitHub repository.',
      'integration',
      '{"repo_name":{"type":"string","required":true},"project_name":{"type":"string"},"framework":{"type":"string"},"github_org":{"type":"string"}}'::jsonb,
      ARRAY['vercel', 'website', 'provisioning']::text[]
    ),
    (
      'vercel_get_preview_url',
      'Get the latest preview deployment URL for a Vercel project.',
      'integration',
      '{"project_name":{"type":"string","required":true},"branch":{"type":"string"}}'::jsonb,
      ARRAY['vercel', 'website', 'preview']::text[]
    ),
    (
      'cloudflare_register_preview',
      'Register a Vercel deployment with the Glyphor preview system and return the clean preview URL.',
      'integration',
      '{"project_slug":{"type":"string","required":true},"vercel_deployment_url":{"type":"string","required":true},"github_repo_url":{"type":"string"},"project_name":{"type":"string"}}'::jsonb,
      ARRAY['cloudflare', 'website', 'preview']::text[]
    ),
    (
      'cloudflare_update_preview',
      'Update an existing Glyphor preview registration to point at the latest Vercel deployment.',
      'integration',
      '{"project_slug":{"type":"string","required":true},"vercel_deployment_url":{"type":"string","required":true},"github_repo_url":{"type":"string"},"project_name":{"type":"string"}}'::jsonb,
      ARRAY['cloudflare', 'website', 'preview']::text[]
    ),
    (
      'search_components',
      'Search component registries by name, description, or tags.',
      'design',
      '{"query":{"type":"string","required":true}}'::jsonb,
      ARRAY['components', 'lookup', 'design']::text[]
    ),
    (
      'get_component_info',
      'Get detailed API information for a specific component.',
      'design',
      '{"component_name":{"type":"string","required":true}}'::jsonb,
      ARRAY['components', 'lookup', 'design']::text[]
    ),
    (
      'get_installation_info',
      'Get installation and setup instructions for a component.',
      'design',
      '{"component_name":{"type":"string","required":true},"registry":{"type":"string"}}'::jsonb,
      ARRAY['components', 'lookup', 'design']::text[]
    ),
    (
      'install_item_from_registry',
      'Install a component from a configured shadcn-style registry.',
      'design',
      '{"name":{"type":"string","required":true}}'::jsonb,
      ARRAY['components', 'registry', 'design']::text[]
    )
  ) AS x(name, description, category, parameters, tags)
)
INSERT INTO tool_registry (name, description, category, parameters, created_by, approved_by, is_active, tags)
SELECT name, description, category, parameters, 'system', 'system', true, tags
FROM tool_payload
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  parameters = EXCLUDED.parameters,
  approved_by = EXCLUDED.approved_by,
  is_active = true,
  tags = EXCLUDED.tags,
  updated_at = NOW();

WITH skill_payload (slug, name, category, description, methodology, tools_granted, version) AS (
  VALUES
    (
      'client-web-creation',
      'client-web-creation',
      'design',
      'Execute Glyphor''s end-to-end client website pipeline — from normalized brief to quality-gated deployed site. Use when asked to build any client website, landing page, or marketing site. This skill governs design quality, component selection, build execution, and iteration discipline. It is a mandatory operating pipeline, not optional guidance.',
      $client_web_creation$
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
- Create PR from feature/initial-build to main
- devops-engineer merges to main
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
      $client_web_creation$,
      ARRAY[
        'normalize_design_brief',
        'github_create_from_template',
        'vercel_create_project',
        'vercel_get_preview_url',
        'cloudflare_register_preview',
        'cloudflare_update_preview',
        'search_components',
        'get_component_info',
        'get_installation_info',
        'install_item_from_registry',
        'build_website_foundation',
        'github_push_files',
        'deploy_preview',
        'screenshot_page',
        'check_ai_smell',
        'run_accessibility_audit',
        'run_lighthouse_audit',
        'save_memory',
        'send_agent_message'
      ]::text[],
      1
    ),
    (
      'react-bits-pro',
      'react-bits-pro',
      'design',
      'Select, install, and use ReactBits Pro components for motion and ambient visual effects in client website builds. Use when a section needs text animation, background motion, scroll-driven effects, counters, magnetic interactions, or ambient particle/gradient effects. ReactBits Pro is NOT for functional UI primitives — use shadcn for those. ReactBits Pro is NOT for cinematic full-bleed moments — use Aceternity for those. ReactBits Pro owns the layer in between: personality, energy, and motion that makes a page feel alive.',
      $react_bits_pro$
# ReactBits Pro

ReactBits Pro components are installed via the shadcn registry using the @reactbits-pro prefix.
Always install before using. Never import from a path you haven't verified exists.

## Installation Pattern

```bash
# Via install_item_from_registry tool
install_item_from_registry({ name: "@reactbits-pro/<component-name>" })
```

After installation, the component is in `src/components/ui/<component-name>.tsx`.
Import as: `import { ComponentName } from "@/components/ui/<component-name>"`

## When to Use ReactBits Pro

Use ReactBits Pro when a section needs:
- **Text that animates** — characters, words, or lines entering with motion
- **Backgrounds with ambient life** — particles, gradients that shift, noise textures
- **Scroll-driven reveals** — content that responds to scroll position with personality
- **Number counters** — metrics and stats that count up on enter
- **Magnetic effects** — cursor-responsive elements that add interactivity
- **Shimmer and glow** — highlight effects on cards, borders, or text
- **Split text choreography** — staggered character/word animations for headlines

## When NOT to Use ReactBits Pro

- Buttons, inputs, navigation, dialogs, tabs → use shadcn
- Full-bleed cinematic hero moments (spotlight, parallax depth) → use Aceternity
- Simple hover transitions on cards → use Framer Motion directly
- Anything that conflicts with another animation library on the same section

## Component Selection by Use Case

### Hero Section — Text Animation
Best picks for hero headlines:
- `text-animate` — word-by-word or character-by-character entrance
- `split-text` — staggered character reveals with custom easing
- `blur-text` — blur-to-sharp entrance for premium feel
- `gradient-text` — animated gradient flow through headline text

For hero backgrounds:
- `particles` — ambient particle field (use sparingly, tune opacity low)
- `aurora` — shifting gradient aurora effect
- `noise` — subtle texture overlay for depth
- `grid` — animated grid background for technical/SaaS feel

### Feature / Content Sections
- `scroll-reveal` — elements that animate in on scroll
- `fade-in` — simple opacity entrance with configurable delay
- `count-up` — number counter for metrics and stats
- `stagger-children` — sequential reveal of a list of items

### CTA Sections
- `shimmer-button` — button with animated shimmer effect (pair with shadcn Button structure)
- `magnetic` — button that responds to cursor proximity
- `glow-card` — card with reactive glow following cursor

### Cards and Testimonials
- `tilt-card` — 3D tilt following cursor
- `spotlight-card` — spotlight effect following cursor within card bounds
- `border-beam` — animated border gradient on card edges

### Navigation
- `magnetic` — nav items with subtle magnetic pull
Use sparingly in nav — max 1 ReactBits component

## Composition Rules

### Token-First Colors (Always)
ReactBits components accept className and style props.
Always pass token-based colors, never hardcoded values:

```tsx
// CORRECT
<Particles className="text-primary/20" />
<GradientText className="from-primary to-accent" />

// WRONG
<Particles color="#00E0FF" />
<GradientText from="#6e77df" to="#00a3ff" />
```

### Animation Budget Per Section
- Max 2 ReactBits components per section
- Total motion signals across full page: minimum 3, maximum 8
- Hero gets the most animation budget; footer gets the least
- Stagger delays between elements: 100-200ms typical, 50ms for character-level

### Performance Rules
- Particles: keep count under 50, opacity under 0.3 for backgrounds
- Disable animations when `prefers-reduced-motion` is set
- All ReactBits animations should use `will-change: transform` via the component's built-in handling
- Do not stack particles + aurora + noise on the same section — pick one ambient background

### Framer Motion Compatibility
ReactBits Pro components use Framer Motion internally.
You can compose them with your own Framer Motion variants:

```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  whileInView={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.6 }}
>
  <TextAnimate text="Your headline" />
</motion.div>
```

Do not wrap a ReactBits animation component in another animation wrapper
that controls the same property (e.g., opacity animating opacity).

## Common Mistakes to Avoid

- Installing a component and then referencing it with a wrong import path
- Using particles as a foreground element (they are always backgrounds)
- Animating the same element with both ReactBits and raw Framer Motion
- Adding magnetic effects to non-interactive elements
- Using count-up on text that isn't actually a number
- Setting animation duration > 1.5s for entrance animations (feels slow)
- Forgetting to pass `viewport={{ once: true }}` on scroll-reveal components
  (without this, animations replay every time the element leaves and re-enters view)
      $react_bits_pro$,
      ARRAY[
        'search_components',
        'get_component_info',
        'get_installation_info',
        'install_item_from_registry'
      ]::text[],
      1
    )
)
INSERT INTO skills (slug, name, category, description, methodology, tools_granted, version)
SELECT slug, name, category, description, methodology, tools_granted, version
FROM skill_payload
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  methodology = EXCLUDED.methodology,
  tools_granted = EXCLUDED.tools_granted,
  version = EXCLUDED.version,
  updated_at = NOW();

WITH holder_payload AS (
  SELECT *
  FROM (VALUES
    ('frontend-engineer', 'client-web-creation', 'expert'),
    ('vp-design', 'client-web-creation', 'expert'),
    ('ui-ux-designer', 'client-web-creation', 'competent'),
    ('cto', 'client-web-creation', 'competent'),
    ('cmo', 'client-web-creation', 'competent'),
    ('frontend-engineer', 'react-bits-pro', 'expert'),
    ('vp-design', 'react-bits-pro', 'expert'),
    ('ui-ux-designer', 'react-bits-pro', 'expert'),
    ('template-architect', 'react-bits-pro', 'competent')
  ) AS x(agent_role, skill_slug, proficiency)
),
target_slugs AS (
  SELECT DISTINCT skill_slug FROM holder_payload
),
existing_target AS (
  SELECT s.id AS skill_id, s.slug
  FROM skills s
  JOIN target_slugs t ON t.skill_slug = s.slug
)
DELETE FROM agent_skills ags
USING existing_target et
WHERE ags.skill_id = et.skill_id
  AND NOT EXISTS (
    SELECT 1
    FROM holder_payload hp
    WHERE hp.agent_role = ags.agent_role
      AND hp.skill_slug = et.slug
  );

WITH holder_payload AS (
  SELECT *
  FROM (VALUES
    ('frontend-engineer', 'client-web-creation', 'expert'),
    ('vp-design', 'client-web-creation', 'expert'),
    ('ui-ux-designer', 'client-web-creation', 'competent'),
    ('cto', 'client-web-creation', 'competent'),
    ('cmo', 'client-web-creation', 'competent'),
    ('frontend-engineer', 'react-bits-pro', 'expert'),
    ('vp-design', 'react-bits-pro', 'expert'),
    ('ui-ux-designer', 'react-bits-pro', 'expert'),
    ('template-architect', 'react-bits-pro', 'competent')
  ) AS x(agent_role, skill_slug, proficiency)
)
INSERT INTO agent_skills (agent_role, skill_id, proficiency)
SELECT hp.agent_role, s.id, hp.proficiency
FROM holder_payload hp
JOIN skills s ON s.slug = hp.skill_slug
JOIN company_agents ca ON ca.role = hp.agent_role
ON CONFLICT (agent_role, skill_id) DO UPDATE SET
  proficiency = EXCLUDED.proficiency;

INSERT INTO agent_tool_grants (tenant_id, agent_role, tool_name, granted_by, reason, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'chief-of-staff', 'github_create_from_template', 'system', 'Client website pipeline orchestration.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'chief-of-staff', 'github_push_files', 'system', 'Client website pipeline orchestration.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'chief-of-staff', 'vercel_create_project', 'system', 'Client website pipeline orchestration.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'chief-of-staff', 'vercel_get_preview_url', 'system', 'Client website pipeline orchestration.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'chief-of-staff', 'cloudflare_register_preview', 'system', 'Client website pipeline orchestration.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'chief-of-staff', 'cloudflare_update_preview', 'system', 'Client website pipeline orchestration.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'build_website_foundation', 'system', 'Client website implementation pipeline.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'github_create_from_template', 'system', 'Client website implementation pipeline.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'github_push_files', 'system', 'Client website implementation pipeline.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'vercel_create_project', 'system', 'Client website implementation pipeline.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'vercel_get_preview_url', 'system', 'Client website implementation pipeline.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'cloudflare_register_preview', 'system', 'Client website implementation pipeline.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'frontend-engineer', 'cloudflare_update_preview', 'system', 'Client website implementation pipeline.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'devops-engineer', 'github_push_files', 'system', 'Client website deployment support.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'devops-engineer', 'vercel_create_project', 'system', 'Client website deployment support.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'devops-engineer', 'vercel_get_preview_url', 'system', 'Client website deployment support.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'devops-engineer', 'cloudflare_register_preview', 'system', 'Client website deployment support.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'devops-engineer', 'cloudflare_update_preview', 'system', 'Client website deployment support.', true),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'design-critic', 'vercel_get_preview_url', 'system', 'Review access to preview deployment URLs.', true)
ON CONFLICT (agent_role, tool_name) DO UPDATE SET
  granted_by = EXCLUDED.granted_by,
  reason = EXCLUDED.reason,
  is_active = EXCLUDED.is_active,
  tenant_id = EXCLUDED.tenant_id,
  updated_at = NOW();

COMMIT;