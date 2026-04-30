// Anti-AI-Smell Design Tokens
// Enforces human-grade aesthetic patterns and eliminates generic AI output

export const typographyTokens = {
  // ── Display scale ──────────────────────────────────────────────────
  // Used exactly once each — documented here so they are INTENTIONAL,
  // not accidents. Tailwind utilities are the implementation; these
  // token names are the canonical reference.
  //   displayHero   → text-8xl  — hero h1 (glyphor-site/components/hero.tsx)
  //   displaySection → text-6xl  — footer CTA "Start building…" (footer.tsx)
  displayHero: {
    fontSize: '6rem',       // Tailwind text-8xl
    fontWeight: 900,
    lineHeight: 1,
    letterSpacing: '-0.04em',
  },
  displaySection: {
    fontSize: '3.75rem',    // Tailwind text-6xl
    fontWeight: 700,
    lineHeight: 1.05,
    letterSpacing: '-0.02em',
  },

  // ── Strict heading hierarchy — prevents uniform "blur" ─────────────
  heading1: {
    fontSize: '2.5rem',
    fontWeight: 700,
    lineHeight: 1.2,
    letterSpacing: '-0.02em',
    marginBottom: '1.5rem'
  },
  heading2: {
    fontSize: '2rem',
    fontWeight: 600,
    lineHeight: 1.3,
    letterSpacing: '-0.01em',
    marginBottom: '1rem'
  },
  heading3: {
    fontSize: '1.5rem',
    fontWeight: 600,
    lineHeight: 1.4,
    marginBottom: '0.75rem'
  },
  bodyLarge: {
    fontSize: '1.125rem',
    fontWeight: 400,
    lineHeight: 1.6,
    marginBottom: '1rem'
  },
  body: {
    fontSize: '1rem',
    fontWeight: 400,
    lineHeight: 1.6,
    marginBottom: '0.75rem'
  },
  caption: {
    fontSize: '0.875rem',
    fontWeight: 400,
    lineHeight: 1.5,
    opacity: 0.7
  }
};

export const spacingTokens = {
  // 4px baseline grid — prevents arbitrary spacing
  xs: '0.25rem', // 4px
  sm: '0.5rem',  // 8px
  md: '1rem',    // 16px
  lg: '1.5rem',  // 24px
  xl: '2rem',    // 32px
  '2xl': '3rem', // 48px
  '3xl': '4rem'  // 64px
};

export const colorTokens = {
  // Single accent color system — prevents rainbow gradients
  primary: '#2563eb', // Blue
  primaryDark: '#1d4ed8',
  primaryLight: '#3b82f6',
  
  neutral: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827'
  },
  
  // Only one accent color allowed per palette
  accent: '#dc2626', // Red (example — configurable)
  
  // Semantic colors
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6'
};

export const componentTokens = {
  /**
   * Button variants — canonical reference for all glyphor-site button patterns.
   * Implementation lives in packages/design-system/src/components/ui/button.tsx.
   *
   * INTENTIONAL BRANDING OVERRIDES (DO NOT convert to semantic tokens)
   * Some button usages near BG.jpg use text-black/bg-white explicitly because
   * BG.jpg stays light in dark mode. Those overrides are noted in-file with:
   *   // intentional: sits on BG.jpg, light in both themes
   */
  button: {
    // Pattern 1 + 7: main CTA (bg-accent/bg-primary)
    primary: {
      backgroundColor: 'var(--color-accent)',
      color: 'var(--color-accent-foreground)',
      padding: '0.625rem 1.25rem',
      borderRadius: '0.375rem',
      fontWeight: 500,
      fontSize: '0.875rem'
    },
    // Pattern: outlined secondary CTA
    secondary: {
      backgroundColor: 'var(--color-background)',
      color: 'var(--color-foreground)',
      border: '1px solid var(--color-border)',
      padding: '0.625rem 1.25rem',
      borderRadius: '0.375rem',
      fontWeight: 500,
      fontSize: '0.875rem'
    },
    // Pattern 4: theme-toggle row button
    ghost: {
      backgroundColor: 'transparent',
      color: 'var(--color-foreground)',
      padding: '0.5rem 0.75rem',
      borderRadius: '0.375rem',
      fontWeight: 500,
      fontSize: '0.875rem'
    },
    // Pattern 3 + 5: icon-only square (theme-switch, hamburger)
    icon: {
      backgroundColor: 'var(--color-background)',
      color: 'var(--color-foreground)',
      border: '1px solid var(--color-border)',
      borderRadius: '0.375rem',
      // Caller adds h-10 w-10 or h-12 w-12
    },
    // Pattern 1: desktop nav links
    nav: {
      backgroundColor: 'transparent',
      // Use var(--color-foreground-80) defined in globals.css; avoids color-mix() in JS
      color: 'var(--color-foreground-80)',
      padding: '0.5rem 1rem',
      borderRadius: '0.375rem',
      fontWeight: 500,
      fontSize: '0.875rem'
    },
    // Pattern 2: mobile accordion nav rows
    navMobile: {
      backgroundColor: 'transparent',
      color: 'var(--color-foreground)',
      padding: '1rem 0',
      fontWeight: 500,
      fontSize: '1rem',
      width: '100%',
    },
    // Pattern 7: hero layered "Try Today!" CTA shell
    hero: {
      borderRadius: '0.5rem',
      overflow: 'hidden',
      position: 'relative' as const,
    },
    // Pattern 6: footer circular CTA
    ctaCircular: {
      backgroundColor: 'var(--color-foreground)',
      color: 'var(--color-background)',
      borderRadius: '9999px',
      width: '3rem',
      height: '3rem',
    }
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '0.5rem',
    padding: 'var(--spacing-lg)',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    marginBottom: 'var(--spacing-md)'
  }
};

// Validation function to check if a style object violates anti-AI-smell rules
export function validateStyle(style: Record<string, any>): string[] {
  const violations: string[] = [];
  
  // Check for arbitrary spacing
  const spacingValues = Object.values(spacingTokens);
  if (style.padding && !spacingValues.includes(style.padding)) {
    violations.push(`Padding "${style.padding}" not in token scale`);
  }
  
  // Check for unauthorized colors
  const allowedColors = [
    ...Object.values(colorTokens).flat(),
    'transparent', 'white', 'black', 'currentColor'
  ];
  if (style.color && !allowedColors.includes(style.color)) {
    violations.push(`Color "${style.color}" not in token palette`);
  }
  
  // Check for excessive gradients (AI smell)
  if (style.backgroundImage && style.backgroundImage.includes('gradient')) {
    violations.push('Gradient backgrounds are prohibited (AI smell)');
  }
  
  return violations;
}