import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // sj palette (mirrors apps/ios asset catalog — see globals.css)
        page:        'rgb(var(--color-page) / <alpha-value>)',
        surface:     'rgb(var(--color-surface) / <alpha-value>)',
        ink:         'rgb(var(--color-ink) / <alpha-value>)',
        mid:         'rgb(var(--color-mid) / <alpha-value>)',
        muted:       'rgb(var(--color-muted) / <alpha-value>)',
        divider:     'rgb(var(--color-divider) / <alpha-value>)',
        placeholder: 'rgb(var(--color-placeholder) / <alpha-value>)',
        subtle:      'rgb(var(--color-subtle) / <alpha-value>)',
        accent:      'rgb(var(--color-accent) / <alpha-value>)',
        'accent-soft': 'rgb(var(--color-accent-soft) / <alpha-value>)',
        'accent-deep': 'rgb(var(--color-accent-deep) / <alpha-value>)',
        spotify:     '#1DB954',
        // Legacy aliases (retained pages: terms/privacy/help/admin)
        mint:        'rgb(var(--color-accent) / <alpha-value>)',
        'mint-bg':   'rgb(var(--color-accent-soft) / <alpha-value>)',
        'mint-dark': 'rgb(var(--color-accent-deep) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    }
  },
  plugins: []
};

export default config;
