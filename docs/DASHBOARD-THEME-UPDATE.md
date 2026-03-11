# Dashboard Theme Update: Prism Midnight → Dark Glass

## What You're Doing

You are updating the Glyphor AI Cockpit dashboard from the current Prism Midnight theme to a new Dark Glass design. The old theme has poor contrast — all surfaces sit in the same dark range and blur-based glassmorphism makes everything look like opaque mud. The new theme uses solid dark cards with per-card colored gradient sheens rising from the bottom, creating clear visual hierarchy without backdrop-filter blur.

Reference implementation: `glyphor-dark-glass.jsx` (attached alongside this file)

---

## Step 1: Replace Surface Tokens

Find and replace all existing Prism Midnight hex values with these new tokens. Create CSS custom properties or update your existing theme file.

### Surfaces
| Token | Old Value | New Value |
|-------|-----------|-----------|
| Canvas background | `#0D0F18` | `#111217` |
| Sidebar background | `#0B0D15` | `rgba(20,22,28,0.9)` |
| Card surface | `#131620` | `#1A1C22` |
| Inner/nested surface | `#151825` | `#15171C` |
| Modal surface | `#131620` | `#1A1C22` |
| Dropdown surface | `#131620` | `#1E2028` |

### Borders
| Token | Old Value | New Value |
|-------|-----------|-----------|
| Card border | `rgba(255,255,255,0.03)` | `rgba(255,255,255,0.06)` |
| Inner element border | `rgba(255,255,255,0.02)` | `rgba(255,255,255,0.05)` |
| Modal border | `rgba(255,255,255,0.03)` | `rgba(255,255,255,0.08)` |
| Sidebar border | `rgba(255,255,255,0.02)` | `rgba(255,255,255,0.04)` |

### Text
| Token | Old Value | New Value |
|-------|-----------|-----------|
| Primary text | `rgba(255,255,255,0.87)` | `#ECEEF4` |
| Secondary text | `rgba(255,255,255,0.45)` | `rgba(255,255,255,0.50)` |
| Tertiary text | `rgba(255,255,255,0.28)` | `rgba(255,255,255,0.28)` (unchanged) |

### Accents (unchanged, but for reference)
```
--accent-cyan:    #00E0FF   (primary CTA, active states)
--accent-blue:    #1171ED   (structural, secondary)
--accent-azure:   #00A3FF   (data viz, highlights)
--accent-indigo:  #6E77DF   (tertiary, architectural)
--accent-sky:     #7DD3FC   (informational)
--accent-green:   #34D399   (success, online)
--accent-amber:   #FBBF24   (warning)
--accent-red:     #EF4444   (error, high severity)
```

---

## Step 2: Create the Card Component

Replace all existing card/container divs with a reusable `Card` component. Every card in the dashboard must use this pattern.

### Card Props
- `accent` — RGB string like `"0,224,255"` controlling the gradient sheen color
- `glow` — boolean, adds a soft colored glow dot below the card

### Card Structure
```
┌─────────────────────────────────────┐ ← 1px specular top highlight
│                                     │
│  Content goes here                  │   background: #1A1C22
│                                     │   border: 1px solid rgba(255,255,255,0.06)
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │   border-radius: 18px
│  ░░░░░ gradient sheen ░░░░░░░░░░░░ │   overflow: hidden
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└─────────────────────────────────────┘
              🔵 glow dot (optional)
```

### Gradient Sheen (pseudo-element or child div)
```css
position: absolute;
bottom: 0;
left: 0;
right: 0;
height: 60%;
background: linear-gradient(
  to top,
  rgba(ACCENT, 0.08) 0%,
  rgba(ACCENT, 0.02) 40%,
  transparent 100%
);
pointer-events: none;
```

### Specular Top Edge (pseudo-element or child div)
```css
position: absolute;
top: 0;
left: 0;
right: 0;
height: 1px;
background: linear-gradient(
  90deg,
  transparent 10%,
  rgba(255,255,255,0.08) 50%,
  transparent 90%
);
```

### Glow Dot (when `glow` prop is true)
```css
position: absolute;
bottom: -20px;
left: 50%;
transform: translateX(-50%);
width: 120px;
height: 60px;
border-radius: 50%;
background: rgba(ACCENT, 0.15);
filter: blur(25px);
pointer-events: none;
```

### Card Accent Assignments
Apply these accents to each card by context:

| Card | Accent RGB |
|------|-----------|
| Hero / Welcome banner | `0,224,255` |
| Stat: Active Agents | `0,224,255` |
| Stat: Total Analyses | `0,163,255` |
| Stat: Reports Generated | `17,113,237` |
| Stat: Active Analyses | `110,119,223` |
| Agent Activity Bar | `52,211,153` |
| Quick Action: Research | `0,224,255` |
| Quick Action: Reports | `0,163,255` |
| Quick Action: Chat | `52,211,153` |
| Incidents Panel | `239,68,68` |
| Decision Queue | `17,113,237` |

