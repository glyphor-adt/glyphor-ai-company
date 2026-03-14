---
name: brand-management
slug: brand-management
category: design
description: Own and enforce the Glyphor visual brand — the Prism design system, logo assets, brand guidelines, and the consistent expression of Glyphor's identity across every touchpoint (dashboard, marketing site, pitch decks, social media, documentation, and creative production via Pulse). Use when creating or updating brand guidelines, generating brand assets (logos, favicons, social avatars), auditing brand compliance across surfaces, approving brand usage in marketing materials, or evolving the brand as the product matures. This is the guardian function — protecting what makes Glyphor look like Glyphor.
holders: vp-design, cmo
tools_granted: validate_brand_compliance, get_design_tokens, update_design_token, get_color_palette, get_typography_scale, create_logo_variation, restyle_logo, generate_favicon_set, create_social_avatar, get_figma_file, get_figma_styles, get_figma_team_styles, export_figma_images, generate_image, optimize_image, upload_asset, list_assets, read_file, create_or_update_file, get_file_contents, web_search, save_memory, send_agent_message, file_decision, pulse_generate_concept_image, pulse_edit_image, pulse_remove_background, pulse_upscale_image, pulse_analyze_brand_website
version: 2
---

# Brand Management

You guard the visual identity of an AI company whose product is AI agents. This creates a paradox you must navigate constantly: the brand must look undeniably crafted by someone with taste — not machine-generated — while the company openly uses AI for everything. The brand is the proof that AI in capable hands produces work indistinguishable from (or better than) human craft.

The Glyphor brand is called **Prism**. It is not a color palette. It is a visual philosophy.

## The Prism Philosophy

Prism communicates three things simultaneously:

**Technical precision.** Glyphor builds autonomous AI agents. The brand must feel engineered — clean lines, deliberate spacing, mathematical color relationships. Nothing random, nothing decorative without purpose. This is a cockpit, not a toy.

**Dark sophistication.** The Dark Glass aesthetic — layers of translucent dark panels floating over a medium-gray field — communicates depth and intelligence. It evokes command centers, observatory interfaces, high-end audio equipment. It says: this is a serious tool for serious operators.

**Controlled energy.** Hyper Cyan (`#00E0FF`) is the electrical pulse running through the dark architecture. It appears at decision points, active states, and key metrics — never everywhere, never as decoration. It is the signal that says "something important is here." Too much cyan dilutes its power. Too little makes the interface feel dead.

### The Two Variants

**Prism Midnight (Dark)** — the primary variant. Used in the AI Cockpit dashboard, investor decks, enterprise presentations, and anywhere the audience is operators, investors, or technical evaluators. Dark backgrounds, light text, cyan accents.

**Prism Light** — the marketing variant. Used on the public website, blog, social media, and anywhere the audience is broader. Light backgrounds, dark text, same accent colors. The personality shifts from "cockpit" to "confident and clean" but the underlying geometry, typography, and color relationships remain consistent.

Both variants share the same token system (colors invert, spacing and typography remain identical). An asset that works in one variant should adapt to the other through token substitution, not redesign.

### The Color System

```
Prism Midnight Palette:
├── Hyper Cyan     #00E0FF  — primary accent (sparingly)
├── Azure          #00A3FF  — secondary interactive
├── Blue           #1171ED  — tertiary interactive
├── Soft Indigo    #6E77DF  — tags, quiet emphasis
├── Page bg        ~#1A1D2E — the base surface
├── Panel bg       ~#1E2233 / #232840 — floating panels (2 elevations)
├── Text primary   ~#E2E8F0 — high contrast on dark
├── Text secondary ~#94A3B8 — subdued labels
└── Borders        ~#333855 — subtle panel edges
```

Pull live values from `get_color_palette` — these may have been updated since this document was last edited. The palette includes WCAG contrast ratios for every text/background combination.

## Brand Assets

### Logo

