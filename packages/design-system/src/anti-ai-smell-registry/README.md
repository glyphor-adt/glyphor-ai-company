# Anti-AI-Smell Component Registry

This registry enforces human-grade aesthetic tokens and prevents common AI-generated design patterns (e.g., "the blur", overly saturated gradients, unbalanced whitespace).

## Core Principles
1. **Aesthetic Restraint:** Single accent color, structural layouts.
2. **Typographic Hierarchy:** Strict enforcement of size and weight rules.
3. **Spacing:** Mathematical spacing (4px baseline grid).
4. **Token Enforcement:** Hard fail on unauthorized colors or padding outside the token scale.

## Implementation
This directory contains the specific component overrides and linting rules required to enforce these standards across all Glyphor-generated builds.

---

## Shared Button Component — glyphor-site

`packages/design-system/src/components/ui/button.tsx`

Consolidates the 7 ad-hoc button patterns found in `glyphor-site/components/*.tsx`
into a single typed API using `class-variance-authority`.

### Variants

| variant        | replaces / use case                                                         |
|----------------|-----------------------------------------------------------------------------|
| `primary`      | Main CTA; `bg-accent text-accent-foreground`                                |
| `secondary`    | Outlined CTA; `border border-border bg-background hover:bg-muted`           |
| `ghost`        | theme-toggle row buttons; `hover:bg-muted hover:text-foreground`            |
| `icon`         | theme-switch square & hamburger; `border border-border bg-background`       |
| `nav`          | Desktop header nav links; `text-foreground/80 hover:bg-foreground/5`        |
| `nav-mobile`   | Full-width mobile accordion rows; `w-full justify-between`                  |
| `hero`         | Layered "Try Today!" CTA outer shell; caller composes inner spans           |
| `cta-circular` | Footer circular arrow CTA; `rounded-full bg-foreground text-background`     |

### Usage
```tsx
import { Button } from '@glyphor/design-system';

// Nav link
<Button variant="nav">Docs</Button>

// Icon button (theme switch / hamburger — add size with className)
<Button variant="icon" className="h-10 w-10" aria-label="Toggle theme">
  <SunIcon className="h-5 w-5" />
</Button>

// Hero CTA outer shell — compose inner layers inside
<Button variant="hero">
  <span className="absolute inset-x-0 top-0 h-1 bg-accent" />
  <span className="relative flex items-center gap-2 px-5 py-3 bg-foreground text-background">
    Try Today!
    <ArrowRightIcon className="h-4 w-4" />
  </span>
</Button>
```

---

## Intentional Branding Color Overrides

The following usages of `text-black` / `text-neutral-900` / `bg-white` are **intentional**
and must **not** be converted to semantic tokens (`text-foreground`, `bg-background`).

These elements sit over `/BG.jpg` which stays light in **both** light and dark mode.
Converting them would break branding in dark mode.

Mark each with this inline comment:
```
// intentional: sits on BG.jpg, light in both themes
```

| File | Line | Element |
|------|------|---------|
| `components/hero.tsx` | 86 | Badge (text-black / text-neutral-900) |
| `components/hero.tsx` | 90 | h1 (text-black / text-neutral-900) |
| `components/hero.tsx` | 109 | Subtitle (text-black / text-neutral-900) |
| `components/footer.tsx` | 54 | h2 "Start building…" (text-black) |
| `components/header.tsx` | 226 | Arrow icon on accent bar (text-black) |

---

## Typography Display Scale

Two display-headline sizes are used once each on glyphor-site — they are **intentional**,
not accidents. Document them here so future developers don't add a third one-off size.

| Token            | Tailwind class | Usage                                    |
|------------------|----------------|------------------------------------------|
| `displayHero`    | `text-8xl`     | Hero `h1` (`components/hero.tsx`)        |
| `displaySection` | `text-6xl`     | Footer CTA "Start building…" (`footer.tsx`) |

CSS custom properties: see `packages/design-system/src/globals.css`.
Token definitions: see `packages/design-system/src/anti-ai-smell-registry/tokens.ts`.
