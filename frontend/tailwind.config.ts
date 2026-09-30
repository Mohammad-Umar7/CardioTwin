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
      },
      fontFamily: {
        ui: ['"Inter Variable"', 'system-ui', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['"Inter Tight Variable"', '"Inter Variable"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      fontSize: {
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
      borderRadius: { xs: '2px', sm: '4px', md: '6px', lg: '8px' },
      boxShadow: {
        e1: 'var(--e-1)',
        e2: 'var(--e-2)',
        e3: 'var(--e-3)',
        hud: 'var(--e-hud)',
        focus: 'var(--focus-ring)',
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
      },
      animation: {
        'rise-in': 'rise-in 240ms cubic-bezier(.22,1,.36,1) both',
        indeterminate: 'indeterminate 1.4s cubic-bezier(.65,0,.35,1) infinite',
        'pip-ring': 'pip-ring 240ms cubic-bezier(.22,1,.36,1) 1',
        shimmer: 'shimmer 1.8s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
