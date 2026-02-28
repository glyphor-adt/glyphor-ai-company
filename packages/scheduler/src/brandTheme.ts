/**
 * Glyphor AI Brand Theme
 *
 * Centralized design system constants for all generated documents,
 * presentations, infographics, and reports. Ensures visual consistency
 * across PPTX, DOCX, Markdown, and image outputs.
 *
 * Design language: Modern, minimal, data-forward. Clean white backgrounds,
 * cyan accent, charcoal typography, generous whitespace. Professional
 * consulting-grade aesthetic with Glyphor's own identity.
 */

/* ── Color Palette ── */

export const BRAND = {
  /** Primary accent — Glyphor cyan */
  cyan:     '#00E0FF',
  cyanHex:  '00E0FF',

  /** Secondary accent — deep indigo */
  indigo:   '#623CEA',
  indigoHex: '623CEA',

  /** Dark charcoal — primary text, headers */
  charcoal: '#1A1A2E',
  charcoalHex: '1A1A2E',

  /** Text color — body copy */
  text:     '#1F2937',
  textHex:  '1F2937',

  /** Muted text — captions, subtitles, metadata */
  muted:    '#6B7280',
  mutedHex: '6B7280',

  /** Light muted — footer text, watermarks */
  faint:    '#999999',
  faintHex: '999999',

  /** Background — primary white */
  bg:       '#FFFFFF',
  bgHex:    'FFFFFF',

  /** Background — raised panels, cards */
  bgRaised: '#F3F4F6',
  bgRaisedHex: 'F3F4F6',

  /** Semantic: positive/success */
  green:    '#34D399',
  greenHex: '34D399',
  greenDark: '#059669',
  greenDarkHex: '059669',

  /** Semantic: warning/caution */
  amber:    '#FBBF24',
  amberHex: 'FBBF24',
  amberDark: '#D97706',
  amberDarkHex: 'D97706',

  /** Semantic: negative/danger */
  red:      '#FB7185',
  redHex:   'FB7185',
  redDark:  '#DC2626',
  redDarkHex: 'DC2626',

  /** Semantic: info/link */
  blue:     '#60A5FA',
  blueHex:  '60A5FA',
  blueDark: '#2563EB',
  blueDarkHex: '2563EB',
} as const;

/* ── Typography ── */

export const TYPOGRAPHY = {
  /** Primary font for headings */
  heading: 'Segoe UI',
  /** Primary font for body text */
  body: 'Segoe UI',
  /** Monospace for code/data */
  mono: 'Cascadia Code',
  /** Letter-spacing for brand mark */
  brandLetterSpacing: 5,
} as const;

/* ── Brand Identity ── */

export const IDENTITY = {
  /** Spaced-out brand mark for slides/headers */
  brandMark: 'G L Y P H O R   A I',
  /** Standard company name */
  companyName: 'Glyphor AI',
  /** Strategy division name */
  strategyLab: 'Glyphor Strategy Lab',
  /** Confidentiality notice */
  confidential: 'Confidential',
  /** Standard footer text */
  footer: 'GLYPHOR AI  ·  Confidential',
} as const;

/* ── Document Labels ── */

export const DOC_LABELS = {
  deepDive: 'Strategic Deep Dive',
  analysis: 'Strategic Analysis',
  simulation: 'Impact Simulation',
  cot: 'Chain of Thought',
  strategyLab: 'Strategy Lab Analysis',
} as const;

/* ── Visual Prompt Palette Description ── */

export const VISUAL_PALETTE_PROMPT = [
  `Color palette: primary cyan (${BRAND.cyan}), white (${BRAND.bg}) background, dark charcoal (${BRAND.charcoal}) text,`,
  `emerald (${BRAND.green}) for positive, rose (${BRAND.red}) for negative, amber (${BRAND.amber}) for caution.`,
  `Use soft pastel tinted backgrounds for card sections.`,
].join(' ');

export const VISUAL_STYLE_PROMPT = [
  `Style: modern flat design, white background, generous whitespace, minimal text.`,
  `Use bold typography, color-coded cards, and data callouts.`,
  `Professional executive consulting aesthetic — clean, data-forward, not decorative.`,
  `All text must be legible — minimum 11px equivalent, sans-serif.`,
  `Do NOT include any third-party branding or "Powered by" text.`,
  `Footer should read "Glyphor Strategy Lab".`,
].join(' ');

/* ── PPTX Slide Constants ── */

export const SLIDE = {
  bg:     BRAND.bgHex,
  bg2:    BRAND.bgRaisedHex,
  text:   BRAND.textHex,
  muted:  BRAND.mutedHex,
  cyan:   BRAND.cyanHex,
  amber:  BRAND.amberHex,
  green:  BRAND.greenHex,
  red:    BRAND.redHex,
  purple: BRAND.indigoHex,
  white:  BRAND.bgHex,
} as const;

/* ── DOCX Style Constants ── */

export const DOCX_STYLES = {
  /** Primary heading color */
  headingColor: BRAND.cyanHex.replace('#', ''),
  /** Section divider color */
  dividerColor: BRAND.cyanHex.replace('#', ''),
  /** Body text color */
  bodyColor: '2D2D2D',
  /** Page margins in inches */
  margin: { top: 0.8, bottom: 0.8, left: 1.0, right: 1.0 },
} as const;
