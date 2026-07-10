require('dotenv').config();

const required = [
  'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
  'JWT_SECRET', 'ANTHROPIC_API_KEY',
];

function validateEnv() {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('❌ Variables de entorno faltantes:', missing.join(', '));
    process.exit(1);
  }
}

module.exports = { validateEnv };
