---
name: advanced-web-creation
slug: advanced-web-creation
category: design
description: Orchestrate Fuse for complete page and application builds while preserving precise control over brand direction and quality gates. Use when a request is larger than a component tweak and requires architecture, implementation, QA, and deployment as one flow.
holders: vp-design, frontend-engineer, ui-ux-designer, cto, cmo
tools_granted: invoke_fuse_build, invoke_fuse_iterate, invoke_fuse_upgrade, screenshot_page, check_ai_smell, run_lighthouse_audit, run_lighthouse_batch, save_memory, send_agent_message
version: 1
---

# Advanced Web Creation

This skill is about orchestration, not hand-building every file. Fuse is the fast path for complete deliverables. Use it to convert a strong brief into a running preview, then iterate with targeted edits until quality is ready.

## Fuse vs Individual Tools

Use Fuse when:
- You are asked to build an entire landing page, site section, or full app.
- The request includes multiple sections, interactions, responsive behavior, and deployment expectations.
- You need fast end-to-end output (architecture + implementation + QA + deploy signal) in one flow.

Use individual tools when:
- You are changing one component, one style token, one copy block, or one interaction.
- You need surgical fixes in an existing codebase where full regeneration is unnecessary.
- The ask is clearly a patch, not a rebuild.

Rule of thumb:
- If it sounds like "build me a page/app", start with Fuse.
- If it sounds like "change this thing", use direct file/component tools.

## Fuse Build Workflow

1. Define the brief with strategic clarity.
2. Run `invoke_fuse_build` with the right tier.
3. Review output quality with screenshots and AI-smell checks.
4. Iterate with `invoke_fuse_iterate` when specific changes are needed.
5. Upgrade prototypes with `invoke_fuse_upgrade` when production hardening is required.

## Tier Strategy

- `prototype`: fastest route to visual/structural validation.
- `full_build`: production-oriented path with deeper verification and deploy metadata.
- `iterate`: targeted edits to an existing Fuse project ID.

Start at prototype when direction is uncertain. Move to full build once structure and visual direction are approved.

## Brief Quality Standard

Every high-quality Fuse run starts with a high-quality brief. Include:

1. Purpose: what this page or app must accomplish.
2. Audience: who it serves and their context.
3. Required sections/flows: concrete structure.
4. Visual direction: style, mood, references, constraints.
5. Brand context: colors, typography, voice, motion preference.
6. Functional requirements: forms, navigation, interactions, integrations.
7. Technical constraints: framework hints, performance/SEO requirements, accessibility expectations.

Weak briefs cause generic output. Strong briefs produce strong first passes.

## Iteration Style

Write change requests with surgical specificity:
- Identify exact section/component.
- Describe what to change and why.
- Provide target outcome (layout, typography, hierarchy, behavior).
- Include acceptance criteria when quality is subjective.

Good iterate request example:
"Hero headline needs stronger hierarchy: increase heading scale to display size, reduce supporting copy width, and move social proof strip directly below CTA. Keep dark glass style and cyan accent." 

## Quality Gates

Before delivery:
- Run visual review at multiple breakpoints.
- Run `check_ai_smell` for generic-pattern detection.
- Run Lighthouse audits when performance/accessibility confidence is required.
- Confirm brand consistency and section ordering match the brief.

If quality is below bar, iterate. Do not hand off first-pass output as final.

## Role-Specific Access Notes

- VP Design: build + iterate + upgrade.
- Frontend Engineer: build + iterate.
- UI/UX Designer: prototype build only.
- CTO: build for internal tools and dashboards.
- CMO: prototype build for campaign pages.

If a requested Fuse action is outside your tool access, escalate through assignment routing rather than attempting manual workarounds.