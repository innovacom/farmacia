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
        // Paleta fija (no white-label) exclusiva del catálogo público /tienda.
        // El color de marca del tenant (brand-*) sigue gobernando precio/CTA;
        // esta paleta solo viste la identidad visual propia de la tienda.
        tienda: {
          surface:  '#F7FAF9',
          surface2: '#EEF4F2',
          ink:      '#101827',
          muted:    '#5B6B70',
          teal:     '#0E7C6B',
          tealsoft: '#E1F1EC',
          amber:    '#9A5B13',
          ambersoft:'#FBF0DF',
        },
      },
      fontFamily: {
        // Exclusivas de /tienda (ver Catalogo.jsx y DetalleProducto.jsx).
        // El resto del ERP sigue con el font-sans por defecto de Tailwind.
        tienda: ['Inter', 'system-ui', 'sans-serif'],
        'tienda-display': ['Manrope', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
