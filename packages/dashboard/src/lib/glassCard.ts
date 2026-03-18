/**
 * Glass Card Design Tokens
 *
 * Centralised Tailwind class strings for the glass-morphism design system.
 * Import and spread into className for consistent glass surfaces.
 *
 * All tokens assume dark-mode mesh-gradient background.
 * Glow shadows reference --glow-cyan-md / --glow-cyan-lg CSS custom properties.
 */

/* ── Cards ────────────────────────────────── */

/** Static glass card (no interaction) */
export const GLASS_CARD_BASE =
  'theme-glass-panel rounded-2xl shadow-none';

/** Interactive glass card (hover lift + glow) */
export const GLASS_CARD_INTERACTIVE =
  `${GLASS_CARD_BASE} hover:-translate-y-0.5 active:translate-y-0 transition-all`;

/* ── Input Fields ─────────────────────────── */

/** Glass input base */
export const GLASS_FIELD_BASE =
  'theme-glass-input rounded-lg shadow-none px-3 py-2 text-sm text-txt-secondary outline-none';

/** Glass input with focus ring */
export const GLASS_FIELD_FOCUS =
  `${GLASS_FIELD_BASE} focus:border-border-hover focus:shadow-none focus:ring-0 transition-all`;

/* ── Dialogs / Modals ─────────────────────── */

/** Glass dialog panel */
export const GLASS_DIALOG =
  'theme-glass-panel shadow-none';

/* ── Buttons ──────────────────────────────── */

/** Glass button (secondary / ghost style) */
export const GLASS_BTN =
  'theme-glass-panel-soft shadow-none hover:border-border-hover transition-all';

/** Glass primary button (cyan accent) */
export const GLASS_BTN_PRIMARY =
  'rounded-lg bg-cyan/10 px-5 py-2 text-sm font-semibold text-cyan border border-transparent shadow-none hover:bg-cyan/20 transition-all';
