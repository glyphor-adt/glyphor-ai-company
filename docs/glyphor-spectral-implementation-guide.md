# Glyphor Dashboard — Spectral Presence Implementation Guide

The redesign prototype identified four layers of brand presence missing from the current dashboard. This guide gives you the exact code to port each one into your existing codebase. All values reference Brand Manual v5.6.

**You keep**: your existing logo/icon, Agency font, Urbanist/Inter body, JetBrains Mono data, layout structure, component library.

**You add**: spectral mesh canvas, sidebar chromatic bleed, banner prismatic treatment, card rim-lighting, and the agent bar spectral rail.

---

## 1. Spectral Mesh Canvas (the atmosphere)

This is the single biggest impact change. Your main content area currently has a flat `#010204` (dark) or `#F6F8FA` (light) background. The spectral mesh adds three radial gradients from the Spectral Cluster that make the chromatic identity *felt* in the negative space.

Drop this as a sibling of your main content scroll container, positioned absolute behind it.

### Dark mode (Prism Midnight)

```css
.spectral-mesh-dark {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}

/* Cyan nebula — anchors top-right, dominant */
.spectral-mesh-dark::before {
  content: '';
  position: absolute;
  top: -80px;
  right: -60px;
  width: 600px;
  height: 600px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(0, 224, 255, 0.04) 0%,
    rgba(0, 224, 255, 0.01) 40%,
    transparent 70%
  );
  filter: blur(40px);
}

/* Indigo anchor — center-left */
.spectral-mesh-dark::after {
  content: '';
  position: absolute;
  top: 30%;
  left: -100px;
  width: 500px;
  height: 500px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(99, 102, 241, 0.035) 0%,
    transparent 65%
  );
  filter: blur(50px);
}
```

You'll need a third element for the purple — add a child `div`:

```css
.spectral-mesh-purple {
  position: absolute;
  bottom: -120px;
  right: 20%;
  width: 450px;
  height: 450px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(168, 85, 247, 0.025) 0%,
    transparent 60%
  );
  filter: blur(60px);
  pointer-events: none;
}
```

### Light mode (Prism Solar)

Same structure but pull back intensity and shift to darker accent values:

```css
.spectral-mesh-light::before {
  /* Cyan — softer, top-right */
  background: radial-gradient(
    circle,
    rgba(8, 145, 178, 0.04) 0%,
    transparent 70%
  );
  top: -100px; right: -100px;
  width: 500px; height: 500px;
}

.spectral-mesh-light::after {
  /* Indigo — bottom-left */
  background: radial-gradient(
    circle,
    rgba(67, 56, 202, 0.03) 0%,
    transparent 70%
  );
  bottom: -150px; left: -50px;
  width: 400px; height: 400px;
}
```

### Optional: Noise texture overlay

Adds subtle grain that prevents the gradients from looking digitally smooth. Layer this on top of the mesh at very low opacity:

```css
.spectral-mesh-noise {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.35;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
  background-size: 200px 200px;
}
```

---

## 2. Sidebar Chromatic Bleed

Your sidebar currently has a flat border-right. The spectral bleed adds a vertical gradient on the right edge that runs the full Spectral Cluster range, plus two ambient corner glows.

### The edge gradient (dark mode only)

Add a pseudo-element or absolute-positioned div on the sidebar's right edge:

```css
.sidebar-spectral-edge {
  position: absolute;
  top: 0;
  right: -1px;  /* overlap the border */
  width: 1px;
  height: 100%;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgba(0, 224, 255, 0.08) 0%,      /* Hyper Cyan */
    rgba(99, 102, 241, 0.06) 30%,     /* Indigo */
    rgba(168, 85, 247, 0.04) 60%,     /* Purple */
    rgba(0, 224, 255, 0.02) 100%      /* Fade back to cyan */
  );
}
```

### Corner ambient glows (dark mode only)

