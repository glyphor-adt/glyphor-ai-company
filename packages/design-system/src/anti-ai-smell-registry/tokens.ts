// Anti-AI-Smell Design Tokens
// Enforces human-grade aesthetic patterns and eliminates generic AI output

export const typographyTokens = {
  // Strict hierarchy — prevents uniform "blur"
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
  button: {
    primary: {
      backgroundColor: 'var(--color-primary)',
      color: 'white',
      padding: '0.75rem 1.5rem',
      borderRadius: '0.375rem',
      fontWeight: 600,
      fontSize: '1rem'
    },
    secondary: {
      backgroundColor: 'transparent',
      color: 'var(--color-primary)',
      border: '2px solid var(--color-primary)',
      padding: '0.75rem 1.5rem',
      borderRadius: '0.375rem',
      fontWeight: 600,
      fontSize: '1rem'
    },
    ghost: {
      backgroundColor: 'transparent',
      color: 'var(--color-neutral-700)',
      padding: '0.75rem 1.5rem',
      fontWeight: 500,
      fontSize: '1rem'
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