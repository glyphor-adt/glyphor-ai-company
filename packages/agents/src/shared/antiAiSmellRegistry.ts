/**
 * Anti-AI-Smell Component Registry
 *
 * Addresses issue: "Anti-AI-Smell Component Registry Setup"
 *
 * This registry:
 *   1. Catalogues recurring "AI blur" patterns found in React/Tailwind templates.
 *   2. Defines a strict set of design tokens tuned to eliminate each pattern.
 *   3. Exports tools downstream generation can pull from to ensure A/A+ quality.
 *
 * Success criteria:
 *   - Component output originality score > 80%
 *   - Typographical hierarchy score > 90%
 *
 * Tools:
 *   get_anti_ai_smell_registry        — Full registry: patterns + remediation tokens
 *   score_component_originality       — Score a component's originality (0–100)
 *   score_typography_hierarchy        — Score typographic hierarchy depth (0–100)
 *   validate_component_against_registry — Validate a component file against registry rules
 */

import type { ToolDefinition, ToolResult } from '@glyphor/agent-runtime';

// ─── AI Blur Pattern Catalogue ───────────────────────────────────────────────

/**
 * Each entry describes a pattern observed in AI-generated React/Tailwind output,
 * why it signals "the blur", and how to fix it via a design-token constraint.
 */
export interface AiBlurPattern {
  /** Unique identifier for the pattern */
  id: string;
  /** Human-readable name */
  name: string;
  /** What it looks like in practice */
  description: string;
  /** Why AI models keep generating it */
  aiOrigin: string;
  /**
   * Regex patterns that indicate this smell in JSX/TSX/CSS source.
   * Used when simple substring matching suffices.
   * At least one of `detectionPatterns` or `detect` must be provided.
   */
  detectionPatterns: RegExp[];
  /**
   * Optional custom detection function for patterns that require global
   * string context (e.g. "component has X but lacks Y anywhere").
   * When provided, this is used INSTEAD of `detectionPatterns`.
   */
  detect?: (source: string) => boolean;
  /** The remediation: what token(s) or rule to apply instead */
  remediationTokens: string[];
  /** How much this pattern hurts originality score when found (0–100 deduction) */
  originalityPenalty: number;
  /** How much this pattern hurts typography hierarchy score (0–100 deduction) */
  typographyPenalty: number;
}

