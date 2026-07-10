// PM2 — Configuración de proceso para producción
// Uso: pm2 start ecosystem.config.js --env production

module.exports = {
  apps: [
    {
      name: 'dismed-api',
      script: 'src/app.js',
      instances: 1,           // 1 instancia (ajustar según CPU del VPS)
      autorestart: true,
      watch: false,           // NUNCA watch en producción
      max_memory_restart: '500M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
