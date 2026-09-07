/**
 * cluster.js — Ayuda para que las tareas programadas (cron) corran en UNA sola
 * instancia cuando la app está en modo cluster de PM2.
 *
 * `ecosystem.config.js` levanta `dismed-api` con `instances: 2`, así que cada
 * módulo de cron (`sat.cron`, `supervisor.cron`, `nadro.cron`) se inicializa dos
 * veces y disparaba todo por duplicado: doble descarga del SAT, doble solicitud
 * el día 3 (quemando la cuota "solicitudes de por vida"), dobles alertas, etc.
 *
 * PM2 expone `NODE_APP_INSTANCE` con el índice (0, 1, …) de cada worker. Sin PM2
 * (dev, `node src/app.js` directo) la variable no existe y se asume principal.
 */
function esInstanciaPrincipalDeCron() {
  const i = process.env.NODE_APP_INSTANCE;
  return i === undefined || i === '' || i === '0';
}

module.exports = { esInstanciaPrincipalDeCron };
