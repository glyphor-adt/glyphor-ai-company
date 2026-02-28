# Scrollbar Usage Guidelines

## Overview

The Glyphor AI Company dashboard uses a custom scrollbar design that adapts to both light and dark modes. This document outlines when and how to use scrollbar utility classes.

## Default Behavior

By default, **all scrollable areas display a themed scrollbar**:
- Width: 6px (thin, unobtrusive)
- Colors: Theme-adaptive via CSS variables
  - Light mode: `#dde1ec` (thumb), `#9ca3af` (hover)
  - Dark mode: `#242840` (thumb), `#313655` (hover)
- Appearance: Rounded, transparent track, styled thumb

**This default is intentional for UX and accessibility** — users need visual cues for page depth and scroll position.

## Utility Classes

### `.scrollbar-visible`

**Purpose**: Explicitly force scrollbar visibility on an element.

**When to use**:
- Content-heavy areas where users need scroll position awareness
- Lists, tables, or long-form text containers
- Areas where users might lose context without scroll indicators

**Example**:
```tsx
<div className="overflow-auto scrollbar-visible h-96">
  {/* Long content */}
</div>
```

### `.scrollbar-hide`

**Purpose**: Hide scrollbars on specific elements.

**⚠️ Use sparingly!** This should only be applied in rare cases where scrollbars interfere with the design or user experience.

**Acceptable use cases**:
- Hidden/collapsed sidebars that slide out
- Horizontal scroll containers where custom scroll indicators are provided
- Decorative overflow containers (e.g., background effects)

**DO NOT use for**:
- Main content areas
- Any area where users need to scroll to access important information
- Data tables or lists

**Example**:
```tsx
<div className="overflow-x-auto scrollbar-hide">
  {/* Horizontal scrolling with custom controls */}
</div>
```

## Browser Support

Both utility classes support:
- **Chrome/Safari/Edge**: `::-webkit-scrollbar` pseudo-elements
- **Firefox**: `scrollbar-width` property
- **IE/Legacy Edge**: `-ms-overflow-style` property

## Best Practices

1. **Default is best**: In most cases, rely on the default themed scrollbars. They're already designed to be minimal and adaptive.

2. **Accessibility first**: Hiding scrollbars removes visual cues that users rely on. Always consider:
   - Can users tell if there's more content?
   - Will they know how far they've scrolled?
   - Is the scroll container tall enough that position matters?

3. **Test in both modes**: Verify scrollbar appearance in both light and dark modes.

4. **Mobile considerations**: Touch devices handle scrollbars differently. Test your layouts on mobile to ensure the utility classes don't create unexpected behavior.

## Migration Notes

If you find code using inline styles to hide scrollbars (e.g., `style={{ scrollbarWidth: 'none' }}`), replace it with:
- **If hiding is justified**: Use `.scrollbar-hide` class
- **If not justified**: Remove the hiding and let default scrollbars show

## Questions?

If you're unsure whether to hide scrollbars in a specific component, default to **showing them**. Visual scroll indicators improve UX and accessibility.
