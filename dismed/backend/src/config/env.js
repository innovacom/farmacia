require('dotenv').config();

const required = [
  'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
  'JWT_SECRET', 'GEMINI_API_KEY',
];

function validateEnv() {
  const missing = required.filter((k) => !process.env[k]);
  // FRONTEND_URL sin definir en producción degrada CORS en silencio a
  // localhost:5173 (ver app.js) — más restrictivo que inseguro, pero rompe
  // el frontend real sin ningún error visible. Falla rápido en vez de eso.
  if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
    missing.push('FRONTEND_URL');
  }
  if (missing.length) {
    console.error('❌ Variables de entorno faltantes:', missing.join(', '));
    process.exit(1);
  }
}

module.exports = { validateEnv };
