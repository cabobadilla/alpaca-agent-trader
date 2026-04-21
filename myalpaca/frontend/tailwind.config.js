/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        alpaca: {
          green: '#00C805',
          red: '#FF5000',
          bg: '#0D1117',
          surface: '#161B22',
          border: '#30363D',
          text: '#E6EDF3',
          muted: '#8B949E',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
