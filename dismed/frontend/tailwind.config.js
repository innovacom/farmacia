/** @type {import('tailwindcss').Config} */
// La paleta brand se resuelve vía CSS variables (RGB sin envolver) definidas en
// src/index.css con los valores INNOVACOM de siempre. useBranding.js las
// sobreescribe en runtime con el color de la empresa del usuario (white-label POS)
// — sin branding configurado la app se ve idéntica a antes.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
