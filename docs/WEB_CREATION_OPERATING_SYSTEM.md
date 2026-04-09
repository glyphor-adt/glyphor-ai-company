# Web Creation Department - Operating System

## The Question This Answers

When a directive says "build a website for [anything]," what happens? Who does what, in what order, using what tools, enforced by what quality gates, learning from what feedback loops?

---

## Team and Activation

| Agent | Role in web creation | When activated |
|-------|----------------------|----------------|
| Mia (VP Design) | Creative director. Produces the design brief that shapes everything. | Wave 0 - always first |
| Leo (UX Design) | Information architecture. User flows, content hierarchy, navigation structure. | Wave 0 - parallel with Mia for complex apps |
| Ethan (Frontend) | Builder. Drives Codex with the ux-engineer skill. Writes code, fixes builds, ships. | Wave 1 - after brief is locked |
| Tyler (Content) | Media producer. Images and video through Pulse. Copy through content-creation skill. | Wave 1 - parallel with Ethan |
| Sofia (Design Critic) | Quality gate. 100-point rubric. Nothing ships without 90+. | Wave 2 - after first deploy |
| Marcus (CTO) | Infrastructure. Databases, APIs, GCP services, backend architecture. | Wave 0 - only for full-stack apps |
| Jordan (DevOps) | CI/CD, domain config, production deployment, monitoring. | Wave 2 - production cutover |

---

## Wave 0 - Strategy and Brief

### Mia outputs (always)

Mia calls `normalize_design_brief` and produces a complete creative strategy document.

Required sections:

1. Audience persona: one specific person, not a broad segment.
2. Primary conversion action: one action the page is designed to drive.
3. Emotional target: the exact feeling the experience must create.
4. Memory anchor: the one sentence users should remember after closing the tab.
5. Distinct aesthetic direction: specific and unusual; never "clean and modern."
6. Component list by priority: hero first, with interaction intent.
7. Asset manifest: exact image/video needs Tyler will execute through Pulse.

### Leo outputs (complex web applications)

For product-style apps (not simple marketing pages), Leo produces:

- User flow diagram
- Navigation architecture (routes, hierarchy, breadcrumbs)
- Data model sketch (for Marcus to refine)
- State strategy (local/server/real-time boundaries)

Mia and Leo run in parallel and resolve conflicts before handoff to Wave 1.

### Marcus outputs (full-stack only)

For directives requiring backend systems, Marcus produces:

- Infrastructure architecture on GCP
- Database schema (Cloud SQL PostgreSQL)
- API surface (routes, methods, auth)
- Deployment strategy (Cloud Run + environment config)

Marcus may provision Cloud SQL, Cloud Run, Cloud Storage, Firebase, and Secret Manager as required.

---

## Wave 1 - Build and Media (Parallel)

### Ethan workflow (Codex build path)

Ethan passes Mia + Leo + Marcus artifacts into Codex MCP.

```ts
codex({
  prompt: [designBrief, uxArchitecture, infraSpec],
  repo: "glyphor-adt/[project-name]",
  branch: "feature/initial-build",
  approval_policy: "never",
  sandbox: "workspace-write",
  skill: "ux-engineer"
});
```

The `ux-engineer` skill enforces non-generic quality constraints and file contracts, while Codex handles:

- Code generation in template structure
- Build-check-fix loops until green
- Commit and PR creation

After Codex completes, Ethan must:

1. Deploy preview and capture URL.
2. Register branded preview domain.
3. Save image/video manifest for Tyler.
4. Capture screenshots at 1440, 1024, 768, and 375 widths.
5. Run AI-smell checks.
6. Submit assignment with proof artifacts.

### Tyler workflow (Pulse media path)

Tyler starts as soon as asset manifest is available. Tool routing rules:

