/* ═══════════════════════════════════════════════
   GLYPHOR PRISM — Tailwind Extension
   ═══════════════════════════════════════════════ */

/** @type {Partial<import('tailwindcss').Config>} */
const prism = {
  theme: {
    extend: {
      colors: {
        'prism-bg':       'rgb(var(--prism-bg) / <alpha-value>)',
        'prism-bg2':      'rgb(var(--prism-bg2) / <alpha-value>)',
        'prism-card':     'rgb(var(--prism-card) / <alpha-value>)',
        'prism-card-alt': 'rgb(var(--prism-card-alt) / <alpha-value>)',

        'prism-primary':   'rgb(var(--prism-primary) / <alpha-value>)',
        'prism-secondary': 'rgb(var(--prism-secondary) / <alpha-value>)',
        'prism-tertiary':  'rgb(var(--prism-tertiary) / <alpha-value>)',
        'prism-muted':     'rgb(var(--prism-muted) / <alpha-value>)',

        'prism-border':    'rgb(var(--prism-border) / <alpha-value>)',

        'prism-cyan':    'rgb(var(--prism-accent-1) / <alpha-value>)',
        'prism-teal':    'rgb(var(--prism-accent-2) / <alpha-value>)',
        'prism-sky':     'rgb(var(--prism-accent-3) / <alpha-value>)',
        'prism-indigo':  'rgb(var(--prism-accent-4) / <alpha-value>)',
        'prism-violet':  'rgb(var(--prism-accent-5) / <alpha-value>)',
        'prism-fuchsia': 'rgb(var(--prism-accent-6) / <alpha-value>)',

        'prism-fill-1': 'rgb(var(--prism-fill-1) / <alpha-value>)',
        'prism-fill-2': 'rgb(var(--prism-fill-2) / <alpha-value>)',
        'prism-fill-3': 'rgb(var(--prism-fill-3) / <alpha-value>)',
        'prism-fill-4': 'rgb(var(--prism-fill-4) / <alpha-value>)',
        'prism-fill-5': 'rgb(var(--prism-fill-5) / <alpha-value>)',
        'prism-fill-6': 'rgb(var(--prism-fill-6) / <alpha-value>)',

        'prism-tint-1': 'rgb(var(--prism-tint-1) / <alpha-value>)',
        'prism-tint-2': 'rgb(var(--prism-tint-2) / <alpha-value>)',
        'prism-tint-3': 'rgb(var(--prism-tint-3) / <alpha-value>)',
        'prism-tint-4': 'rgb(var(--prism-tint-4) / <alpha-value>)',
        'prism-tint-5': 'rgb(var(--prism-tint-5) / <alpha-value>)',
        'prism-tint-6': 'rgb(var(--prism-tint-6) / <alpha-value>)',

        'prism-track': 'rgb(var(--prism-track) / <alpha-value>)',

        'prism-critical': 'rgb(var(--prism-critical) / <alpha-value>)',
        'prism-high':     'rgb(var(--prism-high) / <alpha-value>)',
        'prism-elevated': 'rgb(var(--prism-elevated) / <alpha-value>)',
        'prism-moderate': 'rgb(var(--prism-moderate) / <alpha-value>)',
      },
      boxShadow: {
        'prism':    'var(--prism-shadow)',
        'prism-lg': 'var(--prism-shadow-lg)',
      },
      fontFamily: {
        'prism-display': ['Agency', 'Impact', 'Arial Narrow', 'sans-serif'],
        'prism-body':    ['Calibri', 'Gill Sans', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'prism-gradient': 'linear-gradient(90deg, rgb(var(--prism-fill-1)), rgb(var(--prism-fill-2)), rgb(var(--prism-fill-3)), rgb(var(--prism-fill-4)), rgb(var(--prism-fill-5)), rgb(var(--prism-fill-6)))',
      },
    },
  },
};

export default prism;