export const AI_BLUR_PATTERNS: AiBlurPattern[] = [
  // ── Typography flatness ──────────────────────────────────────────────────
  {
    id: 'flat-font-weight',
    name: 'Flat font-weight — everything at 400 or 500',
    description:
      'All text elements use font-weight: 400 (normal) or font-weight: 500 (medium) with no ' +
      'meaningful contrast between heading, subheading, and body layers.',
    aiOrigin:
      'LLMs default to "safe" medium weights because they appear in most Tailwind starter kits ' +
      'as the first listed weight.',
    detectionPatterns: [],
    detect: (src) =>
      /\bfont-(?:normal|medium)\b/.test(src) &&
      !/\bfont-(?:semibold|bold|extrabold|black)\b/.test(src),
    remediationTokens: [
      'font-weight-display: 800 (extrabold) for hero headings',
      'font-weight-title: 700 (bold) for section headings',
      'font-weight-subtitle: 600 (semibold) for labels and captions',
      'font-weight-body: 400 (normal) for running text',
    ],
    originalityPenalty: 15,
    typographyPenalty: 25,
  },
  {
    id: 'uniform-type-scale',
    name: 'Uniform type scale — no large text sizes, only base/sm/xs',
    description:
      'Components use only small text sizes (base, sm, xs) with no large display or heading ' +
      'sizes, collapsing the typographic hierarchy to a single visual layer.',
    aiOrigin:
      'Models copy the smallest valid Tailwind snippet rather than reasoning about visual hierarchy.',
    detectionPatterns: [],
    detect: (src) =>
      /\btext-(?:base|sm|xs)\b/.test(src) &&
      !/\btext-(?:2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|xl|display|heading|subheading)\b/.test(src),
    remediationTokens: [
      'text-display: clamp(2.5rem, 5vw, 4rem) — hero headline',
      'text-heading: 1.75rem / line-height 1.2 — section title',
      'text-subheading: 1.125rem / line-height 1.35 — card title',
      'text-body: 1rem / line-height 1.6 — paragraph',
      'text-caption: 0.8125rem / line-height 1.5 — meta, labels',
      'text-micro: 0.6875rem / line-height 1.4 — badges, fine print',
    ],
    originalityPenalty: 12,
    typographyPenalty: 30,
  },
  {
    id: 'missing-letter-spacing',
    name: 'Zero letter-spacing on headings',
    description:
      'Large display headings lack tracking adjustments, making them look browser-default ' +
      'and indistinguishable from any unstyled h1.',
    aiOrigin:
      'Tracking is rarely mentioned in Tailwind docs examples so models omit it.',
    detectionPatterns: [
      /(?:text-[3-9]xl|text-display)(?!.*tracking-)/,
    ],
    remediationTokens: [
      'tracking-display: -0.04em (tight) for display sizes',
      'tracking-heading: -0.02em for h1–h2',
      'tracking-subheading: -0.01em for h3–h4',
      'tracking-wide: 0.06em for uppercase labels / badges',
    ],
    originalityPenalty: 8,
    typographyPenalty: 15,
  },

  // ── Spacing flatness ─────────────────────────────────────────────────────
  {
    id: 'uniform-spacing',
    name: 'Uniform spacing — everything at p-4 / gap-4',
    description:
      'Padding and gap values are identical throughout a component (almost always p-4 or gap-4), ' +
      'eliminating the breathing room that makes layouts feel intentional.',
    aiOrigin:
      'The most common Tailwind example snippet uses p-4 so it becomes the model default.',
    detectionPatterns: [
      /\b(?:p|px|py|pt|pb|pl|pr|gap)-4\b.*\b(?:p|px|py|pt|pb|pl|pr|gap)-4\b/s,
    ],
    remediationTokens: [
      'spacing-xs: 0.25rem (4px) — icon gutters',
      'spacing-sm: 0.5rem (8px) — tight inline gaps',
      'spacing-md: 1rem (16px) — card internal padding',
      'spacing-lg: 1.5rem (24px) — section internal padding',
      'spacing-xl: 2.5rem (40px) — section vertical margins',
      'spacing-2xl: 4rem (64px) — between major page sections',
      'spacing-3xl: 6rem (96px) — hero vertical breathing room',
    ],
    originalityPenalty: 10,
    typographyPenalty: 0,
  },
  {
    id: 'default-border-radius',
    name: 'Default border-radius — rounded-md everywhere',
    description:
      'All interactive elements (buttons, cards, inputs) use rounded-md (6px), ' +
      'creating a visually indistinct uniformity.',
    aiOrigin:
      'rounded-md appears in the Tailwind "button" example so models treat it as the universal default.',
    detectionPatterns: [
      /\brounded-md\b.*\brounded-md\b/s,
    ],
    remediationTokens: [
      'radius-pill: 9999px — primary CTAs and tags',
      'radius-card: 1rem (16px) — elevated cards',
      'radius-input: 0.5rem (8px) — form inputs',
      'radius-dialog: 1.5rem (24px) — modal containers',
      'radius-sm: 0.25rem (4px) — inline chips',
      'radius-none: 0 — full-bleed sections, dividers',
    ],
    originalityPenalty: 8,
    typographyPenalty: 0,
  },

  // ── Color flatness ───────────────────────────────────────────────────────
  {
    id: 'surface-monotony',
    name: 'Surface monotony — single background tone',
    description:
      'All sections share the same background value (bg-white, bg-gray-50, or bg-slate-900), ' +
      'producing zero visual rhythm across page sections.',
    aiOrigin:
      'Models rarely implement a surface elevation ladder unless explicitly prompted.',
    detectionPatterns: [
      /bg-(?:white|gray-50)\b.*bg-(?:white|gray-50)\b.*bg-(?:white|gray-50)\b/s,
      /bg-(?:slate|zinc|neutral)-900\b.*bg-(?:slate|zinc|neutral)-900\b.*bg-(?:slate|zinc|neutral)-900\b/s,
    ],
    remediationTokens: [
      'surface-base: page root background',
      'surface-raised: +1 elevation — cards, sidebars',
      'surface-overlay: +2 elevation — modals, popovers',
      'surface-inset: sunken — code blocks, input fields',
      'surface-accent: brand-tinted section — CTA strips, hero sections',
    ],
    originalityPenalty: 12,
    typographyPenalty: 0,
  },
  {
    id: 'generic-button-style',
    name: 'Generic button style — blue bg-blue-600 rounded text-white',
    description:
      'Primary CTA buttons use generic blue with no brand accent, hover state, or ' +
      'visual weight relative to surrounding elements.',
    aiOrigin:
      'bg-blue-600 text-white is the first color pairing that appears in training data ' +
      'for any clickable element.',
    detectionPatterns: [
      // Allow any class names (alphanumeric, hyphen, space) between the two tokens
      /bg-blue-(?:500|600|700)\b[\w\s-]*text-white\b/,
      /bg-indigo-(?:500|600|700)\b[\w\s-]*text-white\b/,
    ],
    remediationTokens: [
      'btn-primary: brand accent color + high contrast foreground',
      'btn-primary-hover: 10% lighter/darker via opacity modifier',
      'btn-primary-active: scale-[0.97] + slight shadow reduction',
      'btn-secondary: outlined, border-current, transparent bg',
      'btn-ghost: text-only, subtle bg-hover, no border',
    ],
    originalityPenalty: 15,
    typographyPenalty: 5,
  },

  // ── Layout genericness ────────────────────────────────────────────────────
  {
    id: 'card-grid-sameness',
    name: 'Card-grid sameness — three equal-width cards in a row',
    description:
      'Feature / pricing / team sections always produce exactly three equal-width cards ' +
      'with identical padding and no visual hierarchy between them.',
    aiOrigin:
      'grid-cols-3 gap-4 appears in countless landing-page tutorials consumed by the model.',
    detectionPatterns: [
      /grid-cols-3\s+gap-(?:4|6|8)/,
    ],
    remediationTokens: [
      'Use asymmetric grids: e.g. grid-cols-[2fr_1fr] for feature + sidebar',
      'Vary card elevation with surface-raised tokens per visual priority',
      'Apply a featured-card modifier: scale-[1.03] + ring-1 ring-accent',
      'Offset grid rows with translate-y for staggered visual rhythm',
    ],
    originalityPenalty: 10,
    typographyPenalty: 8,
  },
];