- Concept image: `pulse_enhance_prompt` -> `pulse_generate_concept_image`
- Product shot: screenshot + `pulse_product_recontext`
- Editorial portrait: `pulse_enhance_prompt` -> `pulse_generate_concept_image`
- Pattern texture: generate + optional upscale
- Hero loop video: enhance prompt -> `pulse_generate_video` (Veo) -> `pulse_poll_video_status`
- Product demo: screenshot states -> `pulse_generate_video` (image-to-video) -> remix or stitch in post as needed
- Promo video: storyboard -> scene previews -> final hero promo
- Testimonial-style video: TTS narration + B-roll / motion graphics (no third-party lip-sync dependency)

After each generated asset:

- Commit to `public/images/*` or `public/videos/*`
- Let preview auto-redeploy with live assets
- Save prompts + outputs to memory for future reuse

---

## Wave 2 - Quality Gate and Score

### Step 1: Automatic pass/fail gates

Run before subjective review:

1. `check_ai_smell` on deployed preview
2. Accessibility audit for WCAG AA
3. Screenshot review at all four breakpoints

Any failing gate blocks release and triggers revision.

### Step 2: Sofia 100-point rubric

| Dimension | Points |
|-----------|--------|
| Visual distinction | 25 |
| Technical execution | 25 |
| Typography | 20 |
| Interaction and animation | 15 |
| Accessibility | 15 |

### Step 3: Verdict policy

| Score | Verdict | Action |
|-------|---------|--------|
| 90-100 | Ship it | Approve for production |
| 75-89 | Almost there | Specific fix list, max 2 rounds at this tier |
| 60-74 | Significant work | Rework sections, may require brief revision |
| <60 | Start over | Return to Mia for new creative direction |

### Step 4: Feedback format requirements

Feedback must be actionable and specific:

- Reference component
- Reference exact property or behavior
- Include concrete target fix

Example: "Hero heading is under-scaled on desktop; increase to text-6xl+ with heavier weight to restore hierarchy."

---

## Wave 3 - Iteration Loop

Loop: Sofia feedback -> Ethan `codex-reply` -> build pass -> redeploy -> re-review.

Hard limit: 3 total iteration rounds between Sofia and Ethan.

If still <90 after round 3, escalate to Mia for brief revision (creative direction issue, not implementation issue).

---

## Wave 4 - Ship

Jordan handles:

- Production deployment
- DNS cutover
- SSL validation
- Post-deploy monitoring (Vercel Analytics or PostHog)

---

## Wave 5 - Learning Loop

After every 90+ shipment:

1. Save design contract as reference memory.
2. Append proven patterns to `.codex/skills/ux-engineer/SKILL.md`.
3. Save Sofia deductions with issue -> fix -> impact mapping.
4. Save Tyler prompt lineage for high-performing assets.

This creates compound learning across builds and reduces repeated quality deductions.

---

## Full-Stack Variant (When Backend Is Required)

If directive includes backend requirements:

- Marcus provides infra spec and provisions managed services.
- Template variant must include Next.js App Router + API routes + Prisma + auth middleware + env validation.
- Ethan implements backend through Next.js API routes and server actions.

Non-negotiables:

- No hardcoded credentials
- No auth bypass on protected routes
- No raw SQL when ORM path exists
- No split backend service unless explicitly justified by architecture

---

## Enforcement Layers

1. Codex skill constraints prevent low-quality patterns from being generated.
2. Build self-healing prevents broken code from being merged.
3. AI-smell detection blocks generic output.
4. Sofia rubric blocks mediocre quality from shipping.
5. Accessibility audit enforces WCAG AA baseline.
6. Cross-build memory prevents repeated mistakes.

---

## End-to-End Pipeline

```text
DIRECTIVE ARRIVES
  -> Wave 0: Mia (+ Leo/Marcus when needed)
  -> Wave 1: Ethan + Tyler in parallel
  -> Wave 2: Sofia gates + rubric
  -> Wave 3: Jordan production cutover
  -> Wave 4: Learning artifacts saved to memory + skill updates
```

Target timeline:

- Preview: 15-30 minutes build + 10-20 minutes media
- 90+ score: usually 1-2 review loops (30-60 minutes)
- Production cutover: about 15 minutes

Typical total: under 2 hours from directive to production for standard website work.