```css
/* Bottom-right: cyan bleed into content area */
.sidebar-glow-br {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 120px;
  height: 200px;
  background: radial-gradient(
    ellipse at bottom right,
    rgba(0, 224, 255, 0.03),
    transparent 70%
  );
  pointer-events: none;
}

/* Top-left: indigo anchor */
.sidebar-glow-tl {
  position: absolute;
  top: 0;
  left: 0;
  width: 100px;
  height: 150px;
  background: radial-gradient(
    ellipse at top left,
    rgba(99, 102, 241, 0.025),
    transparent 70%
  );
  pointer-events: none;
}
```

In light mode, remove all three. The sidebar should be clean white/neutral without the glows — Prism Solar doesn't use rim-lighting.

---

## 3. Banner Prismatic Treatment

Your current banner has a barely-visible gradient. This upgrade has three components:

### A. Animated spectral top edge

Replace any existing top border/decoration with this:

```css
.banner-spectral-edge {
  height: 3px;
  border-radius: 14px 14px 0 0;  /* match your card radius */
  background-size: 200% 100%;
  animation: spectralShift 8s ease infinite;
}

/* Dark */
.banner-spectral-edge--dark {
  background: linear-gradient(90deg,
    #00E0FF, #6366F1, #C084FC, #A855F7, #6366F1, #00E0FF
  );
}

/* Light */
.banner-spectral-edge--light {
  background: linear-gradient(90deg,
    #0891B2, #4338CA, #9333EA, #7E22CE, #4338CA, #0891B2
  );
}

@keyframes spectralShift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
```

### B. Interior chromatic wash

Add an absolute-positioned overlay inside the banner card:

```css
/* Dark mode */
.banner-wash-dark {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse at 70% 30%, rgba(0, 224, 255, 0.06) 0%, transparent 50%),
    radial-gradient(ellipse at 30% 70%, rgba(99, 102, 241, 0.04) 0%, transparent 50%),
    radial-gradient(ellipse at 90% 80%, rgba(168, 85, 247, 0.03) 0%, transparent 50%);
}

/* Light mode */
.banner-wash-light {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse at 70% 30%, rgba(8, 145, 178, 0.05) 0%, transparent 50%),
    radial-gradient(ellipse at 30% 70%, rgba(67, 56, 202, 0.03) 0%, transparent 50%);
}
```

### C. Grid texture (dark mode only, optional)

Adds a faint 32px grid aligned to the 8px system for a technical/architectural feel:

```css
.banner-grid-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.015;
  background-image:
    linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px);
  background-size: 32px 32px;
}
```

---

## 4. Card Rim-Lighting (replacing flat borders)

This is the core Prism High-Fidelity pattern. Your current cards all have the same `1px solid` teal/cyan border. Replace that with specular rim-light shadows.

### Dark mode

```css
/* Resting state — faint inner top highlight + barely-visible outer edge */
.card-prism {
  border: none;  /* remove the existing border */
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.04),           /* structural edge */
    inset 0 1px 0 rgba(0, 224, 255, 0.06);          /* top rim specular */
}

/* Hover — rim intensifies, depth shadow appears */
.card-prism:hover {
  box-shadow:
    0 0 0 1px rgba(0, 224, 255, 0.12),              /* cyan edge glow */
    inset 0 1px 0 rgba(0, 224, 255, 0.12),          /* brighter rim */
    0 8px 40px rgba(0, 0, 0, 0.35);                 /* depth shadow */
}
```

### Light mode

```css
/* Resting — standard subtle shadow, no rim-light */
.card-prism {
  border: none;
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.05),
    0 0 0 1px rgba(0, 0, 0, 0.04);
}

/* Hover — shadow deepens */
.card-prism:hover {
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.07),
    0 0 0 1px rgba(0, 0, 0, 0.06);
}
```

### Top spectral accent strip on stat cards

Each stat card should have a 2px accent line at the top in its cluster color. This replaces the uniform cyan border:

