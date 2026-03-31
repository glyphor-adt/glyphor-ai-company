---
name: react-bits-pro
slug: react-bits-pro
category: design
description: Select, install, and use ReactBits Pro components for motion and ambient visual effects in client website builds. Use when a section needs text animation, background motion, scroll-driven effects, counters, magnetic interactions, or ambient particle/gradient effects. ReactBits Pro is NOT for functional UI primitives — use shadcn for those. ReactBits Pro is NOT for cinematic full-bleed moments — use Aceternity for those. ReactBits Pro owns the layer in between: personality, energy, and motion that makes a page feel alive.
holders: frontend-engineer, vp-design, ui-ux-designer, template-architect
tools_granted: search_components, get_component_info, get_installation_info, install_item_from_registry
version: 1
---

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
