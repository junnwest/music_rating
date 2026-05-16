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
        mint:        '#3DFFD1',
        'mint-bg':   'rgb(var(--color-mint-bg))',
        'mint-dark': 'rgb(var(--color-mint-dark))',
        ink:         'rgb(var(--color-ink))',
        mid:         'rgb(var(--color-mid))',
        muted:       'rgb(var(--color-muted))',
        surface:     'rgb(var(--color-surface))',
        divider:     'rgb(var(--color-divider))',
        placeholder: 'rgb(var(--color-placeholder))',
        subtle:      'rgb(var(--color-subtle))',
        page:        'rgb(var(--color-page))',
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    }
  },
  plugins: []
};

export default config;
