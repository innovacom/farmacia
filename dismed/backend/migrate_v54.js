/**
 * Migración v54 — node migrate_v54.js
 * Bandera de encendido/apagado del pedido automático a Nadro, editable desde
 * Configuración (admin) sin tocar el .env ni reiniciar el backend — a
 * diferencia de NADRO_AUTOPEDIDO_ENABLED (env, requiere redeploy), esta vive
 * en la tabla `configuracion` y el cron la relee cada noche antes de correr
 * (ver nadro.config.service.js / nadro.cron.js).
 *
 * Default '0' (apagada): activarla es una decisión explícita del admin, no
 * algo que quede prendido solo porque se desplegó el código.
 *
 * Idempotente: INSERT IGNORE (si el admin ya la cambió, no se pisa).
 */
require('dotenv').config();
const { pool } = require('./src/config/db');

async function run(label, sql) {
  try { await pool.query(sql); console.log('OK  ' + label); }
  catch (e) { console.log('INFO ' + label + ' — ' + e.message); }
}

(async () => {
  await run('seed nadro_autopedido_activo=0', `
    INSERT IGNORE INTO configuracion (clave, valor, descripcion)
    VALUES ('nadro_autopedido_activo', '0', 'Pedido automático diario a Nadro activo (1) o apagado (0)')`);

  console.log('\nMigración v54 terminada.');
  process.exit(0);
})();