---

## Step 3: Create InnerCard Component

For nested elements inside cards (status rows, incident items, decision queue items, agent pills).

```
background: #15171C
border: 1px solid rgba(255,255,255,0.05)
border-radius: 12px
```

Optional: bottom-up sheen at **half intensity** (0.06 instead of 0.08) using a contextual accent.

---

## Step 4: Collapse Sidebar to Icon-Only

Current sidebar is 180px with text labels. Change to 68px icon-only.

```
Width:      68px
Background: rgba(20,22,28,0.9)
Border:     1px solid rgba(255,255,255,0.04) on right edge
Padding:    20px 0
Alignment:  center (flex column, align-items center)
```

### Sidebar Items
- Logo icon: 36×36px, border-radius 10px, gradient background
- Nav icons: 40×40px hit target, border-radius 12px, centered icon
- Active state: `background: rgba(0,224,255,0.10)`, 3px left rail in `#00E0FF` with `box-shadow: 0 0 10px rgba(0,224,255,0.4)`
- Inactive icon color: `rgba(255,255,255,0.28)`
- Active icon color: `#00E0FF`
- User avatar at bottom: 34×34px circle
- Add `title` attribute to each icon for tooltip

---

## Step 5: Restructure to Two-Column Layout

Change the main content area from single column to two columns.

```
Left column:  flex: 1.5
Right column: width: 320px (fixed)
Gap:          20px
```

### Left Column (top to bottom, 16px gap)
1. Hero / Welcome card
2. Stat cards (4-column grid, 12px gap)
3. Agent activity bar
4. Quick Actions (3-column grid, 12px gap)
5. Bottom stats row (4-column grid, 12px gap)

### Right Column (top to bottom, 16px gap)
1. Open Incidents panel
2. Decision Queue panel

---

## Step 6: Build Overlay Components

### Modal
```
Background:    #1A1C22
Border-radius: 22px
Border:        1px solid rgba(255,255,255,0.08)
Box-shadow:    0 24px 80px rgba(0,0,0,0.5), 0 0 1px rgba(255,255,255,0.1)
```
- Specular top edge: 1px cyan gradient at 20% opacity
- Bottom gradient sheen: cyan at 6%
- Backdrop: `rgba(0,0,0,0.6)` with `backdrop-filter: blur(8px)`
- Entry animation: `scale(0.97) translateY(6px)` → `scale(1) translateY(0)`, 250ms

### Dropdown
```
Background:    #1E2028
Border-radius: 14px
Border:        1px solid rgba(255,255,255,0.08)
Box-shadow:    0 16px 48px rgba(0,0,0,0.5)
```
- Bottom sheen: cyan at 5%
- Item hover: `rgba(0,224,255,0.06)`
- Entry animation: same as modal, 150ms

### Toast
```
Background:    #1A1C22
Border-radius: 16px
Border:        1px solid rgba(255,255,255,0.08)
Box-shadow:    0 16px 48px rgba(0,0,0,0.4)
```
- Bottom sheen: contextual accent (green for success, red for error, amber for warning)
- Position: fixed, bottom 24px, right 24px
- Entry animation: `translateY(12px)` → `translateY(0)`, 280ms

---

## Step 7: Add Ambient Canvas Glow

Add a `<canvas>` element positioned absolute behind all content. This provides subtle animated atmospheric color.

```
Position:  absolute, inset 0, z-index 0
Opacity:   0.6
```

### Glow Spots
| Position | Color | Intensity | Radius |
|----------|-------|-----------|--------|
| 10%, 10% | `rgb(0, 180, 240)` | 0.4 | 500px |
| 85%, 20% | `rgb(100, 60, 180)` | 0.25 | 400px |
| 30%, 80% | `rgb(0, 224, 255)` | 0.2 | 350px |

Each glow drifts slowly using `sin(time * 0.03)` and `cos(time * 0.02)` at 20-30px displacement. Render via `ctx.createRadialGradient`. Use `clearRect` each frame (not additive blending). Use `requestAnimationFrame` with cleanup on unmount.

---

## What to Remove

Delete or replace these patterns from the current codebase:

- **Old surface hex values**: `#0D0F18`, `#131620`, `#151825` and any variants
- **Chromatic Value Clustering**: the 2px top-edge accent strips on cards — replaced by bottom-up gradient sheens
- **Spectral Cluster CSS layers**: `Cyan Nebula`, `Indigo Anchor`, `Purple Edge` radial backgrounds — replaced by canvas glow
- **backdrop-filter glassmorphism**: any `backdrop-filter: blur(24-64px) saturate(...)` on cards — cards are now opaque `#1A1C22`
- **180px text sidebar**: replaced by 68px icon sidebar
- **Uniform card borders**: all cards had the same faint cyan border — now each card has its own accent sheen

---

## Reference

The working prototype is in `glyphor-dark-glass.jsx`. Pattern-match against it for any details not covered above.
