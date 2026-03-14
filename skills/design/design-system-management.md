---
name: design-system-management
slug: design-system-management
category: design
description: Maintain, evolve, and enforce the Glyphor design system — tokens, component library, patterns, documentation, and the bridge between design intent and code implementation. Use when auditing token usage, adding or modifying components, resolving design-code drift, updating the system for new product needs, or ensuring the component library stays complete and documented. This skill governs the source of truth that every visual element on the platform inherits from.
holders: frontend-engineer, template-architect, ui-ux-designer, vp-design
tools_granted: get_design_tokens, update_design_token, get_color_palette, get_typography_scale, get_component_library, get_component_usage, save_component_spec, query_component_specs, save_component_implementation, query_component_implementations, validate_tokens_vs_implementation, get_template_registry, list_templates, save_template_variant, update_template_status, query_template_usage, query_template_variants, read_file, get_file_contents, create_or_update_file, read_frontend_file, write_frontend_file, search_frontend_code, save_memory, send_agent_message
version: 2
---

# Design System Management

A design system is not a Figma file. It is not a component library. It is not a collection of tokens. It is an **agreement** — a shared contract between every person and agent who creates visual output — about how things look, feel, and behave. Your job is to maintain that agreement, evolve it when the product needs change, and enforce it when someone breaks it.

The Glyphor design system is called **Prism**. It exists in two variants: Prism Midnight (dark, for the AI Cockpit dashboard and enterprise/investor contexts) and Prism Light (for marketing and web). The Cockpit — where founders operate their AI company — is the primary surface and runs exclusively in Prism Midnight.

## What the System Contains

### Tokens

Tokens are the atomic layer. Every visual property that varies is defined as a token: colors, spacing, typography sizes, border radii, shadows, transitions. Tokens are stored in `brandTheme.ts` for export use and as Tailwind config values for the dashboard.

Pull the current state with `get_design_tokens`. The token set includes:

**Color tokens:**
- Surface: page background, panel backgrounds (multiple elevation levels), borders
- Text: primary, secondary, tertiary, inverse
- Accent: Hyper Cyan (`#00E0FF`), Azure (`#00A3FF`), Blue (`#1171ED`), Soft Indigo (`#6E77DF`)
- Semantic: success (green), warning (amber), error (red), info (blue)
- Data visualization: a sequence of 6-8 colors that maintain distinguishability on dark backgrounds

**Spacing tokens:** A scale (typically 4px base) defining all margin and padding values. Every spacing value in the codebase should reference this scale, never a raw pixel value.

**Typography tokens:** Font families (sans, mono), size scale (xs through 4xl), weight scale (normal, medium, semibold, bold), line height scale, letter spacing.

**Elevation tokens:** Shadow definitions for the Dark Glass layering effect. Panels at different depths have different shadow intensities. This is what creates the glass-over-glass feel rather than flat cards.

**Motion tokens:** Duration and easing curves for transitions and animations. Consistent motion is as important as consistent color — jarring or inconsistent transitions break the sense of craft.

### Components

Components are the molecular layer — built from tokens. The component library is the set of reusable React components that the frontend uses. Pull the inventory with `get_component_library` and check usage frequency with `get_component_usage`.

A healthy component library has:
- **No orphaned components** — every component is used somewhere. Unused components are dead weight.
- **No duplicate components** — two components that do the same thing force a decision every time someone needs that pattern. One should be deprecated.
- **Consistent API** — similar components take similar props. If one button takes `variant="primary"` and another takes `type="main"`, that's an inconsistency to resolve.
- **Documentation** — every component has a clear description of when to use it, what props it accepts, and at least one Storybook story.

### Templates

Templates are the organism layer — page-level patterns that combine multiple components. Ryan Park (Template Architect) owns the template registry. Pull the state with `get_template_registry` and `list_templates`.

Templates should:
- Cover every page type in the Cockpit (dashboard overview, detail view, list view, form, settings, analysis report)
- Use components from the library, not custom implementations
- Be versioned so changes can be tracked and rolled back

## The Drift Problem

Design-code drift is the #1 threat to system integrity. It happens silently:

1. A designer specs a component with token-correct values
2. A developer implements it, but uses `#1a1d2e` instead of `var(--surface-page)` — visually identical today
3. A month later, the page background token is updated to `#1c1f30`
4. The component now has a different background than the page. The drift is visible.

**How to detect drift:** Run `validate_tokens_vs_implementation` regularly. This compares the token definitions against what's actually in the codebase. Every raw color value, raw pixel spacing, or inline font-size that should be a token reference is a drift instance.

**How to fix drift:** Search the frontend code with `search_frontend_code` for raw values, replace them with token references. Create a PR.

**How to prevent drift:** The design system should be the single source of truth imported by every component. If a developer needs a value that isn't in the token set, the correct path is to add a token, not to hardcode a value.

## Evolution

Design systems are living. Products change, brand evolves, new patterns emerge. The system must evolve with them — but deliberately, not reactively.

### When to add a token

Add a token when a value is used in 3+ places and is semantically meaningful. A one-off color used in a single decorative element doesn't need to be a token — that's over-abstraction. But a color used across multiple chart types for "positive trend" absolutely does.

### When to add a component

Add a component when a pattern is used in 3+ places and has a consistent interface. Don't create a component for a pattern used once — it's premature abstraction. But if three different pages have built their own version of a "metric card with trend indicator," that should be a library component.

### When to break changes

Breaking changes to tokens or components affect every consumer. They require:
1. A migration guide documenting exactly what changed
2. A search of all consumers (`get_component_usage`, `search_frontend_code`) to assess blast radius
3. A deprecation period — old values/components remain available but warn, new values are the default
4. A PR that updates all consumers in one atomic change

Never rename a token without updating every reference. Never remove a component without verifying zero usage first.

### Documentation as part of the system

An undocumented token is a token that will be misused. An undocumented component is a component that will be duplicated. Documentation is not separate from the system — it IS the system. The tokens file and the documentation file should be updated in the same commit.

When you add or modify anything in the system:
- Update the token definitions
- Update the component spec (`save_component_spec`)
- Update the Storybook stories (coordinate with Ava Chen, frontend-engineer)
- Save a memory documenting the change and rationale

## Auditing

Run a full system audit monthly. The audit answers three questions:

1. **Is the system complete?** Are there patterns in the product that should be in the system but aren't? Check by reviewing recent PRs and screenshots for ad-hoc implementations.

2. **Is the system consistent?** Are tokens actually used where they should be? Run `validate_tokens_vs_implementation` and catalog every drift instance.

3. **Is the system documented?** Does every token and component have a description, usage guidelines, and examples? Undocumented elements are technical debt.

Produce an audit report with: token coverage (% of visual values that are tokenized), component coverage (% of UI patterns that use library components), drift instances, and recommended additions or changes.
