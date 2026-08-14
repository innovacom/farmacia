/**
 * nadro.config.service.js — Bandera "nadro_autopedido_activo" en la tabla
 * `configuracion` (ver migrate_v54): a diferencia de NADRO_AUTOPEDIDO_ENABLED
 * (.env, requiere redeploy), esta se lee de la BD en cada corrida del cron,
 * así que un admin la prende/apaga desde Configuración y surte efecto esa
 * misma noche sin tocar el servidor.
 */
const { pool } = require('../../config/db');

const CLAVE = 'nadro_autopedido_activo';

async function activo() {
  const [[row]] = await pool.query('SELECT valor FROM configuracion WHERE clave = ?', [CLAVE]);
  return row?.valor === '1';
}

async function setActivo(valor) {
  await pool.query(
    `INSERT INTO configuracion (clave, valor, descripcion)
     VALUES (?, ?, 'Pedido automático diario a Nadro activo (1) o apagado (0)')
     ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
    [CLAVE, valor ? '1' : '0']
  );
  return { activo: !!valor };
}

module.exports = { activo, setActivo };
