# Web Coding Loop Playbook

This playbook is the day-to-day guide for running Claude-style web refinement loops in Glyphor.

## When To Use Which Tool

- Use `invoke_web_coding_loop` when:
  - you already have a `project_id`,
  - the request needs iterative polish (visual hierarchy, CTA clarity, accessibility, performance),
  - you want measurable convergence before signoff.
- Use `invoke_web_iterate` when:
  - the update is small and one-pass,
  - no iterative quality loop is required.

## Agent Defaults

- `frontend-engineer`: default to `invoke_web_coding_loop` for refinement work.
- `vp-design`: default to `invoke_web_coding_loop` for quality-led iteration.
- `ui-ux-designer`: default to `invoke_web_coding_loop` for design polish and validation.

## Recommended Loop Inputs

- `max_iterations=3`
- `lighthouse_strategy=desktop`
- `min_performance=75`
- `min_accessibility=85`
- `min_best_practices=85`
- `min_seo=85`
- `include_screenshot=true` only when visual proof is required in output payloads.

## Copy/Paste Prompt Templates

- Hero polish + CTA clarity:
  - `Run invoke_web_coding_loop on <project_id>. Goal: improve hero information hierarchy, above-the-fold readability, and CTA prominence without changing brand palette or voice. Keep changes production-safe and responsive.`
- Conversion-oriented pass:
  - `Run invoke_web_coding_loop on <project_id>. Goal: increase conversion intent on landing and pricing sections by clarifying value props, tightening CTA copy, and reducing visual noise. Preserve current product narrative.`
- Accessibility hardening:
  - `Run invoke_web_coding_loop on <project_id>. Goal: improve accessibility across navigation, forms, and interactive controls (labels, focus visibility, keyboard flow, contrast) while preserving layout intent.`
- Performance + UX smoothness:
  - `Run invoke_web_coding_loop on <project_id>. Goal: improve perceived performance and interaction smoothness (layout stability, animation restraint, rendering cost) with no regressions to core content and CTA flows.`
- One-shot iterate:
  - `Run invoke_web_iterate on <project_id> with changes: update only <section/component> to <specific change>. Do not alter other sections or global design tokens.`

## Signoff Checklist

- Confirm `converged=true` when using `invoke_web_coding_loop` (or validate that `stop_reason` is acceptable for manual approval).
- Confirm at least one iteration includes:
  - a valid `preview_url`,
  - Lighthouse scores for `performance`, `accessibility`, `best-practices`, and `seo`,
  - `met_thresholds=true` for automated signoff.
- Confirm final output includes:
  - `latest_preview_url`,
  - `latest_deploy_url` (if returned),
  - `latest_github_pr_url`.
- If visual evidence is required, rerun with `include_screenshot=true` and verify screenshot dimensions are present.
- For one-shot `invoke_web_iterate`, verify `preview_url` and confirm no unintended sections changed.
