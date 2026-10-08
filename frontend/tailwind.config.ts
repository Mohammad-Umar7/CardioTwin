import type { Config } from 'tailwindcss';

/**
 * Tailwind maps onto the LUMEN tokens (docs/design/DESIGN_SYSTEM.md §2). Colour tokens are CSS custom
 * properties holding space-separated sRGB channels (src/styles/tokens.css), so opacity modifiers such as
 * `bg-surface-3/88` keep working. Never add raw hex colours to components: add a token first.
 */
const token = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: token('bg-void'),
        app: token('bg-app'),
        panel: token('bg-panel'),
        'surface-1': token('surface-1'),
        'surface-2': token('surface-2'),
        'surface-3': token('surface-3'),
        hairline: token('border-hairline'),
        line: token('border-default'),
        'line-strong': token('border-strong'),
        primary: token('text-primary'),
        secondary: token('text-secondary'),
        tertiary: token('text-tertiary'),
        disabled: token('text-disabled'),
        accent: {
          DEFAULT: token('accent'),
          hover: token('accent-hover'),
          pressed: token('accent-pressed'),
          ink: token('accent-ink'),
        },
        success: token('success'),
        warn: token('warn'),
        danger: token('danger'),
        pending: token('pending'),
        // LUMEN 2 decorative light (never data): glows, gradients, the live monitor trace.
        'glow-sky': token('glow-sky'),
        'glow-indigo': token('glow-indigo'),
        'glow-teal': token('glow-teal'),
        ecg: token('ecg'),
      },
      fontFamily: {
        ui: ['"Inter Variable"', 'system-ui', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['"Inter Tight Variable"', '"Inter Variable"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      fontSize: {
        // LUMEN 2 landing headline (≥ 1440): one size up from display-1, tighter tracking.
        'display-hero': ['3.75rem', { lineHeight: '3.875rem', letterSpacing: '-0.042em', fontWeight: '600' }],
        'display-1': ['3.5rem', { lineHeight: '3.75rem', letterSpacing: '-0.035em', fontWeight: '600' }],
        'display-2': ['2.5rem', { lineHeight: '2.75rem', letterSpacing: '-0.03em', fontWeight: '600' }],
        'title-1': ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.02em', fontWeight: '600' }],
        'title-2': ['1rem', { lineHeight: '1.375rem', letterSpacing: '-0.01em', fontWeight: '600' }],
        body: ['0.875rem', { lineHeight: '1.25rem', letterSpacing: '-0.006em' }],
        narrative: ['0.875rem', { lineHeight: '1.3125rem' }],
        'body-s': ['0.8125rem', { lineHeight: '1.125rem' }],
        label: ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.005em', fontWeight: '500' }],
        overline: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.08em', fontWeight: '600' }],
        'numeral-xl': ['3rem', { lineHeight: '3rem', letterSpacing: '-0.04em', fontWeight: '600' }],
        'numeral-xl-compact': ['2.5rem', { lineHeight: '2.5rem', letterSpacing: '-0.04em', fontWeight: '600' }],
        'numeral-l': ['1.25rem', { lineHeight: '1.5rem', fontWeight: '600' }],
        'numeral-label': ['0.9375rem', { lineHeight: '1.25rem', fontWeight: '600' }],
        'numeral-m': ['0.8125rem', { lineHeight: '1.125rem', fontWeight: '500' }],
        'mono-s': ['0.75rem', { lineHeight: '1rem', fontWeight: '450' }],
      },
      borderRadius: { xs: '3px', sm: '6px', md: '10px', lg: '14px', xl: '20px' },
      boxShadow: {
        e1: 'var(--e-1)',
        e2: 'var(--e-2)',
        e3: 'var(--e-3)',
        hud: 'var(--e-hud)',
        focus: 'var(--focus-ring)',
        glow: 'var(--glow-accent)',
      },
      height: { xs: '1.5rem', sm: '1.75rem', md: '2rem', lg: '2.5rem' },
      minHeight: { xs: '1.5rem', sm: '1.75rem', md: '2rem', lg: '2.5rem' },
      zIndex: {
        canvas: '0',
        hud: '10',
        labels: '20',
        panels: '30',
        flyout: '40',
        popover: '50',
        toast: '60',
        scrim: '70',
        coachmark: '80',
        status: '90',
        skip: '100',
      },
      transitionTimingFunction: {
        instant: 'cubic-bezier(.2,0,0,1)',
        out: 'cubic-bezier(.22,1,.36,1)',
        data: 'cubic-bezier(.16,1,.3,1)',
        peel: 'cubic-bezier(.65,0,.35,1)',
        exit: 'cubic-bezier(.55,0,1,.45)',
      },
      transitionDuration: { instant: '90ms', fast: '160ms', base: '240ms', flyout: '360ms', data: '420ms' },
      keyframes: {
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        indeterminate: {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(400%)' },
        },
        'pip-ring': {
          from: { transform: 'scale(1)', opacity: '0.6' },
          to: { transform: 'scale(1.4)', opacity: '0' },
        },
        shimmer: {
          from: { backgroundPosition: '200% 0' },
          to: { backgroundPosition: '-200% 0' },
        },
        // LUMEN 2 motion: things arrive once (blur-in, rise), only light and physiology loop.
        'blur-in': {
          from: { opacity: '0', transform: 'translateY(14px)', filter: 'blur(10px)' },
          to: { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'gradient-pan': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'live-dot': {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--c-ecg) / .55)' },
          '70%': { boxShadow: '0 0 0 7px rgb(var(--c-ecg) / 0)' },
          '100%': { boxShadow: '0 0 0 0 rgb(var(--c-ecg) / 0)' },
        },
        'aurora-a': {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(4%,3%,0) scale(1.08)' },
        },
        'aurora-b': {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1.05)' },
          '50%': { transform: 'translate3d(-5%,-2%,0) scale(.95)' },
        },
        'nudge-x': {
          '0%, 100%': { transform: 'translateX(0)' },
          '50%': { transform: 'translateX(3px)' },
        },
      },
      animation: {
        'rise-in': 'rise-in 240ms cubic-bezier(.22,1,.36,1) both',
        indeterminate: 'indeterminate 1.4s cubic-bezier(.65,0,.35,1) infinite',
        'pip-ring': 'pip-ring 240ms cubic-bezier(.22,1,.36,1) 1',
        shimmer: 'shimmer 1.8s linear infinite',
        // `backwards`: hold the start pose through the delay, then hand the element back (hover transforms work).
        'blur-in': 'blur-in 900ms cubic-bezier(.16,1,.3,1) backwards',
        'fade-up': 'fade-up 640ms cubic-bezier(.16,1,.3,1) backwards',
        'scale-in': 'scale-in 200ms cubic-bezier(.22,1,.36,1) both',
        'gradient-pan': 'gradient-pan 8s ease-in-out infinite',
        'live-dot': 'live-dot 2s cubic-bezier(.22,1,.36,1) infinite',
        'aurora-a': 'aurora-a 18s ease-in-out infinite',
        'aurora-b': 'aurora-b 22s ease-in-out infinite',
        'nudge-x': 'nudge-x 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
