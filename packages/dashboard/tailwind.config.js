import prism from './prism.tailwind.js';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      ...prism.theme.extend,
      colors: {
        ...prism.theme.extend.colors,
        // Shell – driven by CSS custom properties
        base: 'var(--color-base)',
        surface: 'var(--color-surface)',
        raised: 'var(--color-raised)',
        border: 'var(--color-border)',
        'border-hover': 'var(--color-border-hover)',
        // Text semantic tokens
        'txt-primary': 'var(--color-txt-primary)',
        'txt-secondary': 'var(--color-txt-secondary)',
        'txt-muted': 'var(--color-txt-muted)',
        'txt-faint': 'var(--color-txt-faint)',
        // Primary
        primary: 'rgb(var(--cyan) / <alpha-value>)',
        cyan: 'rgb(var(--cyan) / <alpha-value>)',
        azure: 'rgb(var(--azure) / <alpha-value>)',
        pink: '#EC4899',
        purple: '#623CEA',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        // Agent roles (fixed mid-tones for decorative accents)
        exec: '#7C3AED',
        eng: '#2563EB',
        product: '#0891B2',
        finance: '#0369A1',
        marketing: '#7C3AED',
        cs: '#0E7490',
        sales: '#1D4ED8',
        // Tiers (mode-adaptive via CSS vars)
        'tier-green': 'rgb(var(--cyan) / <alpha-value>)',
        'tier-yellow': 'rgb(var(--azure) / <alpha-value>)',
        'tier-red': 'rgb(var(--accent) / <alpha-value>)',
      },
      fontFamily: {
        ...prism.theme.extend.fontFamily,
        agency: ['Agency', 'system-ui', 'sans-serif'],
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['Space Mono', 'Courier New', 'monospace'],
        serif: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        ...prism.theme.extend.boxShadow,
      },
      backgroundImage: {
        ...prism.theme.extend.backgroundImage,
        'mesh-gradient': "url('/gradient-dark.svg')",
      },
      animation: {
        'fade-up': 'fadeUp .4s ease-out both',
        'pulse-ring': 'pulseRing 2s ease-out infinite',
        shimmer: 'shimmer 1.8s linear infinite',
        breathe: 'breathe 1.4s ease-in-out infinite',
        'slide-in': 'slideIn .35s ease-out both',
        'voice-bar': 'voiceBar 1.2s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        pulseRing: { '0%': { opacity: '.7', transform: 'scale(1)' }, '100%': { opacity: '0', transform: 'scale(1.5)' } },
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
        breathe: { '0%,100%': { opacity: '.4' }, '50%': { opacity: '1' } },
        slideIn: { from: { opacity: 0, transform: 'translateX(60px)' }, to: { opacity: 1, transform: 'translateX(0)' } },
        voiceBar: { '0%,100%': { transform: 'scaleY(0.3)' }, '50%': { transform: 'scaleY(1)' } },
      },
    },
  },
  plugins: [],
};
