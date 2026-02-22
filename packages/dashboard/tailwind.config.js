/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Shell (Glyphor brand)
        base: '#0B0B0C',
        surface: '#121314',
        raised: '#0B0B0C',
        border: '#1A1A1A',
        'border-hover': '#2a2a2a',
        // Primary
        cyan: { DEFAULT: '#00E0FF', muted: '#00E0FF80' },
        azure: { DEFAULT: '#0097FF', muted: '#0097FF80' },
        accent: { DEFAULT: '#623CEA', muted: '#623CEA80' },
        // Agent roles (monochrome blue-cyan spectrum)
        exec: '#623CEA',
        eng: '#0097FF',
        product: '#00E0FF',
        finance: '#4B9FE1',
        marketing: '#7B68EE',
        cs: '#00BCD4',
        sales: '#5B8DEF',
        // Tiers (blue-cyan spectrum, no green/yellow/red)
        'tier-green': '#00E0FF',
        'tier-yellow': '#0097FF',
        'tier-red': '#623CEA',
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['Space Mono', 'Courier New', 'monospace'],
        serif: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-up': 'fadeUp .4s ease-out both',
        'pulse-ring': 'pulseRing 2s ease-out infinite',
        shimmer: 'shimmer 1.8s linear infinite',
        breathe: 'breathe 1.4s ease-in-out infinite',
        'slide-in': 'slideIn .35s ease-out both',
      },
      keyframes: {
        fadeUp: { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        pulseRing: { '0%': { opacity: '.7', transform: 'scale(1)' }, '100%': { opacity: '0', transform: 'scale(1.5)' } },
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
        breathe: { '0%,100%': { opacity: '.4' }, '50%': { opacity: '1' } },
        slideIn: { from: { opacity: 0, transform: 'translateX(60px)' }, to: { opacity: 1, transform: 'translateX(0)' } },
      },
    },
  },
  plugins: [],
};