// ─── Anti-AI-Smell Design Token Subset ───────────────────────────────────────

/**
 * The canonical token set downstream generation must consume.
 * Every value is chosen to break the "AI blur" defaults.
 */
export const ANTI_AI_SMELL_TOKENS = {
  /** Typography — strict 6-level scale with intentional weight contrast */
  typography: {
    fontSizes: {
      display: 'clamp(2.5rem, 5vw, 4rem)',
      heading: '1.75rem',
      subheading: '1.125rem',
      body: '1rem',
      caption: '0.8125rem',
      micro: '0.6875rem',
    },
    fontWeights: {
      // Stored as strings to match the Tailwind CSS variable / token format.
      // These are documentation values — convert to numbers if used in CSS-in-JS contexts.
      display: '800',   // extrabold — hero headlines only
      title: '700',     // bold — section headings
      subtitle: '600',  // semibold — card titles, labels
      body: '400',      // normal — running text
      ui: '500',        // medium — UI chrome, nav, metadata
    },
    lineHeights: {
      display: '1.05',
      heading: '1.2',
      subheading: '1.35',
      body: '1.6',
      caption: '1.5',
      micro: '1.4',
    },
    letterSpacings: {
      display: '-0.04em',
      heading: '-0.02em',
      subheading: '-0.01em',
      body: '0em',
      wide: '0.06em',   // uppercase utility labels, badges
    },
  },

  /** Spacing — 7-step scale anchored on 4px, breaking the p-4 monoculture */
  spacing: {
    xs: '0.25rem',   //  4px
    sm: '0.5rem',    //  8px
    md: '1rem',      // 16px
    lg: '1.5rem',    // 24px
    xl: '2.5rem',    // 40px
    '2xl': '4rem',   // 64px
    '3xl': '6rem',   // 96px
  },

  /** Border radius — 6 intentional variants, no universal rounded-md */
  radii: {
    none: '0',
    sm: '0.25rem',   //  4px — inline chips
    input: '0.5rem', //  8px — form inputs
    card: '1rem',    // 16px — elevated cards
    dialog: '1.5rem', // 24px — modals
    pill: '9999px',  // fully rounded — CTAs, tags
  },

  /** Surface elevation ladder — breaks single-tone monotony */
  surfaces: {
    base: 'var(--color-base)',          // page root
    raised: 'var(--color-raised)',      // cards, sidebars
    overlay: 'var(--color-overlay)',    // modals, popovers
    inset: 'var(--color-inset)',        // inputs, code blocks
    accent: 'var(--color-surface-accent)', // brand-tinted sections
  },

  /** Button system — brand-anchored, 3 semantic variants */
  buttons: {
    primary: {
      background: 'var(--color-primary)',
      foreground: 'var(--color-primary-foreground)',
      hover: 'opacity-90',
      active: 'scale-[0.97]',
    },
    secondary: {
      background: 'transparent',
      border: 'border border-current',
      hover: 'bg-current/5',
    },
    ghost: {
      background: 'transparent',
      hover: 'bg-current/8',
    },
  },
} as const;

