import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        green: '#1DB954',
        ink: '#121212',
        surface: '#212121',
        line: '#2E2E2E',
        mid: '#535353',
        dim: '#B3B3B3',
      },
      fontFamily: {
        wordmark: ['var(--font-wordmark)'],
        sans: ['var(--font-text)'],
      },
      maxWidth: { page: '1680px' },
    },
  },
  plugins: [],
};
export default config;
