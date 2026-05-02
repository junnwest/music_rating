import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        mint:        '#3DFFD1',
        'mint-bg':   '#EDFFF9',
        'mint-dark': '#00453A',
        ink:         '#111111',
        mid:         '#444444',
        muted:       '#888888',
        surface:     '#F7F7F5',
        divider:     '#EBEBEB',
        placeholder: '#C0C0BE',
        subtle:      '#DDDDD8',
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    }
  },
  plugins: []
};

export default config;