// ─── Scoring helpers ──────────────────────────────────────────────────────────

/** Run a single pattern's detection against source code. */
function patternMatches(pattern: AiBlurPattern, source: string): boolean {
  if (pattern.detect) {
    return pattern.detect(source);
  }
  return pattern.detectionPatterns.some((re) => re.test(source));
}

/**
 * Compute an originality score (0–100) for a block of component source code.
 * Deductions are applied per matched AI-blur pattern.
 * Score > 80 meets the success criterion.
 */
export function scoreComponentOriginality(source: string): {
  score: number;
  deductions: { patternId: string; patternName: string; penalty: number }[];
  meetsTarget: boolean;
} {
  const deductions: { patternId: string; patternName: string; penalty: number }[] = [];

  for (const pattern of AI_BLUR_PATTERNS) {
    if (patternMatches(pattern, source)) {
      deductions.push({
        patternId: pattern.id,
        patternName: pattern.name,
        penalty: pattern.originalityPenalty,
      });
    }
  }

  const totalPenalty = deductions.reduce((sum, d) => sum + d.penalty, 0);
  const score = Math.max(0, 100 - totalPenalty);

  return {
    score,
    deductions,
    meetsTarget: score > 80,
  };
}

/**
 * Compute a typographic hierarchy score (0–100) for a block of component source code.
 * Checks for the presence of multiple distinct size, weight, and tracking levels.
 * Score > 90 meets the success criterion.
 */
