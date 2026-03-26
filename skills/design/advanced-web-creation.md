---
name: advanced-web-creation
slug: advanced-web-creation
category: design
description: Execute Glyphor's end-to-end web creation pipeline from normalized brief to quality-gated ship. Use when asked to build a website, landing page, or web app where design direction, implementation, media generation, review, and iteration must run as one orchestrated system.
holders: vp-design, frontend-engineer, ui-ux-designer, cto, cmo
tools_granted: normalize_design_brief, codex, codex-reply, deploy_preview, screenshot_page, check_ai_smell, run_accessibility_audit, save_memory, send_agent_message, invoke_web_build, invoke_web_iterate, invoke_web_upgrade
version: 2
---

# Advanced Web Creation

This skill is a mandatory operating pipeline, not optional guidance. When the ask is "build a website" or "ship a web app," execute the sequence below exactly.

## Mandatory Pipeline (Non-Negotiable)

1. Phase 1 - Brief normalization
	- Run `normalize_design_brief` on the raw directive.
	- Produce a design manifesto and asset manifest.

2. Phase 2 - Build from template with Codex
	- Invoke `codex` against the approved template repo and feature branch.
	- Pass the normalized brief as the primary prompt.

3. Phase 3 - Preview and capture
	- Deploy preview with `deploy_preview`.
	- Capture screenshots at 1440, 1024, 768, 375 widths via `screenshot_page`.

4. Phase 4 - Automated gates
	- Run `check_ai_smell`.
	- Run `run_accessibility_audit` for WCAG AA.

5. Phase 5 - Review handoff
	- Submit artifacts and preview to design critic review.

6. Phase 6 - Iteration loop
	- Apply specific review feedback via `codex-reply`.
	- Re-run preview + gates.
	- Maximum 3 rounds.

7. Phase 7 - Ship
	- Release only after review score is >= 90 and all gates pass.

## Brief Requirements (Mia Output Contract)

Every normalized brief must include all fields below:

1. Audience persona
	- One specific person profile, never a generic segment.

2. Primary conversion action
	- One action only.

3. Emotional target
	- Concrete emotional outcome, never vague adjectives.

4. One-sentence memory
	- The single message users should retain after closing the tab.

5. Specific aesthetic direction
	- Distinct visual stance; "clean and modern" is invalid.

6. Component inventory
	- Ordered by priority from hero downward.

7. Asset manifest
	- Each image/video with a `type` field suitable for Pulse routing.

## Codex Invocation Pattern

Use this shape whenever Ethan executes a build:

```ts
codex({
	prompt: normalizedBrief,
	repo: "glyphor-adt/web-template-react",
	branch: "feature/initial-build",
	approval_policy: "never",
	sandbox: "workspace-write",
	skill: "ux-engineer"
});
```

When review feedback arrives:

```ts
codex-reply({
	message: structuredFeedback,
	repo: "glyphor-adt/web-template-react",
	branch: "feature/initial-build"
});
```

## Delivery Rules

- Never skip the brief normalization phase.
- Never ship without AI-smell and accessibility gates.
- Never ship below the quality threshold.
- Never exceed three review iterations without escalating creative direction.
- Save final brief, score breakdown, and winning patterns to memory after ship.