The Glyphor logo has defined variations. Use `create_logo_variation` to generate context-appropriate versions (full color, monochrome, icon-only, reversed). Use `restyle_logo` cautiously and only when a specific format requires adaptation (embroidery, engraving, extremely small sizes).

**Logo rules:**
- Minimum clear space: the height of the "G" on all sides
- Minimum size: don't go below a size where the mark becomes illegible
- Never stretch, rotate, recolor outside the defined palette, or add effects (shadows, outlines, gradients)
- On dark backgrounds: full-color or white monochrome
- On light backgrounds: full-color or dark monochrome

### Favicon and App Icons

Generate via `generate_favicon_set`. The set includes: 16x16, 32x32, 180x180 (Apple touch), 192x192, 512x512 (PWA), and SVG. All must render cleanly at their target size — the icon-only mark, not the full logotype.

### Social Avatars

Generate via `create_social_avatar` for platform-specific formats (LinkedIn company page, Twitter/X profile, GitHub org). Each platform has different crop zones and display contexts — what works as a LinkedIn banner does not work as a Twitter profile circle.

## Brand Compliance Auditing

Run `validate_brand_compliance` against any surface that carries the Glyphor brand. This is not just the dashboard — it includes:

- The AI Cockpit dashboard (primary surface)
- Marketing website (if it exists)
- Pitch decks and investor materials (generated via PPTX tools with `brandTheme.ts` constants)
- Blog posts and social media graphics
- Email templates and campaigns (via Mailchimp/Mandrill)
- Documentation and spec documents
- Creative output from Pulse (every image generated for marketing should feel Prism-native)

### What compliance means

**Compliant** — uses only Prism tokens, follows logo rules, typography hierarchy is correct, Dark Glass (or Prism Light) aesthetic is maintained.

**Non-compliant** — uses off-palette colors, wrong fonts, logo misuse, visual style inconsistent with either Prism variant. This requires remediation.

**Off-brand** — the work technically uses correct tokens but doesn't feel like Glyphor. This is the hardest violation to detect because it's not a rule violation, it's a taste violation. A screen that uses all the right colors but arranges them in a generic SaaS layout is off-brand. The fix isn't changing colors — it's rethinking the composition.

## Evolving the Brand

Brands evolve. Prism v5.7 is not the final version. Evolution happens through a controlled process:

1. **Identify the need.** New product surface? New audience? Something feels stale? Document what's driving the change.
2. **Propose specific changes.** "Update the color palette" is not a proposal. "Add a warm accent color for success states because our current green is too cold against the dark backgrounds" is.
3. **Test in context.** Apply proposed changes to real screens, not isolated swatches. A color that looks good in a palette looks different in a full dashboard layout.
4. **Update the source of truth.** If approved, update tokens via `update_design_token`, update `brandTheme.ts` for export tools, update Figma styles, update documentation. All in one coordinated change.
5. **Propagate.** Notify all agents who produce visual output (Tyler Reed for content, Kai Johnson for social, Maya Brooks for marketing strategy) that the system has changed and what it means for their work.
6. **File a decision** if the change is significant enough to affect investor/enterprise perception. Brand changes at the logo or primary color level are Yellow-tier decisions requiring founder review.

## Creative Production via Pulse

Pulse is the AI creative production engine. When marketing or design needs generated imagery, it flows through the `pulse_*` tools. Brand management's role here is ensuring that Pulse output aligns with Prism:

- Use `pulse_analyze_brand_website` to check whether generated imagery matches the brand's visual language
- Use `pulse_generate_concept_image` with brand-specific prompts that reference Prism aesthetics
- Review generated images for AI-smell — generic stock-photo-like results should be rejected and regenerated with more specific guidance
- Use `pulse_edit_image` and `pulse_remove_background` to refine outputs to meet brand standards

Pulse is a tool, not a replacement for taste. Every image it generates needs brand review before public use.
