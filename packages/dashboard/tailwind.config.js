/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Shell
        base: '#0a0f15',
        surface: '#0c1017',
        raised: '#080b10',
        border: '#151921',
        'border-hover': '#1e293b',
        // Accent
        violet: { DEFAULT: '#7c3aed', muted: '#4c1d95' },
        // Departments
        exec: '#8b5cf6',
        eng: '#ef4444',
        product: '#06b6d4',
        finance: '#10b981',
        marketing: '#ec4899',
        cs: '#3b82f6',
        sales: '#f59e0b',
        // Tiers
        'tier-green': '#22c55e',
        'tier-yellow': '#eab308',
        'tier-red': '#ef4444',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        serif: ['Instrument Serif', 'serif'],
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