```css
.stat-card-accent {
  overflow: hidden;  /* contain the strip */
}

.stat-card-accent::before {
  content: '';
  display: block;
  height: 2px;
  background: linear-gradient(90deg,
    transparent,
    var(--accent-color-88),   /* e.g., rgba(0,224,255,0.53) */
    var(--accent-color-44),   /* e.g., rgba(0,224,255,0.27) */
    transparent
  );
  opacity: 0.5;
  transition: opacity 0.3s;
}

.stat-card-accent:hover::before {
  opacity: 1;
}
```

Set `--accent-color` per card based on its Spectral Cluster role:

| Card | Accent | Hex |
|------|--------|-----|
| Active Agents | Hyper Cyan | `#00E0FF` (dark) / `#0891B2` (light) |
| Total Analyses | Sky Blue | `#7DD3FC` (dark) / `#0284C7` (light) |
| Reports Generated | Deep Indigo | `#6366F1` (dark) / `#4338CA` (light) |
| Active Analyses | Amber | `#FBBF24` (dark) / `#D97706` (light) |

---

## 5. Active Nav Item — Spectral Rail

Replace your current active sidebar highlight with a left-edge rail that glows:

```css
.nav-item-active {
  position: relative;
  background: rgba(0, 224, 255, 0.10);  /* dark */
  /* light: rgba(8, 145, 178, 0.08) */
}

.nav-item-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: #00E0FF;  /* dark — or #0891B2 for light */
  box-shadow: 0 0 10px rgba(0, 224, 255, 0.33);  /* dark only */
}
```

---

## 6. Agent Status Bar — Spectral Left Edge

Your agent working bar currently has no spectral presence. Add a left-edge gradient indicator:

```css
.agent-bar {
  position: relative;
  overflow: hidden;
}

.agent-bar::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(
    180deg,
    rgba(52, 211, 153, 0.53),    /* Green — agent active */
    rgba(0, 224, 255, 0.27)      /* Cyan — system identity */
  );
}
```

---

## 7. Staggered Fade-In Animations

Add entry animations to make the dashboard feel alive on load. Current dashboard has no motion.

```css
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Apply with increasing delays */
.banner       { animation: fadeUp 0.4s ease 0.05s both; }
.stat-card:nth-child(1) { animation: fadeUp 0.5s ease 0.10s both; }
.stat-card:nth-child(2) { animation: fadeUp 0.5s ease 0.16s both; }
.stat-card:nth-child(3) { animation: fadeUp 0.5s ease 0.22s both; }
.stat-card:nth-child(4) { animation: fadeUp 0.5s ease 0.28s both; }
.agent-bar    { animation: fadeUp 0.5s ease 0.32s both; }
.quick-action:nth-child(1) { animation: fadeUp 0.5s ease 0.35s both; }
.quick-action:nth-child(2) { animation: fadeUp 0.5s ease 0.41s both; }
.quick-action:nth-child(3) { animation: fadeUp 0.5s ease 0.47s both; }
.briefing     { animation: fadeUp 0.5s ease 0.50s both; }
.queue        { animation: fadeUp 0.5s ease 0.56s both; }
```

---

## Quick Reference — Implementation Order

Apply in this order for maximum visual impact with minimum risk:

1. **Card rim-lighting** (Section 4) — swap `border` for `box-shadow` on all cards. Instant upgrade, zero layout risk.
2. **Banner treatment** (Section 3) — add the spectral edge + wash. High visual impact, isolated to one component.
3. **Spectral mesh canvas** (Section 1) — add the background gradients. Biggest atmospheric change.
4. **Active nav rail** (Section 5) — replace sidebar active state. Small change, noticeable polish.
5. **Stat card accent strips** (Section 4, bottom half) — differentiate cards by cluster color.
6. **Sidebar bleed** (Section 2) — add edge gradient and corner glows. Finishing touch.
7. **Animations** (Section 7) — add last so you can tune timing after everything else is in place.