export function scoreTypographyHierarchy(source: string): {
  score: number;
  levelsFound: string[];
  deductions: { patternId: string; patternName: string; penalty: number }[];
  meetsTarget: boolean;
} {
  const deductions: { patternId: string; patternName: string; penalty: number }[] = [];

  for (const pattern of AI_BLUR_PATTERNS) {
    if (pattern.typographyPenalty === 0) continue;
    if (patternMatches(pattern, source)) {
      deductions.push({
        patternId: pattern.id,
        patternName: pattern.name,
        penalty: pattern.typographyPenalty,
      });
    }
  }

  // Reward positive signals: distinct size levels in the component
  // Arbitrary-value Tailwind syntax: text-[clamp(...)] or text-[1.75rem], etc.
  const sizeLevels = [
    { key: 'display', pattern: /\b(?:text-display|text-[4-9]xl|text-\[clamp\()\b/ },
    { key: 'heading', pattern: /\b(?:text-heading|text-[23]xl|text-\[1\.75)\b/ },
    { key: 'subheading', pattern: /\b(?:text-subheading|text-xl|text-\[1\.125)\b/ },
    { key: 'body', pattern: /\b(?:text-body|text-base|text-\[1rem)\b/ },
    { key: 'caption', pattern: /\b(?:text-caption|text-sm|text-\[0\.8125)\b/ },
    { key: 'micro', pattern: /\b(?:text-micro|text-xs|text-\[0\.6875)\b/ },
  ];

  const levelsFound = sizeLevels
    .filter((l) => l.pattern.test(source))
    .map((l) => l.key);

  // Bonus constants for typographic richness reward
  const MIN_LEVELS_FOR_BONUS = 3;   // at least 3 distinct size levels to earn a bonus
  const BONUS_PER_EXTRA_LEVEL = 5;  // points awarded per level above the minimum
  const MAX_LEVEL_BONUS = 10;       // cap so bonus cannot override real penalty signals

  // Bonus: components with ≥3 distinct size levels get a positive signal
  const levelBonus = levelsFound.length >= MIN_LEVELS_FOR_BONUS
    ? Math.min(MAX_LEVEL_BONUS, (levelsFound.length - MIN_LEVELS_FOR_BONUS + 1) * BONUS_PER_EXTRA_LEVEL)
    : 0;

  const totalPenalty = deductions.reduce((sum, d) => sum + d.penalty, 0);
  const score = Math.min(100, Math.max(0, 100 - totalPenalty + levelBonus));

  return {
    score,
    levelsFound,
    deductions,
    meetsTarget: score > 90,
  };
}

// ─── Tool factory ─────────────────────────────────────────────────────────────

export function createAntiAiSmellTools(): ToolDefinition[] {
  return [
    // ─── 1. get_anti_ai_smell_registry ────────────────────────────────────
    {
      name: 'get_anti_ai_smell_registry',
      description:
        'Return the full Anti-AI-Smell Component Registry: the catalogue of AI-blur patterns ' +
        'found in React/Tailwind templates and the curated design-token subset that eliminates them. ' +
        'Use this before generating any component to understand what to avoid and what tokens to use.',
      parameters: {
        section: {
          type: 'string',
          description:
            'Which section to return. Defaults to "all". ' +
            '"patterns" — only the AI-blur pattern catalogue. ' +
            '"tokens" — only the anti-AI-smell token subset.',
          enum: ['patterns', 'tokens', 'all'],
        },
      },
      async execute(params): Promise<ToolResult> {
        const section = (params.section as string) || 'all';

        const patterns = AI_BLUR_PATTERNS.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          aiOrigin: p.aiOrigin,
          remediationTokens: p.remediationTokens,
          penalties: {
            originality: p.originalityPenalty,
            typography: p.typographyPenalty,
          },
        }));

        if (section === 'patterns') {
          return { success: true, data: { patterns } };
        }
        if (section === 'tokens') {
          return { success: true, data: { tokens: ANTI_AI_SMELL_TOKENS } };
        }
        return {
          success: true,
          data: {
            patterns,
            tokens: ANTI_AI_SMELL_TOKENS,
            successCriteria: {
              originalityScore: '> 80',
              typographyHierarchyScore: '> 90',
            },
          },
        };
      },
    },

    // ─── 2. score_component_originality ───────────────────────────────────
    {
      name: 'score_component_originality',
      description:
        'Score a React/Tailwind component source string for originality (0–100). ' +
        'Deductions are applied for each AI-blur pattern detected. ' +
        'The target score is > 80 for A/A+ agency-grade output. ' +
        'Returns the numeric score, which patterns caused deductions, and whether the target is met.',
      parameters: {
        source: {
          type: 'string',
          description: 'The full JSX/TSX source code of the component to score.',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const source = params.source as string;
        if (!source || typeof source !== 'string') {
          return { success: false, error: 'source parameter is required and must be a string' };
        }
        const result = scoreComponentOriginality(source);
        return {
          success: true,
          data: {
            ...result,
            grade:
              result.score >= 90 ? 'A+' :
              result.score >= 80 ? 'A' :
              result.score >= 70 ? 'B' :
              result.score >= 55 ? 'C' : 'F',
          },
        };
      },
    },

    // ─── 3. score_typography_hierarchy ────────────────────────────────────
    {
      name: 'score_typography_hierarchy',
      description:
        'Score a React/Tailwind component source string for typographic hierarchy depth (0–100). ' +
        'Checks for distinct size levels, weight contrast, and tracking. ' +
        'The target score is > 90 for A/A+ agency-grade output. ' +
        'Returns the score, which hierarchy levels are present, and deductions for flat-type patterns.',
      parameters: {
        source: {
          type: 'string',
          description: 'The full JSX/TSX source code of the component to score.',
          required: true,
        },
      },
      async execute(params): Promise<ToolResult> {
        const source = params.source as string;
        if (!source || typeof source !== 'string') {
          return { success: false, error: 'source parameter is required and must be a string' };
        }
        const result = scoreTypographyHierarchy(source);
        return {
          success: true,
          data: {
            ...result,
            grade:
              result.score >= 95 ? 'A+' :
              result.score >= 90 ? 'A' :
              result.score >= 80 ? 'B' :
              result.score >= 65 ? 'C' : 'F',
          },
        };
      },
    },

    // ─── 4. validate_component_against_registry ───────────────────────────
    {
      name: 'validate_component_against_registry',
      description:
        'Run both originality and typography-hierarchy scoring on a component source string ' +
        'and return a combined validation report with pass/fail against the A/A+ success criteria ' +
        '(originality > 80, typography hierarchy > 90). ' +
        'Use this as a quality gate before committing or deploying a generated component.',
      parameters: {
        source: {
          type: 'string',
          description: 'The full JSX/TSX source code of the component to validate.',
          required: true,
        },
        component_name: {
          type: 'string',
          description: 'Optional display name for the component (used in the report).',
        },
      },
      async execute(params): Promise<ToolResult> {
        const source = params.source as string;
        if (!source || typeof source !== 'string') {
          return { success: false, error: 'source parameter is required and must be a string' };
        }
        const componentName = (params.component_name as string) || 'UnnamedComponent';

        const originality = scoreComponentOriginality(source);
        const typography = scoreTypographyHierarchy(source);

        const passed = originality.meetsTarget && typography.meetsTarget;

        const allDeductions = [
          ...originality.deductions.map((d) => ({ ...d, dimension: 'originality' as const })),
          ...typography.deductions
            .filter((d) => !originality.deductions.some((od) => od.patternId === d.patternId))
            .map((d) => ({ ...d, dimension: 'typography' as const })),
        ];

        return {
          success: true,
          data: {
            component: componentName,
            passed,
            scores: {
              originality: {
                score: originality.score,
                target: 80,
                meetsTarget: originality.meetsTarget,
                grade:
                  originality.score >= 90 ? 'A+' :
                  originality.score >= 80 ? 'A' :
                  originality.score >= 70 ? 'B' :
                  originality.score >= 55 ? 'C' : 'F',
              },
              typographyHierarchy: {
                score: typography.score,
                target: 90,
                meetsTarget: typography.meetsTarget,
                levelsFound: typography.levelsFound,
                grade:
                  typography.score >= 95 ? 'A+' :
                  typography.score >= 90 ? 'A' :
                  typography.score >= 80 ? 'B' :
                  typography.score >= 65 ? 'C' : 'F',
              },
            },
            deductions: allDeductions,
            recommendation: passed
              ? 'Component passes all Anti-AI-Smell quality gates. Safe to ship.'
              : [
                  'Component does NOT pass quality gates. Address these patterns before shipping:',
                  ...allDeductions.map(
                    (d) => `  • [${d.dimension}] ${d.patternName} (−${d.penalty} pts) — see registry for remediation tokens`,
                  ),
                ].join('\n'),
          },
        };
      },
    },
  ];
}

