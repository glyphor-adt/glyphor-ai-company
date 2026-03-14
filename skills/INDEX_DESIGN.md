# Design Team Skills — Implementation Index

## Agent → Skill Mapping

| Agent | Role | Reports To | Skills |
|-------|------|------------|--------|
| Mia Tanaka | VP Design & Frontend | Sarah Chen | `design-review` (v2), `design-system-management` (v2), `brand-management` (NEW), `ui-development` (NEW) |
| Leo Vargas | UI/UX Designer | Mia Tanaka | `design-review` (v2), `design-system-management` (v2), `ux-design` (NEW) |
| Sofia Marchetti | Design Critic | Mia Tanaka | `design-review` (v2) |
| Ryan Park | Template Architect | Mia Tanaka | `design-system-management` (v2) |
| Ava Chen | Frontend Engineer | Mia Tanaka | `design-system-management` (v2), `frontend-development` (see IT team skills) |

> **Note:** Ava Chen's primary skill `frontend-development` is in the engineering skills set. She also holds `design-system-management` as the builder who implements system changes.

> **Note:** Maya Brooks (CMO) also holds `brand-management` — she co-owns brand with Mia as the marketing-facing guardian.

## Architecture References in These Skills

All skills reference the correct infrastructure:
- Dashboard: **Vite + React 19 + TypeScript + Tailwind**, served via nginx on Cloud Run (`glyphor-dashboard`)
- Brand constants: `packages/scheduler/src/brandTheme.ts` (used by PPTX/DOCX/image export tools)
- Design tools: `designSystemTools.ts` (7), `auditTools.ts` (6), `assetTools.ts` (5), `figmaTools.ts` (17), `storybookTools.ts` (7)
- Figma auth: OAuth via `FIGMA_CLIENT_ID`/`FIGMA_CLIENT_SECRET`/`FIGMA_REFRESH_TOKEN` (auto-refreshing)
- Image gen: DALL-E 3 with brand-constrained mode, 49 `pulse_*` tools for creative production
- Asset storage: GCS (`upload_asset`)
- Theme: Prism Midnight (Dark Glass, Hyper Cyan `#00E0FF`, Azure `#00A3FF`, Blue `#1171ED`, Soft Indigo `#6E77DF`)

## Size Comparison

| Skill | Old | New |
|-------|-----|-----|
| design-review | 6 lines, 2 tools | ~145 lines, 18 tools |
| design-system-management | 6 lines, 2 tools | ~130 lines, 24 tools |
| brand-management | (didn't exist) | ~140 lines, 27 tools |
| ui-development | (didn't exist) | ~125 lines, 33 tools |
| ux-design | (didn't exist) | ~145 lines, 21 tools |

## Key Design Decisions

**1. VP Design can write code.** The `ui-development` skill gives Mia Tanaka `write_frontend_file`, `create_branch`, `create_github_pr`, and `deploy_preview`. She doesn't just spec — she ships token updates and style changes directly. This closes the design-code gap that kills most design systems.

**2. Brand management is shared.** Both VP Design (system guardian) and CMO (market-facing guardian) hold `brand-management`. Mia owns the system layer (tokens, Figma, component styles). Maya owns the application layer (content, social, marketing materials). Both use `validate_brand_compliance`.

**3. Design review has a scoring system.** The skill defines a 0-100 score across 5 weighted dimensions (brand compliance 25%, craft quality 30%, accessibility 20%, performance 10%, consistency 15%). This makes review outcomes objective and trackable over time.

**4. AI-smell detection is deeply described.** Every design skill references AI-smell — the specific tells that make AI-generated design look generic. Spatial monotony, the card grid problem, default aesthetics, typography timidity, stock illustration vibes. This gives agents the vocabulary to identify and reject mediocre output.

**5. UX is Cockpit-specific.** The ux-design skill is written for the specific challenge of designing an "AI company control surface" — progressive disclosure of 28 agents' activity, three-second test for cold-start comprehension, and respect for founders' 5-10 hour/week attention budget.

## File Inventory

```
skills/design/
├── design-review.md           # v2 — Sofia, Leo, Mia
├── design-system-management.md # v2 — Ava, Ryan, Leo, Mia
├── brand-management.md        # NEW — Mia, Maya (CMO)
├── ui-development.md          # NEW — Mia
├── ux-design.md               # NEW — Leo
└── INDEX.md                   # This file
```
