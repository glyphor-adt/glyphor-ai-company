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
  'rounded-2xl border border-border bg-black/30 backdrop-blur-[10px] shadow-none';

/** Interactive glass card (hover lift + glow) */
export const GLASS_CARD_INTERACTIVE =
  `${GLASS_CARD_BASE} hover:border-border-hover hover:bg-black/40 hover:-translate-y-0.5 active:translate-y-0 transition-all`;

/* ── Input Fields ─────────────────────────── */

/** Glass input base */
export const GLASS_FIELD_BASE =
  'rounded-lg border border-border bg-black/30 backdrop-blur-[10px] shadow-none px-3 py-2 text-sm text-txt-secondary outline-none';

/** Glass input with focus ring */
export const GLASS_FIELD_FOCUS =
  `${GLASS_FIELD_BASE} focus:border-border-hover focus:bg-black/40 focus:shadow-none focus:ring-0 transition-all`;

/* ── Dialogs / Modals ─────────────────────── */

/** Glass dialog panel */
export const GLASS_DIALOG =
  'border border-border bg-black/30 backdrop-blur-[16px] shadow-none';

/* ── Buttons ──────────────────────────────── */

/** Glass button (secondary / ghost style) */
export const GLASS_BTN =
  'bg-black/30 backdrop-blur-[10px] border border-border shadow-none hover:border-border-hover transition-all';

/** Glass primary button (cyan accent) */
export const GLASS_BTN_PRIMARY =
  'rounded-lg bg-cyan/10 px-5 py-2 text-sm font-semibold text-cyan border border-transparent shadow-none hover:bg-cyan/20 transition-all';
