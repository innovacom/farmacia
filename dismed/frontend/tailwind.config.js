/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eff6ff',
          100: '#dbeafe',
          500: '#1a6bb5',
          600: '#1558a0',
          700: '#10478a',
        },
      },
    },
  },
  plugins: [],
};
